import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRunManager, claudeArgs, runPrompt } from '../claude-runtime.mjs';
const fixture=fileURLToPath(new URL('./fixtures/claude.mjs',import.meta.url));
async function until(fn) {const end=Date.now()+10000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,20));}throw new Error('Timed out waiting for run');}
async function waitForStatus(manager,id,status) {
  try {
    await until(()=>{
      const run=manager.get(id);
      if(!['running','stopping',status].includes(run.status))assert.fail(`Expected ${status}: ${JSON.stringify(run)}`);
      return run.status===status;
    });
  } catch(error) {
    error.message+=`\nRun state: ${JSON.stringify(manager.get(id))}`;
    throw error;
  }
}
test('launches directly, streams split UTF-8 JSON, and saves the result',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'agenticos-runtime-'));let captured,manager;
  try {
    manager=await createRunManager({directory:dir,executable:'configured-cli',launch:(exe,args,options)=>{captured={exe,args,options};return spawn(process.execPath,[fixture],options);}});
    const run=await manager.start({task:{id:'task',title:'Review'},project:{id:'project',name:'Project',path:dir},prompt:'A prompt with "quotes", $(), and shell characters & |',mode:'read',model:'sonnet'});
    await waitForStatus(manager,run.id,'completed');
    assert.equal(captured.exe,'configured-cli');assert.equal(captured.options.shell,false);assert.equal(captured.options.cwd,dir);
    assert.ok(captured.args.includes('-p'));assert.ok(captured.args.includes('Read,Glob,Grep,Skill'));assert.ok(!captured.args.includes('--dangerously-skip-permissions'));
    assert.equal(captured.args[captured.args.indexOf('--model')+1],'sonnet');
    assert.equal(manager.get(run.id).requestedModel,'sonnet');
    const final=manager.get(run.id);assert.equal(final.output,'Project result ✓');assert.equal(final.sessionId,'fixture-session');assert.ok(final.events.some(e=>e.text.includes('Read')));
    await until(async()=>{try{return JSON.parse(await readFile(path.join(dir,run.id+'.json'),'utf8')).status==='completed';}catch{return false;}});
    assert.equal(JSON.parse(await readFile(path.join(dir,run.id+'.json'),'utf8')).requestedModel,'sonnet');
  } finally {manager?.shutdown();await rm(dir,{recursive:true,force:true});}
});

test('model selection preserves the configured default and accepts aliases or IDs as one argument',()=>{
  assert.ok(!claudeArgs('read').includes('--model'));
  assert.ok(!claudeArgs('project',null).includes('--model'));
  for(const model of ['opus','haiku','claude-custom-model','sonnet[1m]','provider/model-v1']) {
    const args=claudeArgs('project',model);assert.equal(args[args.indexOf('--model')+1],model);
  }
  for(const model of ['--dangerously-skip-permissions','sonnet --tools Bash','$(whoami)',{},42,'x'.repeat(201)])assert.throws(()=>claudeArgs('read',model),/valid model/);
});
test('reports permission denials and CLI errors rather than claiming success',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'agenticos-runtime-'));let manager;
  try {
    manager=await createRunManager({directory:dir,executable:'fixture',launch:(_exe,_args,options)=>spawn(process.execPath,[fixture],options)});
    for(const [prompt,status] of [['fixture:denied','needs_permission'],['fixture:error','failed']]){
      const r=await manager.start({task:{id:prompt,title:prompt},project:{id:'project',name:'Project',path:dir},prompt,mode:'project'});
      await waitForStatus(manager,r.id,status);
      if(status==='failed')assert.match(manager.get(r.id).error,/Authentication failed/);
    }
  } finally {manager?.shutdown();await new Promise(r=>setTimeout(r,100));await rm(dir,{recursive:true,force:true});}
});
test('rejects overlapping project runs, cancels owned processes, and recovers interrupted runs',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'agenticos-runtime-'));let manager;
  try {
    manager=await createRunManager({directory:dir,executable:'fixture',launch:(_exe,_args,options)=>spawn(process.execPath,[fixture],options)});
    const request={task:{id:'task',title:'Slow'},project:{id:'project',name:'Project',path:dir},prompt:'fixture:slow',mode:'read'};
    const run=await manager.start(request);
    await assert.rejects(manager.start(request),/already active/);
    const reopened=await createRunManager({directory:dir,executable:'fixture'});
    assert.equal(reopened.get(run.id).status,'interrupted');
    await manager.cancel(run.id);await waitForStatus(manager,run.id,'cancelled');
  } finally {manager?.shutdown();await new Promise(r=>setTimeout(r,100));await rm(dir,{recursive:true,force:true});}
});
test('supplies exact selected skill and project context without interpreting prompt as flags',()=>{
  const prompt=runPrompt({project:{name:'TanGO',path:'C:\\Development\\TanGO'},task:{title:'Review'},prompt:'--dangerously-skip-permissions is text',skill:{path:'C:\\Development\\TanGO\\.claude\\skills\\review\\SKILL.md'},instructions:[{path:'CLAUDE.md'}],memories:[{title:'Decision',path:'memory.md'}]});
  assert.match(prompt,/SKILL\.md/);assert.match(prompt,/CLAUDE\.md/);assert.match(prompt,/memory\.md/);
  assert.ok(!claudeArgs('project').includes('--dangerously-skip-permissions'));
});
