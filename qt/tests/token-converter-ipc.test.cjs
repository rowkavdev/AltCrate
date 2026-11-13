const test=require('node:test'),assert=require('node:assert/strict');
let registerTokenConverterIpc;try{({registerTokenConverterIpc}=require('../engine/tokenConverterIpc.cjs'));}catch{}
test('converter IPC rejects other windows and invalid operation ids',async()=>{
  assert.equal(typeof registerTokenConverterIpc,'function');const handlers=new Map();let sent=0;
  registerTokenConverterIpc({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},service:{status:()=>({phase:'idle'}),start:async()=>{sent++;},stop(){},verify(){},cancel(){},acknowledge(){}},validateSender:event=>{if(event.sender!=='main')throw Error('Pedido inválido');}});
  await assert.rejects(async()=>handlers.get('converter:start')({sender:'other'},{}));assert.equal(sent,0);
  await handlers.get('converter:start')({sender:'main'},{});assert.equal(sent,1);
  for(const id of [null,3,'','x'.repeat(101)])await assert.rejects(async()=>handlers.get('converter:cancel')({sender:'main'},id));
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
