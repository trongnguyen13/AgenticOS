import path from 'node:path';
import fs from 'node:fs/promises';

export const encodedProjectPath = folder => folder.replace(/[^a-z0-9]/gi, '-');
export async function resolveMemoryFolder({ projectPath, memoryRoot, memoryFolder, repositoryRoot, memoryMapping }) {
  let folders=[];try{folders=await fs.readdir(memoryRoot);}catch{return memoryFolder;}
  const match=name=>folders.find(f=>f.toLowerCase()===name.toLowerCase())||name;
  const hasMemory=async folder=>{try{const stat=await fs.lstat(path.join(memoryRoot,folder,'memory'));return stat.isDirectory()&&!stat.isSymbolicLink();}catch{return false;}};
  const requested=match(memoryFolder || encodedProjectPath(projectPath));
  // Older auto-added projects did not save the mapping mode.
  const automatic=memoryMapping==='auto'||memoryMapping!=='manual'&&requested.toLowerCase()===encodedProjectPath(projectPath).toLowerCase();
  if(!automatic||await hasMemory(requested)||!repositoryRoot)return requested;
  const root=path.resolve(repositoryRoot),project=path.resolve(projectPath);
  if(project.toLowerCase()!==root.toLowerCase()&&!project.toLowerCase().startsWith(root.toLowerCase()+path.sep))return requested;
  let parent=path.dirname(project);
  while(parent.toLowerCase()===root.toLowerCase()||parent.toLowerCase().startsWith(root.toLowerCase()+path.sep)) {
    const candidate=match(encodedProjectPath(parent));
    if(await hasMemory(candidate))return candidate;
    if(parent.toLowerCase()===root.toLowerCase())break;
    parent=path.dirname(parent);
  }
  return requested;
}
