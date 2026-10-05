import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export async function findClaudeExecutable(env = process.env, home = os.homedir()) {
  const windows=process.platform==='win32',name=windows?'claude.exe':'claude';
  const directories=(env.PATH||env.Path||'').split(path.delimiter).filter(Boolean);
  const candidates=[env.CLAUDE_EXECUTABLE,path.join(home,'.local','bin',name),...directories.map(d=>path.join(d,name)),
    ...directories.map(d=>path.join(d,'node_modules','@anthropic-ai','claude-code','bin',name)),
    ...(env.APPDATA?[path.join(env.APPDATA,'npm','node_modules','@anthropic-ai','claude-code','bin',name)]:[])].filter(Boolean);
  for(const candidate of candidates)try{if((await fs.stat(candidate)).isFile())return candidate;}catch{}
  return name;
}
export async function loadWorkspaceConfig(file, {home=os.homedir(),env=process.env}={}) {
  let config;
  try {config=JSON.parse(await fs.readFile(file,'utf8'));}
  catch(error){if(error.code!=='ENOENT')throw error;config={port:4310,claudeExecutable:await findClaudeExecutable(env,home),memoryRoot:path.join(env.CLAUDE_CONFIG_DIR||path.join(home,'.claude'),'projects'),projects:[],channelHealth:{}};await fs.writeFile(file,JSON.stringify(config,null,2)+'\n',{flag:'wx'});}
  config.projects ||= [];
  config.channelHealth ||= {};
  config.memoryRoot ||= path.join(env.CLAUDE_CONFIG_DIR||path.join(home,'.claude'),'projects');
  config.claudeExecutable=env.CLAUDE_EXECUTABLE || config.claudeExecutable || await findClaudeExecutable(env,home);
  return config;
}
