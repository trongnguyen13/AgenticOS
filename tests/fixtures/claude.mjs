let prompt='';for await(const chunk of process.stdin)prompt+=chunk;
const emit=data=>process.stdout.write(JSON.stringify(data)+'\n');
emit({type:'system',subtype:'init',session_id:'fixture-session',model:'fixture-model'});
if(prompt.includes('fixture:slow')){setInterval(()=>{},1000);}
else if(prompt.includes('fixture:error')){process.stderr.write('Authentication failed');process.exitCode=1;}
else {
  const text='Project result ✓';
  const frame=Buffer.from(JSON.stringify({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text}}})+'\n');
  for(const byte of frame)process.stdout.write(Buffer.from([byte]));
  emit({type:'assistant',message:{content:[{type:'tool_use',name:'Read',input:{file_path:'README.md'}}]}});
  const result=JSON.stringify({type:'result',is_error:false,result:text,total_cost_usd:0.01,session_id:'fixture-session',permission_denials:prompt.includes('fixture:denied')?[{tool_name:'Edit'}]:[]});
  process.stdout.write(result);
}
