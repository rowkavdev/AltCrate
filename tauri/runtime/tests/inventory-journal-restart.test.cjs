const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {inventoryFixture}=require('./helpers/inventory-fixture.cjs');
const {createInventoryActions}=require('../engine/inventoryActions.cjs');
const {createInventoryOperationStore}=require('../engine/inventoryOperationStore.cjs');

async function fixture(t,options={}){
 const f=await inventoryFixture(t,options),dir=await fs.mkdtemp(path.join(os.tmpdir(),'inventory-restart-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const filePath=path.join(dir,'operations.json');
 const reopen=()=>createInventoryActions({...f.deps,store:createInventoryOperationStore({filePath})});
 return {...f,filePath,reopen,service:reopen()};
}
async function uncertainConversion(f){
 const preview=await f.service.prepare({kind:'convert',ref:f.ref});
 const {operation}=await f.service.confirm(preview.previewId);
 assert.equal(operation.state,'unconfirmed');
 const checked=await f.service.verify(operation.operationId);
 assert.equal(checked.verified,false);assert.equal(checked.canCloseUnresolved,true);
 return operation.operationId;
}

test('a completed conversion diagnostic remains eligible for explicit closure after a disk restart',async t=>{
 const f=await fixture(t,{fail:'after-send'}),id=await uncertainConversion(f),restarted=f.reopen();
 const saved=(await restarted.list()).find(r=>r.operationId===id);
 assert.equal(saved.canCloseUnresolved,true);
 assert.equal(saved.verification.complete,true);assert.equal(saved.verification.itemOutcome,'absent');
 assert.equal((await restarted.closeUnresolved(id)).state,'unresolved');
 assert.equal(f.state.mutations.length,1);
});

test('explicitly closed uncertain conversions keep their exact item reserved after a disk restart',async t=>{
 const f=await fixture(t,{fail:'after-send'}),id=await uncertainConversion(f);
 await f.service.closeUnresolved(id);
 const restarted=f.reopen(),saved=(await restarted.list()).find(r=>r.operationId===id);
 assert.equal(saved.state,'unresolved');assert.equal(saved.verified,false);
 assert.equal(restarted.isItemReserved('source',f.ref.itemId),true);
 assert.equal(saved.resolution.kind,'unresolved-conversion');
 assert.equal(saved.resolution.scope.itemId,f.ref.itemId);
 await assert.rejects(restarted.prepare({kind:'sell',ref:f.ref}),/pendente/);
 await restarted.verify(id);
 assert.equal(restarted.isItemReserved('source',f.ref.itemId),true);
 assert.equal(f.state.mutations.length,1);
});

test('a rejected storage withdrawal retains the actual source storage after a disk restart',async t=>{
 const f=await fixture(t,{storage:true,withdrawFail:'reject'}),preview=await f.service.prepare({kind:'move-to-storage',ref:f.ref,destinationAccountId:'source',destinationStorageUnitId:f.targetStorageId});
 const {operation}=await f.service.confirm(preview.previewId);
 assert.equal(operation.state,'failed');assert.equal(operation.canResume,false);
 const saved=(await f.reopen().list()).find(r=>r.operationId===operation.operationId);
 assert.equal(saved.location,'storage');assert.equal(saved.locationStorageUnitId,f.ref.storageUnitId);
 assert.equal(saved.canResume,false);assert.equal(f.state.mutations.length,1);
});

test('conversion diagnostics persist only their documented nested schema',async t=>{
 const f=await fixture(t),store=createInventoryOperationStore({filePath:f.filePath});
 await store.put({operationId:'sanitized',verification:{phase:'complete',complete:true,itemOutcome:'absent',errorStatus:0,sourceIdentity:'source-identity',finishedAt:'2026-10-25T00:00:00Z',apiResponse:{cookie:'private-test-cookie'}},resolution:{kind:'unresolved-conversion',closedAt:'2026-10-25T00:00:00Z',scope:{accountId:'source',identity:'source-identity',itemId:f.ref.itemId,token:'private-test-token'},apiResponse:{token:'private-test-token'}}});
 const saved=await createInventoryOperationStore({filePath:f.filePath}).get('sanitized');
 assert.ok(saved.verification);assert.ok(saved.resolution);
 assert.equal(saved.verification.complete,true);assert.equal(saved.resolution.scope.itemId,f.ref.itemId);
 const serialized=await fs.readFile(f.filePath,'utf8');assert.equal(serialized.includes('private-test-'),false);
});

test('a saved confirmation without verified proof recovers as uncertain and reserves the item',async t=>{
 const f=await fixture(t),store=createInventoryOperationStore({filePath:f.filePath});
 await store.put({operationId:'inconsistent',kind:'sell',intent:'sell',ref:f.ref,item:{id:f.ref.itemId,name:'Skin'},accountId:'source',sourceIdentity:'source-identity',state:'confirmed',verified:false,responseAccepted:true});
 const restarted=f.reopen(),saved=(await restarted.list())[0];
 assert.equal(saved.state,'unconfirmed');assert.equal(saved.verified,false);
 assert.equal(restarted.isItemReserved('source',f.ref.itemId),true);
 const checked=await restarted.verify('inconsistent');assert.equal(checked.state,'unconfirmed');assert.equal(checked.verified,false);
 assert.equal(f.state.mutations.length,0);
});
