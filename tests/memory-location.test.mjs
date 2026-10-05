import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { encodedProjectPath, resolveMemoryFolder } from '../memory-location.mjs';

test('nested projects find repository memory, preserving exact and manual mappings',async()=>{
  const temp=await fs.mkdtemp(path.join(tmpdir(),'agenticos-memory-'));
  try {
    const memoryRoot=path.join(temp,'memories'),repositoryRoot=path.join(temp,'Repo'),projectPath=path.join(repositoryRoot,'App');
    const repositoryFolder=encodedProjectPath(repositoryRoot),memoryFolder=encodedProjectPath(projectPath);
    await fs.mkdir(path.join(memoryRoot,repositoryFolder,'memory'),{recursive:true});
    const input={projectPath,memoryRoot,memoryFolder,repositoryRoot};
    assert.equal(await resolveMemoryFolder(input),repositoryFolder);
    assert.equal(await resolveMemoryFolder({...input,memoryMapping:'auto'}),repositoryFolder);
    assert.equal(await resolveMemoryFolder({...input,memoryMapping:'manual'}),memoryFolder);
    assert.equal(await resolveMemoryFolder({...input,memoryFolder:'Custom'}),'Custom');
    assert.equal(await resolveMemoryFolder({...input,repositoryRoot:path.join(temp,'Other')}),memoryFolder);
    await fs.mkdir(path.join(memoryRoot,memoryFolder,'memory'),{recursive:true});
    assert.equal(await resolveMemoryFolder(input),memoryFolder);
  }finally{await fs.rm(temp,{recursive:true,force:true});}
});

test('does not search beyond the repository root into unrelated memories',async()=>{
  const temp=await fs.mkdtemp(path.join(tmpdir(),'agenticos-memory-'));
  try {
    const memoryRoot=path.join(temp,'memories'),repositoryRoot=path.join(temp,'Repo'),projectPath=path.join(repositoryRoot,'App'),memoryFolder=encodedProjectPath(projectPath);
    await fs.mkdir(path.join(memoryRoot,encodedProjectPath(temp),'memory'),{recursive:true});
    assert.equal(await resolveMemoryFolder({memoryRoot,repositoryRoot,projectPath,memoryFolder}),memoryFolder);
  }finally{await fs.rm(temp,{recursive:true,force:true});}
});
