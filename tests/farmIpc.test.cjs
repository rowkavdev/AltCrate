const test = require('node:test');
const assert = require('node:assert/strict');
const { registerFarmIpc } = require('../electron/farmIpc.cjs');

test('farm IPC starts one runner and legacy IPC cannot start another', async () => {
  const handlers = new Map();
  const calls = [];
  const farm = {
    status: () => ({phase:'running',accounts:[]}),
    start: (ids) => {calls.push(ids); return new Promise(() => {});},
    stop: () => ({phase:'stopping'}),
    setModes: async () => ({}), pause: async () => ({}), resume: async () => ({}),
  };
  registerFarmIpc({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},farm,emit:()=>{}});
  assert.deepEqual(await handlers.get('farm:start')(null,['a']),farm.status());
  assert.deepEqual(calls,[['a']]);
  assert.equal(handlers.has('run:start'),false);
});
test('automatic server setup uses the trusted sender, validated profile and operation interlock',async()=>{const handlers=new Map(),calls=[];const bridge=registerFarmIpc({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},farm:{configuration:()=>({})},setupServer:async profile=>{calls.push(profile);return {installed:true};},serverProfile:input=>({...input,validated:true}),validateSender:event=>{if(event.sender!=='main')throw Error('invalid sender');},beforeStart:()=>{calls.push('guard');}});await assert.rejects(async()=>handlers.get('farm:server-setup')({sender:'other'},{}));const result=await handlers.get('farm:server-setup')({sender:'main'},{host:'home.example'});assert.equal(result.installed,true);assert.deepEqual(calls,['guard',{host:'home.example',validated:true}]);assert.equal(bridge.busy(),false);});
