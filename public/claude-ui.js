const active = status => ['running','stopping'].includes(status);
const statusText = status => ({ running:'Running', stopping:'Stopping', completed:'Completed', failed:'Failed', cancelled:'Cancelled', interrupted:'Interrupted', needs_permission:'Needs permission' }[status] || status);
const escape = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function taskRunControls(task, runtime) {
  const runs=runtime?.runs.filter(r=>r.taskId===task.id) || [], latest=runs[0];
  return `<div class="task-run-controls"><button class="button secondary" data-run-task="${task.id}" ${!runtime?.available || runs.some(r=>active(r.status))?'disabled':''}>Run Claude</button>${latest?`<button class="text-button" data-open-run="${latest.id}">${escape(statusText(latest.status))} · View output</button>`:''}</div>`;
}
export function runHistory(runtime, projectId) {
  const runs=(runtime?.runs || []).filter(r=>projectId==='all'||r.projectId===projectId);
  return `<section class="run-history"><div class="section-heading"><h2>Claude runs</h2><span class="subtle">${runtime?.available?'Claude CLI connected':'Claude CLI unavailable'}</span></div>${runs.length?`<div class="memory-list">${runs.slice(0,20).map(r=>`<button class="run-row" data-open-run="${r.id}"><span class="run-status ${r.status}">${escape(statusText(r.status))}</span><span class="run-row-title"><strong>${escape(r.taskTitle)}</strong><small>${escape(r.projectName)}${r.skillTitle?' / '+escape(r.skillTitle):''} · ${escape(r.model || r.requestedModel || 'Claude default')}</small></span><time>${escape(new Date(r.started).toLocaleString('en-NZ',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}))}</time><span>↗</span></button>`).join('')}</div>`:'<div class="panel"><p>No runs yet. Add a task, then choose Run Claude.</p></div>'}</section>`;
}
export function setupClaudeUI({ api, getData, load, render, toast }) {
  const dialog=document.querySelector('#run-dialog'), content=document.querySelector('#run-content');
  let task, selectedProject, viewerId, timer, historyTimer;
  const skills = projectId => [...getData().skills, ...getData().state.entries.filter(e=>e.kind==='skill')].filter(s=>s.projectId===projectId);
  function skillOptions() {
    const field=content.querySelector('[name=skillId]');
    field.innerHTML='<option value="">No skill — use project instructions</option>'+skills(selectedProject).map(s=>`<option value="${s.id}">${escape(s.title)} (${escape(s.source)})</option>`).join('');
  }
  function openForm(taskId) {
    task=getData().state.tasks.find(t=>t.id===taskId);if(!task)return;if(!getData().projects.length){toast('Add a project before running Claude.');return;}
    viewerId=null;clearTimeout(timer);selectedProject=task.projectId || getData().projects[0].id;
    content.innerHTML=`<form id="run-form"><div class="dialog-heading"><div><span class="subtle">Claude Code</span><h2>Run this task</h2></div><button type="button" class="icon-button close-dialog" aria-label="Close">×</button></div><p class="run-task-title">${escape(task.title)}</p><label>Project<select name="projectId" ${task.projectId?'disabled':''}>${getData().projects.map(p=>`<option value="${p.id}" ${p.id===selectedProject?'selected':''}>${escape(p.name)}</option>`).join('')}</select></label><label>Skill<select name="skillId"></select></label><label>Model<select name="model"><option value="">Claude default</option><option value="sonnet">Sonnet</option><option value="opus">Opus</option><option value="haiku">Haiku</option><option value="custom">Custom model ID</option></select></label><label id="custom-model-field" hidden>Model ID<input name="customModel" maxlength="200" placeholder="Enter a model ID or provider alias" autocomplete="off" spellcheck="false"></label><p class="form-help">Claude default uses your configured model. Availability depends on your Claude account or provider.</p><label>Task instructions<textarea name="prompt" required maxlength="20000" rows="6">${escape(task.title)}</textarea></label><label>Tool access<select name="mode"><option value="read">Read only</option><option value="project">Project permissions (may edit files)</option></select></label><p class="form-help" id="mode-help">Claude can read and search files and follow the chosen skill. Editing and shell commands are unavailable in this mode.</p><div class="form-actions"><button type="button" class="button secondary close-dialog">Cancel</button><button type="submit" class="button primary">Run Claude</button></div></form>`;
    skillOptions();dialog.showModal();
  }
  function viewRun(run) {
    const isActive=active(run.status);
    content.innerHTML=`<div class="dialog-heading"><div><span class="subtle">${escape(run.projectName)} / Claude Code</span><h2>${escape(run.taskTitle)}</h2></div><button type="button" class="icon-button close-dialog" aria-label="Close">×</button></div><div class="run-meta"><span class="run-status ${run.status}">${escape(statusText(run.status))}</span><span>${run.mode==='read'?'Read only':'Project permissions'}</span><span>Model: ${escape(run.model || run.requestedModel || 'Claude default')}</span>${run.skillTitle?`<span>Skill: ${escape(run.skillTitle)}</span>`:''}</div>${run.error?`<div class="run-error">${escape(run.error)}</div>`:''}${run.permissionDenials?.length?`<div class="run-error">Claude needs permission for ${escape([...new Set(run.permissionDenials.map(d=>d.tool_name || 'a tool'))].join(', '))}. This run cannot approve interactive requests. Use Claude in your terminal or adjust the allowed project permissions before running again.</div>`:''}<div class="run-output" id="run-output" role="log" aria-live="polite">${escape(run.output || (isActive?'Starting Claude…':'No text output was returned.'))}</div><details class="run-activity"><summary>Tool activity & diagnostics</summary><pre>${escape((run.events || []).map(e=>e.text).join('\n'))}${run.stderr?'\n\n'+escape(run.stderr):''}</pre></details><div class="detail-footer"><span class="subtle">${run.model?escape(run.model):'claude -p'}${run.sessionId?' / Session '+escape(run.sessionId):''}</span><div><button class="button secondary" data-copy-run="${run.id}">Copy output</button>${isActive?`<button class="button danger" data-stop-run="${run.id}" ${run.status==='stopping'?'disabled':''}>Stop run</button>`:''}</div></div>`;
  }
  async function poll() {
    const id=viewerId;if(!id||!dialog.open)return;
    try {
      const run=await api(`/api/runs/${id}`);if(viewerId!==id||!dialog.open)return;
      const output=content.querySelector('#run-output'), scroll=output?.scrollTop || 0, nearEnd=!output || output.scrollHeight-output.clientHeight-scroll<50;
      const detailsOpen=content.querySelector('details')?.open;const focused=document.activeElement?.dataset.stopRun;
      viewRun(run);const next=content.querySelector('#run-output');next.scrollTop=nearEnd?next.scrollHeight:scroll;
      content.querySelector('details').open=!!detailsOpen;if(focused)content.querySelector('[data-stop-run]')?.focus();
      if(active(run.status))timer=setTimeout(poll,1000);else await load();
    } catch(e) {toast(e.message);if(dialog.open)timer=setTimeout(poll,3000);}
  }
  async function openRun(id) {clearTimeout(timer);viewerId=id;content.innerHTML='<div class="loading">Loading run output…</div>';if(!dialog.open)dialog.showModal();await poll();}
  document.addEventListener('click',async e=>{
    const b=e.target.closest('button');if(!b)return;
    try {
      if(b.dataset.runTask)openForm(b.dataset.runTask);
      if(b.dataset.openRun)await openRun(b.dataset.openRun);
      if(b.dataset.stopRun){b.disabled=true;await api(`/api/runs/${b.dataset.stopRun}/cancel`,'POST');clearTimeout(timer);await poll();}
      if(b.dataset.copyRun){const run=await api(`/api/runs/${b.dataset.copyRun}`);await navigator.clipboard.writeText(run.output);toast('Output copied');}
    }catch(e){toast(e.message);b.disabled=false;}
  });
  content.addEventListener('change',e=>{
    if(e.target.name==='projectId'){selectedProject=e.target.value;skillOptions();}
    if(e.target.name==='model'){const custom=e.target.value==='custom';content.querySelector('#custom-model-field').hidden=!custom;content.querySelector('[name=customModel]').required=custom;if(custom)content.querySelector('[name=customModel]').focus();}
    if(e.target.name==='mode')content.querySelector('#mode-help').textContent=e.target.value==='read'?'Claude can read and search files and follow the chosen skill. Editing and shell commands are unavailable in this mode.':'Uses existing Claude permissions. Allowed tools may change project files. Requests requiring interactive approval are denied and reported in the output.';
  });
  content.addEventListener('submit',async e=>{
    if(e.target.id!=='run-form')return;e.preventDefault();const form=e.target,button=form.querySelector('[type=submit]');button.disabled=true;
    try {const fields=form.elements;if(fields.model.value==='custom'&&!fields.customModel.value.trim())throw new Error('Enter a custom model ID.');const run=await api('/api/runs','POST',{taskId:task.id,projectId:fields.projectId.value,skillId:fields.skillId.value || null,prompt:fields.prompt.value,mode:fields.mode.value,model:fields.model.value==='custom'?fields.customModel.value.trim():fields.model.value||null});await load();await openRun(run.id);}catch(err){toast(err.message);button.disabled=false;}
  });
  dialog.addEventListener('close',()=>{clearTimeout(timer);viewerId=null;});
  async function updateHistory() {
    const data=getData();if(data?.runtime?.runs.some(r=>active(r.status)))try{const next=await api('/api/runs');if(JSON.stringify(next)!==JSON.stringify(data.runtime.runs)){data.runtime.runs=next;render();}}catch{};
    historyTimer=setTimeout(updateHistory,2500);
  }
  updateHistory();window.addEventListener('pagehide',()=>{clearTimeout(timer);clearTimeout(historyTimer);});
}
