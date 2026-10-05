import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchLiveStatus } from '../public/live-status.js';

test('channel failure does not discard a successful session check',async()=>{
  const sessions={available:true,counts:{tango:{total:1,working:1,idle:0}}};
  const result=await fetchLiveStatus(async route=>{if(route==='/api/channels')throw new Error('Channel unavailable');return sessions;});
  assert.equal(result.sessions.status,'fulfilled');assert.equal(result.sessions.value,sessions);assert.equal(result.channels.status,'rejected');
});
test('session failure still permits channel updates',async()=>{
  const result=await fetchLiveStatus(async route=>{if(route==='/api/sessions')throw new Error('Server unavailable');return [{id:'channel',status:'listening'}];});
  assert.equal(result.sessions.status,'rejected');assert.equal(result.channels.status,'fulfilled');
});
