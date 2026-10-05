import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadWorkspaceConfig } from '../workspace-config.mjs';

test('first run creates personal defaults and preserves existing configuration',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'agenticos-config-'));
  try {
    const file=path.join(directory,'config.json');
    const first=await loadWorkspaceConfig(file,{home:directory,env:{PATH:''}});
    assert.deepEqual(first.projects,[]);assert.equal(first.memoryRoot,path.join(directory,'.claude','projects'));
    const before=await fs.readFile(file,'utf8');
    const next=await loadWorkspaceConfig(file,{home:directory,env:{CLAUDE_EXECUTABLE:process.execPath}});
    assert.equal(next.claudeExecutable,process.execPath);assert.equal(await fs.readFile(file,'utf8'),before);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
