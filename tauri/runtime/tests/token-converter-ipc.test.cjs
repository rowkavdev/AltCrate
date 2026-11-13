const test=require('node:test'),assert=require('node:assert/strict');
let registerTokenConverterIpc;try{({registerTokenConverterIpc}=require('../engine/tokenConverterIpc.cjs'));}catch{}
test('converter IPC rejects other windows and invalid operation ids',async()=>{
  assert.equal(typeof registerTokenConverterIpc,'function');const handlers=new Map();let sent=0;
  registerTokenConverterIpc({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},service:{status:()=>({phase:'idle'}),start:async()=>{sent++;},stop(){},verify(){},cancel(){},acknowledge(){}},validateSender:event=>{if(event.sender!=='main')throw Error('Pedido inválido');}});
  await assert.rejects(async()=>handlers.get('converter:start')({sender:'other'},{}));assert.equal(sent,0);
  await handlers.get('converter:start')({sender:'main'},{});assert.equal(sent,1);
  for(const id of [null,3,'','x'.repeat(101)])await assert.rejects(async()=>handlers.get('converter:cancel')({sender:'main'},id));
});
test('converter review and resume validate the window and operation ID before dispatch',async()=>{
 const handlers=new Map();let reviewed=0,resumed=0;
 registerTokenConverterIpc({ipcMain:{handle:(key,fn)=>handlers.set(key,fn)},service:{prepare:async()=>{reviewed++;},resume:async()=>{resumed++;}},validateSender:e=>{if(e.sender!=='main')throw Error('Invalid sender');}});
 await assert.rejects(async()=>handlers.get('converter:prepare')({sender:'other'},{}));assert.equal(reviewed,0);
 await handlers.get('converter:prepare')({sender:'main'},{});assert.equal(reviewed,1);
 await assert.rejects(async()=>handlers.get('converter:resume')({sender:'main'},''));assert.equal(resumed,0);
 await handlers.get('converter:resume')({sender:'main'},'known-operation');assert.equal(resumed,1);
});
test('clearing previous converter results only accepts the main application window',async()=>{
 const handlers=new Map();let cleared=0;
 registerTokenConverterIpc({ipcMain:{handle:(key,fn)=>handlers.set(key,fn)},service:{clear:async()=>{cleared++;return {phase:'idle',rows:[]};}},validateSender:e=>{if(e.sender!=='main')throw Error('Invalid sender');}});
 await assert.rejects(async()=>handlers.get('converter:clear')({sender:'other'}),/sender/);assert.equal(cleared,0);
 assert.deepEqual(await handlers.get('converter:clear')({sender:'main'}),{phase:'idle',rows:[]});assert.equal(cleared,1);
});
test('farm server migration obeys the same operation guard as local starts',async()=>{
  const {registerFarmIpc}=require('../engine/farmIpc.cjs');const handlers=new Map();let migrations=0;
  registerFarmIpc({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},farm:{status:()=>({phase:'idle',accounts:[]}),migrate:async()=>{migrations++;}},beforeStart:()=>{throw Error('Conversor ativo');}});
  assert.equal(typeof handlers.get('farm:server'),'function');await assert.rejects(async()=>handlers.get('farm:server')({},['source']),/Conversor/);assert.equal(migrations,0);
});
test('farm controller exposes pending remote starts until the server replies',async()=>{
  const {registerFarmIpc}=require('../engine/farmIpc.cjs');const handlers=new Map();let reply;
  const controls=registerFarmIpc({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},farm:{status:()=>({phase:'idle',accounts:[]}),start:()=>new Promise(r=>{reply=r;})}});
  assert.equal(typeof controls?.busy,'function');await handlers.get('farm:start')({},['source']);assert.equal(controls.busy(),true);
  reply();await new Promise(r=>setImmediate(r));assert.equal(controls.busy(),false);
});
test('stopping one converter account validates its operation and calling window',async()=>{
 const handlers=new Map(),stopped=[];registerTokenConverterIpc({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},service:{stopAccount:async id=>stopped.push(id)},validateSender:event=>{if(event.sender!=='main')throw Error('Invalid sender');}});
 await assert.rejects(async()=>handlers.get('converter:stop-account')({sender:'other'},'op'));
 for(const id of [null,3,'','x'.repeat(101)])await assert.rejects(async()=>handlers.get('converter:stop-account')({sender:'main'},id));
 await handlers.get('converter:stop-account')({sender:'main'},'valid-op');assert.deepEqual(stopped,['valid-op']);
});
