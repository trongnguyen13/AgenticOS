import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';

const execute = promisify(execFile);
const normalize = value => (/^(?:[a-z]:[\\/]|\\\\)/i.test(value) ? path.win32.resolve(value).replace(/\\/g, '/') : path.resolve(value)).replace(/\/$/, '').toLowerCase();
export function projectSessions(projects, discovered, runs) {
  const sessions = [];
  for (const item of discovered) {
    if (!item || typeof item.cwd !== 'string' || !Number.isInteger(item.pid) || ['completed','failed','cancelled','interrupted'].includes(item.status)) continue;
    const cwd = normalize(item.cwd);
    const owner = projects.filter(p => cwd === normalize(p.path) || cwd.startsWith(normalize(p.path) + '/')).sort((a,b) => normalize(b.path).length-normalize(a.path).length)[0];
    if (!owner) continue;
    if (sessions.some(s => s.pid === item.pid || item.sessionId && s.sessionId === item.sessionId)) continue;
    sessions.push({projectId:owner.id,pid:item.pid,sessionId:item.sessionId || null,name:typeof item.name==='string'?item.name:'Claude session',kind:item.kind || 'session',status:item.status || 'unknown',source:item.source === 'Claude registry' ? item.source : 'Claude CLI'});
  }
  for (const run of runs.filter(r => ['running','stopping'].includes(r.status))) {
    const found = sessions.find(s => run.pid && s.pid===run.pid || run.sessionId && s.sessionId===run.sessionId);
    const info = {projectId:run.projectId,runId:run.id,name:run.taskTitle,kind:'task',status:run.status,source:'AgenticOS',model:run.model || run.requestedModel || null};
    if (found) Object.assign(found,info);
    else sessions.push({...info,pid:run.pid || null,sessionId:run.sessionId || null});
  }
  return {sessions,counts:Object.fromEntries(projects.map(p => {const list=sessions.filter(s=>s.projectId===p.id);return [p.id,{total:list.length,idle:list.filter(s=>s.status==='idle').length,working:list.filter(s=>['running','working','busy','processing'].includes(s.status)).length}];}))};
}

async function windowsClaudeProcesses() {
  if (process.platform !== 'win32') throw new Error('Windows process discovery unavailable');
  const script = "@(Get-Process -Name claude -ErrorAction SilentlyContinue | ForEach-Object { try { [pscustomobject]@{ pid=$_.Id; procStart=$_.StartTime.ToFileTimeUtc().ToString() } } catch {} }) | ConvertTo-Json -Compress";
  const powershell=path.join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const {stdout}=await execute(powershell,['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:20000,maxBuffer:1024*1024});
  const parsed=JSON.parse(stdout.trim() || '[]');
  return Array.isArray(parsed)?parsed:parsed?[parsed]:[];
}

export async function readRegisteredSessions(directory, getProcesses = windowsClaudeProcesses) {
  const [files,processes]=await Promise.all([fs.readdir(directory,{withFileTypes:true}),getProcesses()]);
  const alive=new Map(processes.map(p=>[p.pid,String(p.procStart)]));
  const items=[];
  for(const file of files) {
    if(!file.isFile() || !/^[1-9]\d*\.json$/.test(file.name))continue;
    try {
      const location=path.join(directory,file.name),stat=await fs.lstat(location);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>128000)continue;
      const record=JSON.parse(await fs.readFile(location,'utf8'));
      // A matching birth time avoids counting stale registrations after PID reuse.
      if(record.pid!==Number(file.name.slice(0,-5))||!record.procStart||!alive.has(record.pid)||String(record.procStart)!==alive.get(record.pid)||typeof record.cwd!=='string')continue;
      items.push({pid:record.pid,cwd:record.cwd,sessionId:record.sessionId,name:record.name,kind:record.kind,status:record.status,source:'Claude registry'});
    } catch { /* Closed or partially-written registrations are skipped. */ }
  }
  return items;
}

function discoveryFailure(source,error) {
  const reason=error?.killed?'timed out':error?.code==='ENOENT'?'not found':['EACCES','EPERM'].includes(error?.code)?'permission denied':error instanceof SyntaxError?'invalid session data':'check failed';
  return `${source}: ${reason}`;
}
export function createSessionDiscovery(executable, query = () => execute(executable, ['agents','--json'], {windowsHide:true,timeout:20000,maxBuffer:2*1024*1024}), registryQuery = null) {
  let cache=null, pending=null;
  return async (projects,runs) => {
    if (!cache || Date.now()-cache.time>=5000) {
      if (!pending) pending=(async()=>{try {
        const [cli,registry]=await Promise.allSettled([query().then(r=>{const parsed=JSON.parse(r.stdout);if(!Array.isArray(parsed))throw new Error('Unexpected session list');return parsed;}),registryQuery?registryQuery():Promise.reject(new Error('No registry fallback'))]);
        const available=cli.status==='fulfilled'||registry.status==='fulfilled';
        const warnings=[];
        if(cli.status==='rejected')warnings.push(discoveryFailure('Claude CLI',cli.reason));
        if(registryQuery&&registry.status==='rejected')warnings.push(discoveryFailure('Windows process check',registry.reason));
        cache={time:Date.now(),items:[...(cli.status==='fulfilled'?cli.value:[]),...(registry.status==='fulfilled'?registry.value:[])],available,warnings,error:available?null:`Claude session discovery is unavailable. ${warnings.join('; ')}. Only AgenticOS runs are counted.`};
      }finally{pending=null;}})();
      await pending;
    }
    return {...projectSessions(projects,cache.items,runs),available:cache.available,error:cache.error,warnings:cache.warnings,checkedAt:new Date(cache.time).toISOString()};
  };
}
