import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const origin = 'http://127.0.0.1:4311';
let child, dataDir, workspace;
async function request(route, method = 'GET', payload, headers = {}) {
  const res = await fetch(origin+route, { method, headers: { ...(payload ? {'Content-Type':'application/json'} : {}), ...headers }, body: payload ? JSON.stringify(payload) : undefined });
  return { status: res.status, data: await res.json() };
}
async function startServer() {
  child = spawn(process.execPath, ['server.mjs'], { cwd:root, env:{...process.env, PORT:'4311',AGENTIC_OS_DATA_DIR:dataDir,AGENTIC_OS_CONFIG:path.join(dataDir,'config.json')}, windowsHide:true, stdio:['ignore','pipe','pipe'] });
  await new Promise((resolve,reject) => { child.stdout.on('data', chunk=>{if(String(chunk).includes('AgenticOS:'))resolve();});child.once('error',reject);child.once('exit',code=>reject(new Error(`Server exited: ${code}`))); });
}
before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(),'agenticos-test-'));
  const projects=[];
  for(const [id,name] of [['invoice-ocr','Invoice OCR'],['tango','TanGO'],['tangov3','TanGO V3']]) {
    const folder=path.join(dataDir,'projects',id);await mkdir(folder,{recursive:true});
    const memoryFolder=id;const memory=path.join(dataDir,'memories',memoryFolder,'memory');await mkdir(memory,{recursive:true});
    await writeFile(path.join(memory,'MEMORY.md'),'# Test project memory\nA local test note.');
    projects.push({id,name,path:folder,memoryFolder,color:'blue',initials:'TP',description:'Fixture project'});
  }
  await writeFile(path.join(dataDir,'config.json'),JSON.stringify({port:4311,claudeExecutable:process.execPath,memoryRoot:path.join(dataDir,'memories'),projects}));
  await startServer();
  workspace = (await request('/api/workspace')).data;
}, { timeout: 120000 });
after(async () => { if(child && child.exitCode===null) {const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;} if(dataDir)await rm(dataDir,{recursive:true,force:true}); });

test('indexes all configured projects and exposes only registered documents', async () => {
  assert.deepEqual(workspace.projects.map(p=>p.id),['invoice-ocr','tango','tangov3']);
  assert.equal((await request('/api/document/not-a-registered-document')).status,404);
  assert.equal((await request('/api/document/..%2fconfig.json')).status,404);
  if(workspace.memory.length) {const res=await request(`/api/document/${workspace.memory[0].id}`);assert.equal(res.status,200);assert.equal(typeof res.data.content,'string');}
});
test('blocks cross-origin mutations', async () => {
  const res=await request('/api/tasks','POST',{title:'Untrusted',projectId:null},{Origin:'https://untrusted.example'});
  assert.equal(res.status,403);
  assert.equal((await request('/api/runs','POST',{taskId:'unknown'},{Origin:'https://untrusted.example'})).status,403);
  assert.equal((await request('/api/projects','POST',{name:'Untrusted',path:root},{Origin:'https://untrusted.example'})).status,403);
  assert.equal((await request('/api/workspace')).data.state.tasks.length,0);
});
test('rejects invalid Claude run requests without starting a process',async()=>{
  assert.equal((await request('/api/runs','POST',{taskId:'missing',projectId:'tangov3',prompt:'Review',mode:'read'})).status,400);
  const task=(await request('/api/tasks','POST',{title:'Run validation',projectId:'tangov3'})).data;
  for (const model of [42,{},'opus --tools Bash','--flag',' '.repeat(3),'x'.repeat(201)]) assert.equal((await request('/api/runs','POST',{taskId:task.id,projectId:'tangov3',prompt:'Review',mode:'read',model})).status,400);
  assert.equal((await request('/api/runs','POST',{taskId:task.id,projectId:'tango',prompt:'Review',mode:'read'})).status,400);
  assert.equal((await request('/api/runs','POST',{taskId:task.id,projectId:'tangov3',skillId:'missing',prompt:'Review',mode:'read'})).status,400);
  assert.equal((await request('/api/runs','POST',{taskId:task.id,projectId:'tangov3',prompt:'Review',mode:'bypassPermissions'})).status,400);
  assert.equal((await request('/api/runs')).data.length,0);
  await request(`/api/tasks/${task.id}`,'DELETE');
});
test('validates tasks and persists their lifecycle', async () => {
  assert.equal((await request('/api/tasks','POST',{title:' ',projectId:null})).status,400);
  assert.equal((await request('/api/tasks','POST',{title:'Valid',projectId:'unknown'})).status,400);
  const created=await request('/api/tasks','POST',{title:'Review project context',projectId:'tangov3'});
  assert.equal(created.status,201);
  assert.equal((await request(`/api/tasks/${created.data.id}`,'PATCH',{status:'invalid'})).status,400);
  assert.equal((await request(`/api/tasks/${created.data.id}`,'PATCH',{status:'doing'})).status,200);
  const persisted=JSON.parse(await readFile(path.join(dataDir,'workspace.json'),'utf8'));
  assert.equal(persisted.tasks[0].status,'doing');
  assert.equal((await request(`/api/tasks/${created.data.id}`,'DELETE')).status,200);
  assert.equal((await request(`/api/tasks/${created.data.id}`,'DELETE')).status,404);
});
test('creates, edits, pins, and deletes local skills independently of source files', async () => {
  const created=await request('/api/entries','POST',{kind:'skill',title:'Context review',content:'# Review\nRead project instructions first.',projectId:null});
  assert.equal(created.status,201);
  assert.equal((await request('/api/pins','POST',{id:created.data.id})).status,200);
  const changed=await request(`/api/entries/${created.data.id}`,'PATCH',{title:'Context review updated',content:'Check the project memory.'});
  assert.equal(changed.status,200);
  const saved=(await request('/api/workspace')).data.state;
  assert.equal(saved.entries[0].title,'Context review updated');
  assert.ok(saved.pins.includes(created.data.id));
  assert.equal((await request(`/api/entries/${created.data.id}`,'DELETE')).status,200);
  const final=(await request('/api/workspace')).data.state;
  assert.equal(final.entries.length,0);assert.equal(final.pins.length,0);
});
test('cannot edit or delete indexed Claude memory using workspace endpoints', async () => {
  if(!workspace.memory.length)return;
  const item=workspace.memory[0], before=await readFile(item.path,'utf8');
  assert.equal((await request(`/api/entries/${item.id}`,'PATCH',{title:'Overwrite',content:'Overwrite'})).status,404);
  assert.equal((await request(`/api/entries/${item.id}`,'DELETE')).status,404);
  assert.equal((await request('/api/pins','POST',{id:item.id})).status,404);
  assert.equal(await readFile(item.path,'utf8'),before);
});
test('connects an existing project, rejects invalid and duplicate folders, and survives restart',async()=>{
  const configBefore=await readFile(path.join(dataDir,'config.json'),'utf8');
  const folder=path.join(dataDir,'Existing project'),skillFolder=path.join(folder,'.claude','skills','project-review');
  await mkdir(skillFolder,{recursive:true});
  await writeFile(path.join(folder,'CLAUDE.md'),'# Project instructions\nUse this project context.');
  await writeFile(path.join(skillFolder,'SKILL.md'),'---\nname: project-review\ndescription: Review this project\n---\n# Review\nRead the code.');
  const input={name:'TanGO',path:folder,description:'Existing project fixture'};
  assert.equal((await request('/api/projects','POST',{...input,path:'relative-folder'})).status,400);
  assert.equal((await request('/api/projects','POST',{...input,path:path.join(dataDir,'missing')})).status,400);
  assert.equal((await request('/api/projects','POST',{...input,path:path.join(root,'README.md')})).status,400);
  assert.equal((await request('/api/projects','POST',{...input,memoryFolder:'../escape'})).status,400);
  const created=await request('/api/projects','POST',input);
  assert.equal(created.status,201);assert.equal(created.data.id,'tango-2');
  assert.equal((await request('/api/projects','POST',input)).status,409);
  assert.equal((await request('/api/projects','POST',{...input,path:folder+path.sep})).status,409);
  const updated=(await request('/api/workspace')).data;
  assert.equal(updated.projects.length,4);
  const p=updated.projects.find(p=>p.id===created.data.id);assert.equal(p.instructions.length,1);
  assert.ok(updated.skills.some(s=>s.title==='project-review'&&s.projectId===p.id));
  const task=await request('/api/tasks','POST',{title:'New project task',projectId:p.id});assert.equal(task.status,201);
  await request(`/api/tasks/${task.data.id}`,'DELETE');
  const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;
  await startServer();
  const reloaded=(await request('/api/workspace')).data;
  assert.ok(reloaded.projects.some(p=>p.id===created.data.id&&p.path===created.data.path));
  assert.equal(await readFile(path.join(dataDir,'config.json'),'utf8'),configBefore);
  assert.equal(await readFile(path.join(folder,'CLAUDE.md'),'utf8'),'# Project instructions\nUse this project context.');
});
