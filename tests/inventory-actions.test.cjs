const test=require('node:test'),assert=require('node:assert/strict'),{inventoryFixture}=require('./helpers/inventory-fixture.cjs');
let createInventoryActions;try{({createInventoryActions}=require('../electron/inventoryActions.cjs'));}catch{}
const service=f=>{assert.equal(typeof createInventoryActions,'function');return createInventoryActions(f.deps);};
test('double confirmation sends one mutation and changed price requires review',async t=>{
 const f=await inventoryFixture(t),s=service(f),p=await s.prepare({kind:'sell',ref:f.ref});f.raw.price=6;const changed=await s.confirm(p.previewId);assert.equal(changed.reviewRequired.item.price,6);assert.equal(f.state.mutations.length,0);
 const [first,second]=await Promise.all([s.confirm(changed.reviewRequired.previewId),s.confirm(changed.reviewRequired.previewId)]);assert.equal(first.operation.operationId,second.operation.operationId);assert.equal(f.state.mutations.length,1);assert.equal(first.operation.verified,true);
});
test('favorites cannot be sold or converted and exact favorite change is verified',async t=>{
 const f=await inventoryFixture(t,{favorite:true}),s=service(f);for(const kind of ['sell','convert'])await assert.rejects(s.prepare({kind,ref:f.ref}),/favorito/i);assert.equal(f.state.mutations.length,0);
 const p=await s.prepare({kind:'favorite',isFavorite:false,ref:f.ref});assert.equal((await s.confirm(p.previewId)).operation.verified,true);assert.equal(f.raw.isFavorite,false);
});
test('withdraw succeeded but rejected sale reports real inventory location',async t=>{
 const f=await inventoryFixture(t,{storage:true,fail:'reject'}),s=service(f),p=await s.prepare({kind:'sell',ref:f.ref});assert.equal(p.steps.length,2);const {operation}=await s.confirm(p.previewId);assert.equal(operation.location,'inventory');assert.equal(operation.state,'failed');assert.equal(f.state.storage.length,0);
});
test('timeout verification never resells and recovery preserves the item reservation',async t=>{
 const f=await inventoryFixture(t,{fail:'after-send'}),s=service(f),p=await s.prepare({kind:'sell',ref:f.ref}),{operation}=await s.confirm(p.previewId);assert.equal(operation.state,'unconfirmed');const s2=service(f);await s2.list();assert.equal(s2.isItemReserved('source',f.ref.itemId),true);const verified=await s2.verify(operation.operationId);assert.equal(verified.verified,false);assert.equal(f.state.mutations.length,1);
});
test('observed balance includes vault credit without attributing a sale delta',async t=>{
 const f=await inventoryFixture(t,{vaultCredit:true}),s=service(f),p=await s.prepare({kind:'sell',ref:f.ref}),{operation}=await s.confirm(p.previewId);assert.equal(operation.observedMoney,205);assert.equal(Object.hasOwn(operation,'moneyDelta'),false);
});
test('persist failure prevents any mutation and same item cannot run two actions',async t=>{
 const f=await inventoryFixture(t),s=service(f),p=await s.prepare({kind:'sell',ref:f.ref});f.deps.store.put=async()=>{throw Error('Disk unavailable');};await assert.rejects(s.confirm(p.previewId),/Disk/);assert.equal(f.state.mutations.length,0);
 const g=await inventoryFixture(t,{fail:'timeout'}),other=service(g),preview=await other.prepare({kind:'convert',ref:g.ref});await other.confirm(preview.previewId);await assert.rejects(other.prepare({kind:'sell',ref:g.ref}),/operação/i);
});
test('reconciliation never confirms against a different person session',async t=>{
 const f=await inventoryFixture(t,{keepItem:true}),s=service(f),p=await s.prepare({kind:'sell',ref:f.ref}),{operation}=await s.confirm(p.previewId);assert.equal(operation.state,'unconfirmed');f.state.identityOverride='different-person';f.state.emptySessionInventory=true;
 const result=await s.verify(operation.operationId);assert.equal(result.verified,false);assert.equal(result.state,'unconfirmed');assert.equal(s.isItemReserved('source',f.ref.itemId),true);
});
test('withdrawal reconciliation resumes a stable storage beyond twenty pages',async t=>{
 const f=await inventoryFixture(t,{storage:true,storagePages:21}),s=service(f),p=await s.prepare({kind:'withdraw',ref:f.ref}),{operation}=await s.confirm(p.previewId);await s.verify(operation.operationId);const result=await s.verify(operation.operationId);
 assert.equal(result.verified,true);assert.equal(f.state.reads.some(path=>path.includes('page=21')),true);
});
test('item action 429 reserves a future deadline rather than a duration',async t=>{
 const f=await inventoryFixture(t,{fail:'429'});let until=0;f.deps.coordinator={cooldown:async()=>0,limit:async value=>{until=value;}};const s=service(f),p=await s.prepare({kind:'sell',ref:f.ref});await s.confirm(p.previewId);assert.equal(until>Date.now()+59000,true);
});
const move=f=>({kind:'move-to-storage',ref:f.ref,destinationAccountId:'source',destinationStorageUnitId:f.targetStorageId});
test('inventory item moves into own storage',async t=>{
 const f=await inventoryFixture(t),s=service(f),p=await s.prepare(move(f));
 assert.equal(p.destinationStorageName,'Blue');assert.equal(p.steps.at(-1),'Guardar no storage Blue');
 const {operation}=await s.confirm(p.previewId);assert.equal(operation.state,'confirmed');assert.equal(operation.location,'storage');assert.equal(f.state.targetStorage[0]._id,f.ref.itemId);
});
test('storage A moves into B',async t=>{
 const f=await inventoryFixture(t,{storage:true}),s=service(f),p=await s.prepare(move(f));
 assert.equal(p.steps.length,2);const {operation}=await s.confirm(p.previewId);
 assert.equal(operation.location,'storage');assert.equal(f.state.storage.length,0);assert.equal(f.state.targetStorage.length,1);
});
test('same storage is rejected',async t=>{
 const f=await inventoryFixture(t,{storage:true}),s=service(f);
 await assert.rejects(s.prepare({...move(f),destinationStorageUnitId:f.ref.storageUnitId}),/mesmo storage/i);assert.equal(f.state.mutations.length,0);
});
test('vanished storage blocks confirm before mutations',async t=>{
 const f=await inventoryFixture(t),s=service(f),p=await s.prepare(move(f));f.state.missingTarget=true;
 await assert.rejects(s.confirm(p.previewId),/Storage/i);assert.equal(f.state.mutations.length,0);
});
test('duplicate move confirmation sends one deposit',async t=>{
 const f=await inventoryFixture(t),s=service(f),p=await s.prepare(move(f));
 const [a,b]=await Promise.all([s.confirm(p.previewId),s.confirm(p.previewId)]);assert.equal(a.operation.operationId,b.operation.operationId);
 assert.equal(f.state.mutations.filter(m=>m.init.method==='POST').length,1);
});
test('deposit timeout never replays on verification',async t=>{
 const f=await inventoryFixture(t,{depositFail:'after-send'}),s=service(f),p=await s.prepare(move(f)),{operation}=await s.confirm(p.previewId);
 assert.equal(operation.state,'unconfirmed');const next=service(f),verified=await next.verify(operation.operationId);
 assert.equal(verified.location,'storage');assert.equal(f.state.mutations.filter(m=>m.init.method==='POST').length,1);
});
test('rejected withdrawal preserves source location for move',async t=>{
 const f=await inventoryFixture(t,{storage:true,withdrawFail:'reject'}),s=service(f),p=await s.prepare(move(f)),{operation}=await s.confirm(p.previewId);
 assert.equal(operation.location,'storage');assert.equal(operation.locationStorageUnitId,f.ref.storageUnitId);assert.equal(f.state.targetStorage.length,0);
});
test('same-account concurrent continuation sends one deposit even after timeout',async t=>{
 const f=await inventoryFixture(t,{depositFail:'timeout'});const r={operationId:'resume-once',kind:'move-to-storage',ref:f.ref,item:{id:f.ref.itemId,name:'Skin'},accountId:'source',destinationAccountId:'source',destinationStorageUnitId:f.targetStorageId,destinationStorageName:'Blue',destinationIdentity:'source-identity',sourceIdentity:'source-identity',stage:'withdrawn',state:'unconfirmed',intent:'withdraw',location:'inventory',locationAccountId:'source'};
 await f.store.put(r);const s=service(f);await Promise.allSettled([s.resume(r.operationId),s.resume(r.operationId)]);
 assert.equal(f.state.mutations.filter(m=>m.endpoint==='/api/inventory/storageUnits/skins'&&m.init.method==='POST').length,1);
});
test('recovered same-account withdrawal promotes to resumable deposit after exact proof',async t=>{
 const f=await inventoryFixture(t,{storage:true});f.state.inventory=[f.raw];f.state.storage=[];
 const r={operationId:'withdraw-recovery',kind:'move-to-storage',ref:f.ref,item:{id:f.ref.itemId,name:'Skin'},accountId:'source',destinationAccountId:'source',destinationStorageUnitId:f.targetStorageId,destinationStorageName:'Blue',destinationIdentity:'source-identity',sourceIdentity:'source-identity',stage:'sending',state:'unconfirmed',intent:'withdraw',withdrawAccepted:true,location:'storage',locationAccountId:'source',locationStorageUnitId:f.ref.storageUnitId};
 await f.store.put(r);const s=service(f),checked=await s.verify(r.operationId);
 assert.equal(checked.stage,'withdrawn');assert.equal(checked.location,'inventory');assert.equal(checked.canResume,true);
 assert.equal((await s.resume(r.operationId)).state,'confirmed');
});
test('pending cross-account move reserves exact item in destination too',async t=>{
 const f=await inventoryFixture(t);f.state.inventory=[];f.state.destinationInventory=[f.raw];
 const r={operationId:'pending-destination',kind:'move-to-storage',ref:f.ref,item:{id:f.ref.itemId,name:'Skin'},accountId:'source',destinationAccountId:'destination',destinationStorageUnitId:f.targetStorageId,destinationIdentity:'destination-identity',sourceIdentity:'source-identity',stage:'deposit-sending',state:'unconfirmed',intent:'deposit'};
 await f.store.put(r);const s=service(f);await s.list();
 assert.equal(s.isItemReserved('destination',f.ref.itemId),true);
 await assert.rejects(s.prepare({kind:'sell',ref:{...f.ref,accountId:'destination'}}),/operação pendente/i);
});
