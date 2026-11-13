const test=require('node:test'),assert=require('node:assert/strict'),{tradeFixture,result}=require('./helpers/trade-fixture.cjs'),{createInventoryActions}=require('../engine/inventoryActions.cjs');
let createInventoryTransfers;try{({createInventoryTransfers}=require('../engine/inventoryTransfers.cjs'));}catch{}
function services(f){assert.equal(typeof createInventoryTransfers,'function');const transferService=createInventoryTransfers({...f.deps,transport:f.transport});return createInventoryActions({...f.deps,transferService});}
async function start(f,s){const p=await s.prepare({kind:'transfer',ref:f.ref,destinationAccountId:'destination'});return (await s.confirm(p.previewId)).operation;}
async function startStorageMove(f,s){const p=await s.prepare({kind:'move-to-storage',ref:f.ref,destinationAccountId:'destination',destinationStorageUnitId:f.targetStorageId});return (await s.confirm(p.previewId)).operation;}
test('same game identity refuses creation',async t=>{const f=await tradeFixture(t,{duplicateIdentity:true}),s=services(f);await assert.rejects(start(f,s),/mesma|distintas/i);assert.equal(f.state.mutations.length,0);});
test('identity changed after review is refused before any mutation',async t=>{
 const f=await tradeFixture(t);assert.equal(typeof createInventoryTransfers,'function');const transfers=createInventoryTransfers({...f.deps,transport:f.transport});
 await assert.rejects(transfers.start({operationId:'changed',kind:'transfer',ref:f.ref,accountId:'source',destinationAccountId:'destination',sourceIdentity:'old-identity',destinationIdentity:'destination-identity',state:'running'}),/identidade/i);assert.equal(f.state.mutations.length,0);
});
test('one way exact offer accepts both participants and verifies destination arrival',async t=>{
 const f=await tradeFixture(t),s=services(f),op=await start(f,s),r=await result(s,op.operationId);assert.equal(r.verified,true);assert.equal(r.state,'confirmed');assert.equal(f.commands.filter(c=>c.event==='tradeAccept').length,2);assert.equal(f.commands.filter(c=>c.event==='tradeConfirm').length,2);assert.equal(s.isItemReserved('source',f.ref.itemId),false);
});
test('unexpected guest and changed offer suspend before confirmation',async t=>{for(const options of [{unexpectedGuest:true},{changedOffer:true}]){const f=await tradeFixture(t,options),s=services(f),op=await start(f,s),r=await result(s,op.operationId);assert.equal(r.state,'unconfirmed');assert.equal(f.commands.filter(c=>c.event==='tradeConfirm').length,0);if(options.unexpectedGuest)assert.equal(f.commands.filter(c=>c.event==='tradeAddSkins').length,0);}});
test('server confirmation requires exact received item identity and destination read',async t=>{for(const options of [{missingArrival:true},{changedId:true}]){const f=await tradeFixture(t,options),s=services(f),op=await start(f,s),r=await result(s,op.operationId);assert.equal(r.state,'unconfirmed');assert.equal(r.verified,false);const before=f.commands.filter(c=>c.event==='tradeConfirm').length;await s.verify(op.operationId);assert.equal(f.commands.filter(c=>c.event==='tradeConfirm').length,before);}});
test('creation timeout and recovery never create or confirm another trade',async t=>{
 const f=await tradeFixture(t,{creationTimeout:true}),s=services(f),op=await start(f,s);await result(s,op.operationId);const recovered=services(f);await recovered.list();await recovered.verify(op.operationId);assert.equal(f.state.mutations.filter(m=>m.endpoint==='/api/trading').length,1);assert.equal(f.commands.filter(c=>c.event==='tradeConfirm').length,0);
});
test('cancel verifies returned property and completed delivery cannot be cancelled',async t=>{
 const f=await tradeFixture(t,{unexpectedGuest:true}),s=services(f),op=await start(f,s);await result(s,op.operationId);const cancelled=await s.cancel(op.operationId);assert.equal(cancelled.state,'cancelled');assert.equal(cancelled.verified,true);
 const g=await tradeFixture(t),done=services(g),sent=await start(g,done);await result(done,sent.operationId);await assert.rejects(done.cancel(sent.operationId),/conclu|enviad/i);
});
test('offer changed while journaling cannot reach even the first confirmation',async t=>{
 const f=await tradeFixture(t),put=f.store.put;let changed=false;f.store.put=async r=>{if(r.intent==='confirm'&&!changed){changed=true;f.trade.hostTokens=42;await f.transport.refresh(f.accounts[0],r.tradeId);}return put(r);};const s=services(f),op=await start(f,s),r=await result(s,op.operationId);assert.equal(r.state,'unconfirmed');assert.equal(f.commands.filter(c=>c.event==='tradeConfirm').length,0);
});
test('transfer mutations respect shared cooldown and propagate creation 429',async t=>{
 const f=await tradeFixture(t);f.deps.coordinator={cooldown:async()=>Date.now()+600000};const s=services(f),op=await start(f,s);await result(s,op.operationId);assert.equal(f.state.mutations.length,0);assert.equal(f.commands.filter(c=>c.event==='tradeConfirm').length,0);
 const g=await tradeFixture(t,{creation429:true});let until=0;g.deps.coordinator={cooldown:async()=>0,limit:async value=>{until=value;}};const other=services(g),pending=await start(g,other);await result(other,pending.operationId);assert.equal(until>Date.now()+59000,true);
});
test('delete merely sent keeps active trade unconfirmed and accounts locked',async t=>{
 const f=await tradeFixture(t,{unexpectedGuest:true}),command=f.transport.command;f.transport.command=(account,id,kind,...args)=>kind==='delete'?Promise.resolve({sent:true}):command(account,id,kind,...args);const s=services(f),op=await start(f,s);await result(s,op.operationId);const r=await s.cancel(op.operationId);assert.equal(f.trade.status,'active');assert.equal(r.verified,false);assert.equal(r.state,'unconfirmed');assert.equal(s.blocksAccount('source'),true);
});
test('acknowledged cancellation releases reservation for immediate next action',async t=>{
 const f=await tradeFixture(t,{unexpectedGuest:true}),s=services(f),op=await start(f,s);await result(s,op.operationId);await s.cancel(op.operationId);const p=await s.prepare({kind:'sell',ref:f.ref});assert.equal(p.item.id,f.ref.itemId);
});
test('deleted trade reconciles through authoritative list when watcher cannot answer',async t=>{
 const f=await tradeFixture(t,{unexpectedGuest:true}),command=f.transport.command,refresh=f.transport.refresh;f.transport.command=async(...args)=>{const result=await command(...args);if(args[2]==='delete')f.state.trade=null;return result;};f.transport.refresh=(...args)=>f.state.trade===null?Promise.reject(Error('Deleted trade cannot be watched')):refresh(...args);
 const s=services(f),op=await start(f,s);await result(s,op.operationId);const r=await s.cancel(op.operationId);assert.equal(r.state,'cancelled');assert.equal(r.verified,true);
});
test('destination reconciliation resumes after twenty pages',async t=>{
 const f=await tradeFixture(t,{destinationPages:21}),s=services(f),op=await start(f,s);await result(s,op.operationId);const r=await s.verify(op.operationId);assert.equal(r.verified,true);assert.equal(f.state.reads.some(path=>path.includes('page=21')),true);
});
test('cross-account move reaches chosen storage',async t=>{
 const f=await tradeFixture(t,{storage:true}),s=services(f),op=await startStorageMove(f,s),r=await result(s,op.operationId);
 assert.equal(r.state,'confirmed');assert.equal(r.location,'storage');assert.equal(f.state.targetStorage[0]._id,f.ref.itemId);
 assert.equal(f.state.mutations.filter(m=>m.endpoint==='/api/trading').length,1);
 assert.equal(f.state.mutations.filter(m=>m.endpoint==='/api/inventory/storageUnits/skins'&&m.init.method==='POST').length,1);
});
test('deposit waits for verified destination arrival',async t=>{
 const f=await tradeFixture(t,{missingArrival:true}),s=services(f),op=await startStorageMove(f,s),r=await result(s,op.operationId);
 assert.equal(r.state,'unconfirmed');assert.equal(f.state.mutations.filter(m=>m.init.method==='POST'&&m.endpoint==='/api/inventory/storageUnits/skins').length,0);
});
test('changed offer suspends move without deposit',async t=>{
 const f=await tradeFixture(t,{changedOffer:true}),s=services(f),op=await startStorageMove(f,s),r=await result(s,op.operationId);
 assert.equal(r.state,'unconfirmed');assert.equal(f.commands.filter(c=>c.event==='tradeConfirm').length,0);
 assert.equal(f.state.mutations.filter(m=>m.init.method==='POST'&&m.endpoint==='/api/inventory/storageUnits/skins').length,0);
});
test('rejected deposit leaves item at destination inventory',async t=>{
 const f=await tradeFixture(t,{depositFail:'reject'}),s=services(f),op=await startStorageMove(f,s),r=await result(s,op.operationId);
 assert.equal(r.state,'failed');assert.equal(r.location,'inventory');assert.equal(r.locationAccountId,'destination');assert.equal(f.state.destinationInventory[0]._id,f.ref.itemId);
 assert.equal(f.state.mutations.filter(m=>m.endpoint==='/api/trading').length,1);
});
test('restart reconciles uncertain deposit without replay',async t=>{
 const f=await tradeFixture(t,{depositFail:'after-send'}),s=services(f),op=await startStorageMove(f,s),r=await result(s,op.operationId);
 assert.equal(r.state,'unconfirmed');const recovered=services(f);await recovered.list();const checked=await recovered.verify(op.operationId);
 assert.equal(checked.state,'confirmed');assert.equal(checked.location,'storage');
 assert.equal(f.state.mutations.filter(m=>m.init.method==='POST'&&m.endpoint==='/api/inventory/storageUnits/skins').length,1);
});
test('duplicate move confirmation does not replay trade or deposit',async t=>{
 const f=await tradeFixture(t),s=services(f),p=await s.prepare({kind:'move-to-storage',ref:f.ref,destinationAccountId:'destination',destinationStorageUnitId:f.targetStorageId});
 const [a,b]=await Promise.all([s.confirm(p.previewId),s.confirm(p.previewId)]);assert.equal(a.operation.operationId,b.operation.operationId);
 await result(s,a.operation.operationId);assert.equal(f.state.mutations.filter(m=>m.endpoint==='/api/trading').length,1);
 assert.equal(f.state.mutations.filter(m=>m.init.method==='POST'&&m.endpoint==='/api/inventory/storageUnits/skins').length,1);
});
test('rejected deposit remains failed when its status is checked',async t=>{
 const f=await tradeFixture(t,{depositFail:'reject'}),s=services(f),op=await startStorageMove(f,s),r=await result(s,op.operationId);
 assert.equal(r.state,'failed');assert.equal((await s.verify(op.operationId)).state,'failed');
});
test('concurrent continuation cannot send two deposits',async t=>{
 const f=await tradeFixture(t),transferService=createInventoryTransfers({...f.deps,transport:f.transport});
 f.state.inventory=[];f.state.destinationInventory=[f.raw];
 const record={operationId:'continuation',kind:'move-to-storage',ref:f.ref,accountId:'source',destinationAccountId:'destination',destinationStorageUnitId:f.targetStorageId,destinationStorageName:'Blue',destinationIdentity:'destination-identity',sourceIdentity:'source-identity',transferConfirmed:true,stage:'arrived',state:'unconfirmed',location:'inventory'};
 await f.store.put(record);
 await Promise.allSettled([transferService.resumeDeposit(record.operationId),transferService.resumeDeposit(record.operationId)]);
 assert.equal(f.state.mutations.filter(m=>m.endpoint==='/api/inventory/storageUnits/skins'&&m.init.method==='POST').length,1);
});
test('known pre-send failure keeps cross-account deposit safely resumable',async t=>{
 const f=await tradeFixture(t);f.state.inventory=[];f.state.destinationInventory=[f.raw];let blocked=true;const original=f.deps.storageDeposit;
 f.deps.storageDeposit={...original,sendOnce:async r=>{if(blocked){const e=Error('Aguarda o limite da API');e.notSent=true;throw e;}return original.sendOnce(r);}};
 const record={operationId:'pre-send',kind:'move-to-storage',ref:f.ref,item:{id:f.ref.itemId,name:'Skin'},accountId:'source',destinationAccountId:'destination',destinationStorageUnitId:f.targetStorageId,destinationStorageName:'Blue',destinationIdentity:'destination-identity',sourceIdentity:'source-identity',transferConfirmed:true,stage:'arrived',state:'unconfirmed',location:'inventory',locationAccountId:'destination'};
 await f.store.put(record);const s=services(f),first=await s.resume(record.operationId);
 assert.equal(first.stage,'arrived');assert.equal(first.canResume,true);assert.equal(f.state.mutations.filter(m=>m.endpoint==='/api/inventory/storageUnits/skins'&&m.init.method==='POST').length,0);
 blocked=false;assert.equal((await s.resume(record.operationId)).state,'confirmed');
});
test('destination item on page twenty-one can be deposited after verified arrival',async t=>{
 const f=await tradeFixture(t,{destinationPages:21}),s=services(f),started=await startStorageMove(f,s);await result(s,started.operationId);
 let current;for(let i=0;i<4;i++){current=await s.verify(started.operationId);if(current.stage==='arrived')break;}
 assert.equal(current.stage,'arrived');const stored=await s.resume(started.operationId);
 assert.equal(stored.state,'confirmed');assert.equal(f.state.mutations.filter(m=>m.endpoint==='/api/inventory/storageUnits/skins'&&m.init.method==='POST').length,1);
});
