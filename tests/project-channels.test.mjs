import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { scanProjectChannels, channelHealth } from '../project-channels.mjs';

test('indexes project channel manifests without exposing private configuration',async()=>{
  const root=await fs.mkdtemp(path.join(tmpdir(),'agenticos-channels-'));
  try {
    const folder=path.join(root,'.claude','channels','ado-ready');await fs.mkdir(path.join(folder,'.claude-plugin'),{recursive:true});
    await fs.writeFile(path.join(folder,'.claude-plugin','plugin.json'),JSON.stringify({name:'ado-ready',description:'ADO events',version:'1.0',secret:'private'}));
    await fs.writeFile(path.join(folder,'.env'),'SECRET=private');
    const channels=await scanProjectChannels({id:'tango',path:root});
    assert.equal(channels.length,1);assert.equal(channels[0].name,'ado-ready');assert.equal(channels[0].projectId,'tango');assert.equal('secret' in channels[0],false);
    assert.equal(channels[0].readme,path.join(folder,'README.md'));
    assert.deepEqual(await scanProjectChannels({id:'none',path:path.join(root,'absent')}),[]);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('health only probes configured local ports and requires matching channel identity',async()=>{
  const channels=[{id:'a',projectId:'tango',folderName:'ado-ready',name:'ado-ready'},{id:'b',projectId:'tango',folderName:'other',name:'other'}];
  let calls=0;
  const status=await channelHealth(channels,{'tango:ado-ready':{port:8788}},async(url,options)=>{calls++;assert.equal(url,'http://127.0.0.1:8788/health');assert.equal(options.redirect,'error');return{ok:true,json:async()=>({ok:true,channel:'ado-ready'})};});
  assert.equal(calls,1);assert.equal(status[0].status,'listening');assert.equal(status[1].status,'installed');
  const wrong=await channelHealth([channels[0]],{'tango:ado-ready':{port:8788}},async()=>({ok:true,json:async()=>({ok:true,channel:'another'})}));assert.equal(wrong[0].status,'unreachable');
  const stopped=await channelHealth([channels[0]],{'tango:ado-ready':{port:8788}},async()=>{throw new Error('offline');});assert.equal(stopped[0].status,'unreachable');
});
