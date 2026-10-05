import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const LIMIT = 200000;
const activeStatus = status => ['running', 'stopping'].includes(status);
export function normalizeModel(model) {
  if (model === undefined || model === null || model === '') return null;
  if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/\[\]-]{0,199}$/.test(model)) throw new Error('Enter a valid model alias or model ID (up to 200 characters, without spaces).');
  return model;
}
export function claudeArgs(mode, model) {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', 'dontAsk', '--allowedTools', 'Read,Glob,Grep', '--settings', '{"disableAllHooks":true}'];
  const selected = normalizeModel(model);
  if (selected) args.push('--model', selected);
  if (mode === 'read') args.push('--tools', 'Read,Glob,Grep,Skill', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}');
  return args;
}
export function runPrompt({ project, task, prompt, skill, instructions, memories }) {
  return `Project: ${project.name}\nWorking directory: ${project.path}\nTask: ${task.title}\n\nRead and follow these project instructions before working:\n${instructions.map(i => `- ${i.path}`).join('\n') || '- Use the instructions discovered in the working directory.'}\n\n${skill ? `Use this selected skill. Read the complete skill instructions and any required references:\n${skill.path ? skill.path : skill.content}\n\n` : ''}Relevant memory sources (read only as needed):\n${memories.map(m => `- ${m.title}: ${m.path || m.content}`).join('\n')}\n\nUser request:\n${prompt}\n\nKeep work scoped to the request. Report what you did, verification, and any permission or other blockers. Do not start parallel agents unless the user request or selected skill explicitly asks for them.`;
}
export async function createRunManager({ directory, executable, launch = spawn, timeoutMs = 1800000 }) {
  await fs.mkdir(directory, { recursive: true });
  const runs = new Map(), children = new Map(), saves = new Map();
  function save(run) {
    const copy = JSON.stringify(run, null, 2);
    const next = (saves.get(run.id) || Promise.resolve()).catch(() => {}).then(async () => {
      const file = path.join(directory, `${run.id}.json`);
      await fs.writeFile(file + '.tmp', copy); await fs.rename(file + '.tmp', file);
    });
    saves.set(run.id, next); return next;
  }
  for (const name of await fs.readdir(directory)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
    const run = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'));
    if (activeStatus(run.status)) { run.status = 'interrupted'; run.ended = new Date().toISOString(); run.error = 'The server stopped before this run finished. Start a new run to continue.'; await save(run); }
    runs.set(run.id, run);
  }
  function summary(run) { const { output, stderr, events, prompt, ...rest } = run; return rest; }
  function stopChild(child) {
    if (!child?.pid) return;
    if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    else child.kill('SIGTERM');
  }
  return {
    list: () => [...runs.values()].sort((a,b) => b.started.localeCompare(a.started)).map(summary),
    get: id => runs.get(id),
    busy: projectId => [...runs.values()].some(r => r.projectId === projectId && activeStatus(r.status)),
    async start({ task, project, skill, prompt, mode, model }) {
      const requestedModel = normalizeModel(model);
      if ([...runs.values()].some(r => r.projectId === project.id && activeStatus(r.status))) throw new Error('A Claude run is already active in this project. Stop it or wait for it to finish.');
      const run = { id: randomUUID(), taskId: task.id, taskTitle: task.title, projectId: project.id, projectName: project.name, skillId: skill?.id || null, skillTitle: skill?.title || null, mode, requestedModel, status: 'running', started: new Date().toISOString(), output: '', stderr: '', events: [], prompt, permissionDenials: [] };
      runs.set(run.id, run);
      try { await save(run); } catch (e) { runs.delete(run.id); throw e; }
      let child, buffer = '', streamed = false, result = null, timer, saveTimer, finished = false;
      const event = text => { run.events.push({ time: new Date().toISOString(), text: text.slice(0, 400) }); if (run.events.length > 100) run.events.shift(); };
      const changed = () => { if (!saveTimer) saveTimer = setTimeout(() => {saveTimer=null;save(run).catch(e=>{run.error=`Could not save run: ${e.message}`;});}, 1000); };
      const finish = async (status, error) => {
        if (finished) return; finished=true; clearTimeout(timer);clearTimeout(saveTimer);children.delete(run.id);
        run.status=status;run.ended=new Date().toISOString();if(error)run.error=error;
        event(`Run ${status}`); await save(run).catch(e=>{run.error=`Could not save run: ${e.message}`;});
      };
      const parseLine = line => {
        if (!line.trim()) return;
        let item; try { item=JSON.parse(line); } catch { event(line);changed();return; }
        if (item.type === 'stream_event' && item.event?.type === 'content_block_delta' && item.event.delta?.type === 'text_delta') { streamed=true;run.output=(run.output+item.event.delta.text).slice(0,LIMIT); }
        if (item.type === 'assistant') for (const block of item.message?.content || []) {
          if (block.type === 'text' && !streamed) run.output=(run.output+block.text+'\n').slice(0,LIMIT);
          if (block.type === 'tool_use') event(`Using ${block.name}${block.input?.file_path ? ': '+block.input.file_path : ''}`);
        }
        if (item.type === 'system' && item.subtype === 'init') {run.sessionId=item.session_id;run.model=item.model;event('Claude connected');}
        if (item.type === 'system' && item.subtype === 'permission_denied') event('Claude requested a tool permission that is not allowed in this run.');
        if (item.type === 'result') {
          result=item;if(typeof item.result==='string')run.output=item.result.slice(0,LIMIT);
          run.sessionId=item.session_id || run.sessionId;run.costUsd=item.total_cost_usd;run.permissionDenials=item.permission_denials || [];
          if(item.is_error)run.error=(item.errors || []).join('\n') || item.result || `Claude returned ${item.subtype}`;
        }
        changed();
      };
      try {
        child=launch(executable, claudeArgs(mode, requestedModel), { cwd:project.path, shell:false, windowsHide:true, stdio:['pipe','pipe','pipe'] });
        run.pid=child.pid;changed();
        children.set(run.id, child);
        child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
        child.stdout.on('data', chunk => {
          buffer+=chunk;
          if(buffer.length>2000000){run.error='Claude output exceeded the supported event size.';stopChild(child);return;}
          let end;while((end=buffer.indexOf('\n'))!==-1){parseLine(buffer.slice(0,end));buffer=buffer.slice(end+1);}
        });
        child.stderr.on('data', chunk=>{run.stderr=(run.stderr+chunk).slice(-20000);changed();});
        child.on('error', e=>{void finish('failed',`Claude could not start: ${e.message}`);});
        child.stdin.on('error', e=>{if(!finished){run.error=`Could not send prompt: ${e.message}`;stopChild(child);}});
        child.on('close', code=>{
          if(finished)return;if(buffer)parseLine(buffer);
          const status=run.status==='stopping'?'cancelled':run.permissionDenials.length?'needs_permission':run.error||code!==0||!result||result.is_error?'failed':'completed';
          void finish(status,status==='failed'?(run.error || run.stderr.trim() || 'Claude exited without a successful result.'):undefined);
        });
        timer=setTimeout(()=>{run.error='Run exceeded the 30-minute time limit.';stopChild(child);},timeoutMs);
        child.stdin.end(prompt);
      } catch(e) { await finish('failed',`Claude could not start: ${e.message}`); }
      return summary(run);
    },
    async cancel(id) {
      const run=runs.get(id); if(!run)throw new Error('Run not found');
      if(!activeStatus(run.status))return summary(run);
      run.status='stopping';await save(run);stopChild(children.get(id));return summary(run);
    },
    shutdown() { for (const child of children.values()) stopChild(child); }
  };
}
