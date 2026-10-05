import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

async function readJson(file) {
  try {const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>128000)return null;return JSON.parse(await fs.readFile(file,'utf8'));}catch{return null;}
}
export async function scanProjectChannels(project) {
  const channels=[];
  for(const relative of ['.claude/channels','channels']) {
    const root=path.join(project.path,relative);
    let entries;try{const stat=await fs.lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink())continue;entries=await fs.readdir(root,{withFileTypes:true});}catch{continue;}
    for(const entry of entries) {
      if(!entry.isDirectory()||entry.isSymbolicLink()||entry.name.startsWith('.'))continue;
      const folder=path.join(root,entry.name);
      const manifest=await readJson(path.join(folder,'.claude-plugin','plugin.json')) || await readJson(path.join(folder,'package.json')) || {};
      const string=(value,fallback='')=>typeof value==='string'?value.slice(0,500):fallback;
      channels.push({id:createHash('sha256').update(folder.toLowerCase()).digest('hex').slice(0,20),name:string(manifest.name,entry.name),folderName:entry.name,description:string(manifest.description),version:string(manifest.version),projectId:project.id,path:folder,readme:path.join(folder,'README.md')});
    }
  }
  return channels.sort((a,b)=>a.name.localeCompare(b.name));
}

export async function channelHealth(channels, probes={}, request=fetch) {
  return Promise.all(channels.map(async channel=>{
    const port=probes[`${channel.projectId}:${channel.folderName}`]?.port;
    if(!Number.isInteger(port)||port<1||port>65535)return {id:channel.id,status:'installed'};
    try{const response=await request(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(1500),redirect:'error'});const body=await response.json();return {id:channel.id,status:response.ok&&body.ok===true&&body.channel===channel.name?'listening':'unreachable',port};}
    catch{return{id:channel.id,status:'unreachable',port};}
  }));
}
