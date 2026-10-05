import test from 'node:test';
import assert from 'node:assert/strict';
import { projectSessions, createSessionDiscovery, readRegisteredSessions } from '../claude-sessions.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const projects=[{id:'a',path:'C:\\Development\\TanGO'},{id:'b',path:'C:\\Development\\TanGOV3'},{id:'nested',path:'C:\\Development\\TanGO\\nested'}];
test('counts terminal sessions by their most specific project and keeps idle distinct',()=>{
  const result=projectSessions(projects,[
    {pid:1,cwd:'c:/development/tango',status:'idle',kind:'interactive'},
    {pid:2,cwd:'C:\\Development\\TanGOV3\\src',status:'running'},
    {pid:3,cwd:'C:\\Development\\TanGO\\nested\\src',status:'idle'},
    {pid:4,cwd:'C:\\Development\\TanGO-other',status:'running'},
    {pid:5,cwd:'C:\\Development\\TanGO',status:'completed'},
    {pid:1,cwd:'C:\\Development\\TanGO',status:'idle'}
  ],[]);
  assert.deepEqual(result.counts,{a:{total:1,idle:1,working:0},b:{total:1,idle:0,working:1},nested:{total:1,idle:1,working:0}});
});
test('merges owned runs without counting the same process or session twice',()=>{
  const result=projectSessions(projects,[{pid:12,cwd:projects[0].path,status:'idle',sessionId:'s'},{pid:13,cwd:projects[1].path,status:'running',sessionId:'other'}],[
    {id:'r1',projectId:'a',pid:12,sessionId:'s',status:'running',taskTitle:'Review'},
    {id:'r2',projectId:'b',sessionId:'other',status:'stopping',taskTitle:'Build'},
    {id:'r3',projectId:'a',status:'running',taskTitle:'Starting'},
    {id:'r4',projectId:'a',status:'completed'}
  ]);
  assert.equal(result.sessions.length,3);assert.equal(result.counts.a.total,2);assert.equal(result.counts.a.working,2);
  assert.equal(result.sessions[0].source,'AgenticOS');assert.equal(result.sessions[1].status,'stopping');
});
test('caches CLI discovery but merges the current run state on every call',async()=>{
  let calls=0;const discover=createSessionDiscovery('cli',async()=>{calls++;return{stdout:'[]'};});
  const [first,second]=await Promise.all([discover(projects,[]),discover(projects,[])]);
  assert.equal(calls,1);assert.equal(first.available,true);assert.deepEqual(first,second);
  const next=await discover(projects,[{id:'r',projectId:'a',status:'running'}]);assert.equal(next.counts.a.total,1);assert.equal(calls,1);
});
test('discovery failure is explicit and still counts owned runs',async()=>{
  const discover=createSessionDiscovery('cli',async()=>{throw new Error('unsupported');});
  const result=await discover(projects,[{id:'r',projectId:'a',status:'running'}]);
  assert.equal(result.available,false);assert.match(result.error,/unavailable/);assert.equal(result.counts.a.total,1);
});

test('includes a verified registry session omitted by the CLI and deduplicates overlaps',async()=>{
  const discover=createSessionDiscovery('cli',async()=>({stdout:JSON.stringify([{pid:1,cwd:projects[0].path,status:'idle'}])}),async()=>[
    {pid:1,cwd:projects[0].path,status:'idle'},
    {pid:2,cwd:projects[1].path,status:'busy',name:'VS Code session'}
  ]);
  const result=await discover(projects,[]);
  assert.equal(result.counts.a.total,1);
  assert.equal(result.counts.b.total,1);
  assert.equal(result.counts.b.working,1);
});

test('registry fallback excludes closed and reused processes and returns only display metadata',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'agenticos-sessions-'));
  try {
    for(const [pid,procStart] of [[12,'birth-12'],[13,'old-birth'],[14,'closed']])await writeFile(path.join(directory,`${pid}.json`),JSON.stringify({pid,procStart,cwd:projects[1].path,status:'busy',sessionId:'session-'+pid,messagingSocketPath:'private',peerFeatures:['private']}));
    await writeFile(path.join(directory,'15.json'),'invalid JSON');
    await writeFile(path.join(directory,'12.secret.key'),'do not read');
    const sessions=await readRegisteredSessions(directory,async()=>[{pid:12,procStart:'birth-12'},{pid:13,procStart:'new-birth'}]);
    assert.equal(sessions.length,1);assert.equal(sessions[0].pid,12);assert.equal(sessions[0].source,'Claude registry');
    assert.equal('messagingSocketPath' in sessions[0],false);assert.equal('peerFeatures' in sessions[0],false);
  }finally{await rm(directory,{recursive:true,force:true});}
});
