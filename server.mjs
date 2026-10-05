import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRunManager, runPrompt, normalizeModel } from './claude-runtime.mjs';
import { buildMemoryGraph } from './memory-graph.mjs';
import { createSessionDiscovery, readRegisteredSessions } from './claude-sessions.mjs';
import { resolveMemoryFolder } from './memory-location.mjs';
import { scanProjectChannels, channelHealth } from './project-channels.mjs';
import { loadWorkspaceConfig } from './workspace-config.mjs';

const exec = promisify(execFile);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const config = await loadWorkspaceConfig(process.env.AGENTIC_OS_CONFIG || path.join(ROOT,'config.json'));
const DATA = process.env.AGENTIC_OS_DATA_DIR || path.join(ROOT, 'data');
await fs.mkdir(DATA, { recursive: true });
const runtimeAvailable = await fs.access(config.claudeExecutable).then(() => true, () => false);
const runtime = await createRunManager({ directory: path.join(DATA, 'runs'), executable: config.claudeExecutable });
const runtimeInfo = () => ({ available: runtimeAvailable, runs: runtime.list() });
let state;
try { state = JSON.parse(await fs.readFile(path.join(DATA, 'workspace.json'), 'utf8')); }
catch (e) { if (e.code !== 'ENOENT') throw e; state = { tasks: [], pins: [], entries: [] }; }
state.projects ||= [];
const projectList = () => [...config.projects, ...state.projects];
const discoverSessions = createSessionDiscovery(config.claudeExecutable, undefined, () => readRegisteredSessions(path.join(path.dirname(config.memoryRoot), 'sessions')));
const sessionInfo = () => discoverSessions(projectList(), runtime.list());
let snapshot, refreshing;
const documents = new Map();
const memoryContents = new Map();
const idFor = p => createHash('sha256').update(p.toLowerCase()).digest('hex').slice(0, 20);
const exists = async p => { try { await fs.access(p); return true; } catch { return false; } };
const clean = t => t.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '').trim();
const field = (t, name) => t.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'))?.[1]?.replace(/^["']|["']$/g, '').trim();
async function scan(dir, depth = 0) {
  if (depth > 9) return [];
  let entries; try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
  const files = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink() || ['node_modules', '.git', 'references', 'assets', 'scripts'].includes(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await scan(p, depth + 1));
    else if (entry.name === 'SKILL.md') files.push(p);
  }
  return files;
}
async function metadata(file, kind, projectId = null) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512000) return null;
    const source = (await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '');
    const body = clean(source);
    const title = kind === 'skill' ? field(source, 'name') || path.basename(path.dirname(file)) : field(source, 'name') || body.match(/^#\s+(.+)$/m)?.[1] || path.basename(file, '.md').replace(/[-_]/g, ' ');
    const description = field(source, 'description') || body.split('\n').find(l => l.trim() && !l.startsWith('#') && !l.startsWith('---')) || '';
    const id = idFor(file);
    documents.set(id, { file, kind, projectId });
    if (kind === 'memory') memoryContents.set(id, source);
    return { id, title, description: description.slice(0, 260), kind, projectId, path: file, modified: stat.mtime.toISOString(), type: field(source, 'type') || 'note', source: file.includes(`${path.sep}.claude${path.sep}`) ? 'Claude' : file.includes(`${path.sep}.agents${path.sep}`) ? 'Shared' : 'Codex' };
  } catch { return null; }
}
async function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const memory = [], skills = [], projects = [], warnings = [];
    memoryContents.clear();
    for (const project of projectList()) {
      const available = await exists(project.path);
      let branch = null, changes = null, repositoryRoot = null;
      if (available) try {
        const [b, s, r] = await Promise.all([exec('git', ['-C', project.path, 'branch', '--show-current'], { timeout: 7000, windowsHide: true }), exec('git', ['-C', project.path, 'status', '--porcelain', '--untracked-files=no'], { timeout: 7000, windowsHide: true, maxBuffer: 1024 * 1024 }), exec('git', ['-C', project.path, 'rev-parse', '--show-toplevel'], { timeout: 7000, windowsHide: true })]);
        repositoryRoot = r.stdout.trim();
        branch = b.stdout.trim() || 'Detached HEAD'; changes = s.stdout.split('\n').filter(Boolean).length;
      } catch { warnings.push(`Git status unavailable for ${project.name}`); }
      const memoryFolder = await resolveMemoryFolder({ ...project, projectPath: project.path, memoryRoot: config.memoryRoot, repositoryRoot });
      const memoryPath = path.join(config.memoryRoot, memoryFolder, 'memory');
      let entries = []; try { entries = await fs.readdir(memoryPath, { withFileTypes: true }); } catch { warnings.push(`Memory folder unavailable for ${project.name}`); }
      for (const entry of entries) if (entry.isFile() && entry.name.endsWith('.md')) { const m = await metadata(path.join(memoryPath, entry.name), 'memory', project.id); if (m) memory.push(m); }
      const instructions = [];
      const channels=await scanProjectChannels(project);
      for(const channel of channels){const doc=await metadata(channel.readme,'channel',project.id);if(doc)channel.document=doc;delete channel.readme;}
      for (const name of ['AGENTS.md', 'CLAUDE.md', 'CONTEXT.md']) {
        const file = path.join(project.path, name);
        if (await exists(file)) { const m = await metadata(file, 'instruction', project.id); if (m) instructions.push(m); }
      }
      projects.push({ ...project, memoryFolder, available, branch, changes, memoryPath, instructions, channels, memoryCount: memory.filter(m => m.projectId === project.id).length });
    }
    const roots = projectList().flatMap(p => ['.claude', '.agents', '.codex'].map(dir => path.join(p.path, dir, 'skills')).concat(path.join(p.path, 'skills')));
    const files = new Set((await Promise.all(roots.map(p => scan(p)))).flat());
    for (const file of files) { const owner = projectList().filter(p => file.toLowerCase().startsWith(p.path.toLowerCase() + path.sep)).sort((a,b)=>b.path.length-a.path.length)[0]; const s = await metadata(file, 'skill', owner?.id); if (s) skills.push(s); }
    memory.sort((a,b) => b.modified.localeCompare(a.modified));
    skills.sort((a,b) => a.title.localeCompare(b.title));
    snapshot = { projects, memory, skills, warnings, scannedAt: new Date().toISOString() };
    return snapshot;
  })();
  try { return await refreshing; } finally { refreshing = null; }
}
let writeQueue = Promise.resolve();
function updateState(fn) {
  const result = writeQueue.then(async () => {
    const next = structuredClone(state); const value = fn(next);
    const temp = path.join(DATA, 'workspace.tmp');
    await fs.writeFile(temp, JSON.stringify(next, null, 2));
    await fs.rename(temp, path.join(DATA, 'workspace.json')); state = next; return value;
  });
  writeQueue = result.catch(() => {}); return result;
}
const send = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
async function body(req) {
  let text = ''; for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 128000) throw new Error('Request too large'); } return JSON.parse(text || '{}');
}
function projectValid(id) { return id === null || projectList().some(p => p.id === id); }
const port = Number(process.env.PORT || config.port);
export const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const host = req.headers.host;
  if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(host)) return send(res, 403, { error: 'Invalid host' });
  if (req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin)) return send(res, 403, { error: 'Invalid origin' });
  const url = new URL(req.url, `http://${host}`);
  try {
    if (url.pathname === '/api/workspace' && req.method === 'GET') return send(res, 200, { ...snapshot || await refresh(), state, runtime: runtimeInfo(), sessions: await sessionInfo() });
    if (url.pathname === '/api/refresh' && req.method === 'POST') return send(res, 200, { ...await refresh(), state, runtime: runtimeInfo(), sessions: await sessionInfo() });
    if (url.pathname === '/api/sessions' && req.method === 'GET') return send(res, 200, await sessionInfo());
    if (url.pathname === '/api/channels' && req.method === 'GET') {
      if(!snapshot)await refresh();
      return send(res,200,await channelHealth(snapshot.projects.flatMap(p=>p.channels),config.channelHealth));
    }
    if (url.pathname === '/api/memory-graph' && req.method === 'GET') {
      if (!snapshot) await refresh();
      if (refreshing) await refreshing;
      return send(res, 200, buildMemoryGraph([...snapshot.memory.map(n => ({ ...n, content: memoryContents.get(n.id) })), ...state.entries.filter(n => n.kind === 'memory')]));
    }
    if (url.pathname === '/api/projects' && req.method === 'POST') {
      const b=await body(req);
      if(typeof b.name!=='string'||!b.name.trim()||b.name.length>100||typeof b.path!=='string'||!b.path.trim()||b.path.length>1000||typeof b.description!=='undefined'&&(typeof b.description!=='string'||b.description.length>500)||typeof b.memoryFolder!=='undefined'&&typeof b.memoryFolder!=='string')return send(res,400,{error:'Enter a project name and an existing folder path.'});
      const enteredPath=b.path.trim();
      if(!path.isAbsolute(enteredPath)||(process.platform==='win32'&&!/^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/i.test(enteredPath)))return send(res,400,{error:'Use the full folder path, for example C:\\Development\\MyProject.'});
      let folder;try{folder=await fs.realpath(enteredPath);if(!(await fs.stat(folder)).isDirectory())throw new Error();}catch{return send(res,400,{error:'Folder not found. Enter the path to an existing project directory.'});}
      const knownPaths=await Promise.all(projectList().map(async p=>(await fs.realpath(p.path).catch(()=>path.resolve(p.path))).toLowerCase()));
      if(knownPaths.includes(folder.toLowerCase()))return send(res,409,{error:'This project folder is already connected.'});
      let memoryFolder=(b.memoryFolder || '').trim();
      if(memoryFolder && (memoryFolder==='.'||memoryFolder==='..'||/[\\/:\x00-\x1f]/.test(memoryFolder)))return send(res,400,{error:'Enter a memory folder name, not a full path.'});
      if(!memoryFolder){const inferred=folder.replace(/[^a-z0-9]/gi,'-');let candidates=[];try{candidates=await fs.readdir(config.memoryRoot);}catch{}memoryFolder=candidates.find(n=>n.toLowerCase()===inferred.toLowerCase()) || inferred;}
      let added;
      await updateState(s=>{
        if(s.projects.some(p=>p.path.toLowerCase()===folder.toLowerCase()))throw Object.assign(new Error('This project folder is already connected.'),{statusCode:409});
        const used=new Set([...config.projects,...s.projects].map(p=>p.id));
        const base=b.name.trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'project';
        let id=base,suffix=2;while(used.has(id))id=`${base}-${suffix++}`;
        const words=b.name.trim().split(/\s+/);const initials=(words.length>1?words.map(w=>w[0]).slice(0,2).join(''):b.name.trim().slice(0,2)).toUpperCase();
        added={id,name:b.name.trim(),path:folder,memoryFolder,memoryMapping:b.memoryFolder?.trim()?'manual':'auto',description:(b.description||'').trim(),color:['blue','purple','teal'][used.size%3],initials};s.projects.push(added);
      });
      if(refreshing)await refreshing;await refresh();
      return send(res,201,added);
    }
    if (url.pathname === '/api/runs' && req.method === 'GET') return send(res, 200, runtime.list());
    if (url.pathname === '/api/runs' && req.method === 'POST') {
      if(!runtimeAvailable)return send(res,503,{error:'Claude CLI is unavailable. Check claudeExecutable in config.json.'});
      const b=await body(req), task=state.tasks.find(t=>t.id===b.taskId), project=projectList().find(p=>p.id===b.projectId);
      const model=normalizeModel(b.model);
      if(!task||!project||(task.projectId&&task.projectId!==project.id)||typeof b.prompt!=='string'||!b.prompt.trim()||b.prompt.length>20000||!['read','project'].includes(b.mode))return send(res,400,{error:'Choose a valid task, its project, and a prompt.'});
      if(!await exists(project.path))return send(res,400,{error:'Project folder is unavailable.'});
      if(!snapshot)await refresh();
      const skill=b.skillId ? snapshot.skills.find(s=>s.id===b.skillId&&s.projectId===project.id) || state.entries.find(s=>s.id===b.skillId&&s.kind==='skill'&&s.projectId===project.id) : null;
      if(b.skillId&&!skill)return send(res,400,{error:'Choose a skill from this project.'});
      if(runtime.busy(project.id))return send(res,409,{error:'Claude is already running in this project.'});
      const p=snapshot.projects.find(p=>p.id===project.id);
      const prompt=runPrompt({ project, task, prompt:b.prompt.trim(), skill, instructions:p.instructions, memories:[...state.entries.filter(m=>m.kind==='memory'),...snapshot.memory].filter(m=>m.projectId===project.id).slice(0,15) });
      const run=await runtime.start({task,project,skill,prompt,mode:b.mode,model});
      await updateState(s=>{const t=s.tasks.find(t=>t.id===task.id);if(t&&run.status==='running')t.status='doing';});
      return send(res,201,run);
    }
    if (url.pathname.startsWith('/api/runs/')) {
      const [, , , id, action]=url.pathname.split('/');
      const run=runtime.get(id);if(!run)return send(res,404,{error:'Run not found'});
      if(req.method==='GET'&&!action)return send(res,200,run);
      if(req.method==='POST'&&action==='cancel')return send(res,200,await runtime.cancel(id));
    }
    if (url.pathname.startsWith('/api/document/') && req.method === 'GET') {
      if (!snapshot) await refresh();
      const d = documents.get(url.pathname.split('/').pop());
      if (!d) return send(res, 404, { error: 'Document not found' });
      const stat = await fs.lstat(d.file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512000) return send(res, 400, { error: 'Document cannot be read' });
      return send(res, 200, { ...d, content: await fs.readFile(d.file, 'utf8') });
    }
    if (url.pathname === '/api/tasks' && req.method === 'POST') {
      const b = await body(req); if (typeof b.title !== 'string' || !b.title.trim() || b.title.length > 300 || !projectValid(b.projectId)) return send(res, 400, { error: 'Enter a task title and valid project' });
      const task = { id: randomUUID(), title: b.title.trim(), projectId: b.projectId, status: 'todo', created: new Date().toISOString() };
      await updateState(s => s.tasks.unshift(task)); return send(res, 201, task);
    }
    if (url.pathname.startsWith('/api/tasks/') && ['PATCH', 'DELETE'].includes(req.method)) {
      const id = url.pathname.split('/').pop(), b = req.method === 'PATCH' ? await body(req) : {};
      if (!state.tasks.some(t => t.id === id)) return send(res, 404, { error: 'Task not found' });
      if(req.method==='DELETE'&&runtime.list().some(r=>r.taskId===id&&['running','stopping'].includes(r.status)))return send(res,409,{error:'Stop the active Claude run before deleting this task.'});
      if (req.method === 'PATCH' && !['todo','doing','done'].includes(b.status)) return send(res, 400, { error: 'Invalid task status' });
      await updateState(s => { if (req.method === 'DELETE') s.tasks = s.tasks.filter(t => t.id !== id); else s.tasks.find(t => t.id === id).status = b.status; }); return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/pins' && req.method === 'POST') {
      const b = await body(req); if (documents.get(b.id)?.kind !== 'skill' && !state.entries.some(e => e.id === b.id && e.kind === 'skill')) return send(res, 404, { error: 'Skill not found' });
      await updateState(s => { s.pins = s.pins.includes(b.id) ? s.pins.filter(id => id !== b.id) : [...s.pins, b.id]; }); return send(res, 200, { pins: state.pins });
    }
    if (url.pathname === '/api/entries' && req.method === 'POST') {
      const b = await body(req);
      if (!['memory','skill'].includes(b.kind) || typeof b.title !== 'string' || !b.title.trim() || b.title.length > 300 || typeof b.content !== 'string' || !b.content.trim() || !projectValid(b.projectId)) return send(res, 400, { error: 'Enter a title, content, and valid project' });
      const entry = { id: randomUUID(), title: b.title.trim(), content: b.content, kind: b.kind, projectId: b.projectId, modified: new Date().toISOString(), source: 'AgenticOS', description: b.content.slice(0, 200) };
      await updateState(s => s.entries.unshift(entry)); return send(res, 201, entry);
    }
    if (url.pathname.startsWith('/api/entries/') && ['PATCH','DELETE'].includes(req.method)) {
      const id = url.pathname.split('/').pop(); if (!state.entries.some(e => e.id === id)) return send(res, 404, { error: 'Entry not found' });
      const b = req.method === 'PATCH' ? await body(req) : {};
      if (req.method === 'PATCH' && (typeof b.title !== 'string' || !b.title.trim() || b.title.length > 300 || typeof b.content !== 'string' || !b.content.trim())) return send(res, 400, { error: 'Enter a title and content' });
      await updateState(s => { if (req.method === 'DELETE') { s.entries = s.entries.filter(e => e.id !== id); s.pins = s.pins.filter(p => p !== id); } else Object.assign(s.entries.find(e => e.id === id), { title: b.title.trim(), content: b.content, description: b.content.slice(0,200), modified: new Date().toISOString() }); }); return send(res, 200, { ok: true });
    }
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Endpoint not found' });
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
    const assets = { '/': ['index.html','text/html'], '/live-status.js': ['live-status.js','text/javascript'], '/workspace-map.js': ['workspace-map.js','text/javascript'], '/memory-graph.js': ['memory-graph.js','text/javascript'], '/graph.css': ['graph.css','text/css'], '/app.js': ['app.js','text/javascript'], '/claude-ui.js': ['claude-ui.js','text/javascript'], '/theme.js': ['theme.js','text/javascript'], '/styles.css': ['styles.css','text/css'], '/theme.css': ['theme.css','text/css'], '/favicon.svg': ['favicon.svg','image/svg+xml'] };
    const asset = assets[url.pathname]; if (!asset) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8`, 'Cache-Control': 'no-cache' }); res.end(await fs.readFile(path.join(ROOT,'public',asset[0])));
  } catch (e) { send(res, e.statusCode || 400, { error: e.message }); }
});
server.listen(port, '127.0.0.1', () => console.log(`AgenticOS: http://127.0.0.1:${port}`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{runtime.shutdown();server.close(()=>process.exit(0));});
