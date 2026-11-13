const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
let createInventoryBatch;try{({createInventoryBatch}=require('../electron/inventoryBatch.cjs'));}catch{}
const ref=n=>({accountId:'source',itemId:String(n).padStart(24,'a'),storageUnitId:null,page:1,name:'Skin '+n});
async function fixture(t,options={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'inventory-batch-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 let counter=0;const previews=new Map(),operations=new Map(),calls=[],missing=new Set();
 const actions={async prepare(request){if(missing.has(request.ref.itemId))throw Error('Item desapareceu');const preview={previewId:'p'+(++counter),...request,item:{id:request.ref.itemId,name:request.ref.name},sourceLabel:'Origem',destinationLabel:'Destino',steps:['Enviar para Destino']};previews.set(preview.previewId,preview);return preview;},async confirm(id){const p=previews.get(id);calls.push(p.ref.itemId);const operation={operationId:'op'+calls.length,previewId:id,state:options.timeout?'unconfirmed':'confirmed',verified:!options.timeout,kind:p.kind,accountId:p.ref.accountId,destinationAccountId:p.destinationAccountId,item:p.item};operations.set(operation.operationId,operation);if(options.confirm)await options.confirm(operation);return {operation};},async list(){return [...operations.values()];},async verify(id){const op=operations.get(id);if(options.verify)options.verify(op);return {...op};},async resume(id){return this.verify(id);}};
 const deps={actions,locator:{identity:async id=>id+'-identity'},operationStore:{list:async()=>[...operations.values()]},filePath:path.join(dir,'batch.json'),pollMs:1,pollAttempts:2};
 assert.equal(typeof createInventoryBatch,'function','batch service must exist');
 return {deps,service:createInventoryBatch(deps),calls,missing,operations};
}
const request={kind:'transfer',destinationAccountId:'dest',refs:[ref(1),ref(2)]};
test('review is persisted with exact items and reports verified individual trade limitation',async t=>{
 const f=await fixture(t),review=await f.service.prepare(request);assert.equal(review.items.length,2);assert.equal(review.state,'review');assert.match(review.limitation,/individuais/i);assert.equal(f.calls.length,0);assert.equal((await createInventoryBatch(f.deps).list())[0].batchId,review.batchId);
});
test('disappeared item blocks before sending and preserves remaining rows',async t=>{
 const f=await fixture(t),review=await f.service.prepare(request);f.missing.add(ref(1).itemId);const result=await f.service.start(review.batchId);assert.equal(result.state,'paused');assert.equal(result.items[0].state,'blocked');assert.equal(f.calls.length,0);assert.equal(result.items[1].state,'queued');
});
test('timeout after send pauses; verification and explicit continuation never resend completed row',async t=>{
 const f=await fixture(t,{timeout:true,verify:op=>Object.assign(op,{state:'confirmed',verified:true})}),review=await f.service.prepare(request);let result=await f.service.start(review.batchId);assert.equal(result.items[0].state,'unconfirmed');assert.equal(f.calls.length,1);
 result=await f.service.verify(review.batchId);assert.equal(result.items[0].state,'confirmed');assert.equal(result.items[0].finalLocation.accountId,'dest');assert.equal(f.calls.length,1);
 result=await f.service.resume(review.batchId);assert.equal(f.calls.length,2);assert.equal(f.calls.filter(id=>id===ref(1).itemId).length,1);
});
test('stop during sent request completes current verification and submits no further items',async t=>{
 let release,entered;const gate=new Promise(resolve=>release=resolve),sent=new Promise(resolve=>entered=resolve);
 const f=await fixture(t,{confirm:async()=>{entered();await gate;}}),review=await f.service.prepare(request),running=f.service.start(review.batchId);await sent;await f.service.stop(review.batchId);release();const result=await running;assert.equal(result.state,'stopped');assert.equal(result.items[0].state,'confirmed');assert.equal(result.items[1].state,'queued');assert.equal(f.calls.length,1);
});
test('restart correlates a submitted preview to operation journal and never duplicates transfer',async t=>{
 const f=await fixture(t,{timeout:true,verify:op=>Object.assign(op,{state:'confirmed',verified:true})}),review=await f.service.prepare(request);await f.service.start(review.batchId);
 const saved=JSON.parse(await fs.readFile(f.deps.filePath,'utf8'));saved.batches[0].state='running';saved.batches[0].items[0].state='submitting';saved.batches[0].items[0].operationId=null;await fs.writeFile(f.deps.filePath,JSON.stringify(saved));
 const next=createInventoryBatch(f.deps);assert.equal((await next.list())[0].state,'paused');await next.verify(review.batchId);await next.resume(review.batchId);assert.equal(f.calls.filter(id=>id===ref(1).itemId).length,1);
});
test('submission with no recoverable journal remains uncertain and cannot be resent on resume',async t=>{
 const f=await fixture(t),review=await f.service.prepare(request),saved=JSON.parse(await fs.readFile(f.deps.filePath,'utf8'));saved.batches[0].state='running';saved.batches[0].items[0].state='submitting';await fs.writeFile(f.deps.filePath,JSON.stringify(saved));
 const next=createInventoryBatch(f.deps),result=await next.resume(review.batchId);assert.equal(result.items[0].state,'unconfirmed');assert.equal(f.calls.length,0);
});
test('changed reviewed item requires a new review before any send',async t=>{
 const f=await fixture(t),review=await f.service.prepare(request),prepare=f.deps.actions.prepare;f.deps.actions.prepare=async r=>{const p=await prepare(r);p.item.name='Outro';return p;};const result=await f.service.start(review.batchId);assert.equal(result.items[0].state,'blocked');assert.equal(f.calls.length,0);
});
test('expired review and duplicate selection do not submit',async t=>{
 let time=0;const f=await fixture(t);f.deps.now=()=>time;const s=createInventoryBatch(f.deps),review=await s.prepare(request);time=300001;await assert.rejects(s.start(review.batchId),/expirou/);await assert.rejects(s.prepare({...request,refs:[ref(1),ref(1)]}),/repetido/i);assert.equal(f.calls.length,0);
});
test('stop recorded before mutation submission leaves that item queued',async t=>{
 const f=await fixture(t);let s,stopping;f.deps.emit=event=>{if(event.batch.items[0].state==='submitting'&&!stopping)stopping=s.stop(event.batch.batchId);};s=createInventoryBatch(f.deps);const review=await s.prepare(request),result=await s.start(review.batchId);await stopping;assert.equal(f.calls.length,0);assert.equal(result.items[0].state,'queued');assert.equal(result.state,'stopped');
});
test('identity changed after review blocks before submission',async t=>{
 const f=await fixture(t),review=await f.service.prepare(request);f.deps.locator.identity=async()=> 'another-person';const result=await f.service.start(review.batchId);assert.equal(result.items[0].state,'blocked');assert.equal(f.calls.length,0);
});
test('unexpected operation item never proves arrival for reviewed item',async t=>{
 const f=await fixture(t,{confirm:async op=>{op.item={id:ref(99).itemId,name:'Unexpected'};}}),review=await f.service.prepare(request),result=await f.service.start(review.batchId);assert.equal(result.items[0].state,'unconfirmed');assert.equal(result.items[0].finalLocation,null);assert.equal(f.calls.length,1);
});
test('real storage action timeout is reconciled by exact inventory and storage membership without re-deposit',async t=>{
 const {inventoryFixture}=require('./helpers/inventory-fixture.cjs'),{createInventoryActions}=require('../electron/inventoryActions.cjs');const f=await inventoryFixture(t,{depositFail:'after-send'}),dir=await fs.mkdtemp(path.join(os.tmpdir(),'batch-real-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const s=createInventoryBatch({actions:createInventoryActions(f.deps),operationStore:f.store,locator:f.deps.locator,filePath:path.join(dir,'batches.json')}),review=await s.prepare({kind:'move-to-storage',destinationAccountId:'source',destinationStorageUnitId:f.targetStorageId,refs:[f.ref]});
 assert.equal((await s.start(review.batchId)).items[0].state,'unconfirmed');const result=await s.verify(review.batchId);assert.equal(result.state,'completed');assert.deepEqual(result.items[0].finalLocation,{accountId:'source',storageUnitId:f.targetStorageId,location:'storage'});assert.equal(f.state.mutations.filter(value=>value.init.method==='POST').length,1);
});
test('competing batches permit one active runner and leave the other review intact',async t=>{
 let release,enter;const gate=new Promise(resolve=>release=resolve),sent=new Promise(resolve=>enter=resolve),f=await fixture(t,{confirm:async()=>{enter();await gate;}}),a=await f.service.prepare({...request,refs:[ref(1)]}),b=await f.service.prepare({...request,refs:[ref(2)]}),first=f.service.start(a.batchId);await sent;await assert.rejects(f.service.start(b.batchId),/Outro lote/);assert.equal(f.calls.length,1);release();await first;assert.equal((await f.service.list()).find(row=>row.batchId===b.batchId).state,'review');
});
test('stop while revalidating a fresh preview prevents its later submission',async t=>{
 const f=await fixture(t),review=await f.service.prepare(request),original=f.deps.actions.prepare;let release,enter;const gate=new Promise(resolve=>release=resolve),preparing=new Promise(resolve=>enter=resolve);f.deps.actions.prepare=async r=>{enter();await gate;return original(r);};const running=f.service.start(review.batchId);await preparing;await f.service.stop(review.batchId);release();const result=await running;assert.equal(f.calls.length,0);assert.equal(result.state,'stopped');assert.equal(result.items[0].state,'queued');
});
test('review expiry during the batch prevents submitting the next queued item',async t=>{
 let time=0;const f=await fixture(t,{confirm:async()=>{time=300001;}});f.deps.now=()=>time;const s=createInventoryBatch(f.deps),review=await s.prepare(request),result=await s.start(review.batchId);assert.equal(f.calls.length,1);assert.equal(result.items[1].state,'queued');assert.equal(result.state,'paused');assert.match(result.message,/expirou/i);
});
test('persisted pending state participates in synchronous operation guards after load',async t=>{
 const f=await fixture(t,{timeout:true}),review=await f.service.prepare(request);assert.equal(f.service.hasPending(),false);const task=f.service.start(review.batchId);assert.equal(f.service.hasPending(),true);await task;const next=createInventoryBatch(f.deps);await next.list();assert.equal(next.hasPending(),true);
});
test('review reloaded after restart preserves identity binding',async t=>{
 const f=await fixture(t),review=await f.service.prepare(request);f.deps.locator.identity=async()=> 'replacement-person';const result=await createInventoryBatch(f.deps).start(review.batchId);assert.equal(result.items[0].state,'blocked');assert.equal(f.calls.length,0);
});
test('session identity changing during review is rejected before it can become an approved identity',async t=>{
 const f=await fixture(t),original=f.deps.actions.prepare;let identity='original';f.deps.locator.identity=async()=>identity;f.deps.actions.prepare=async r=>{const p=await original(r);identity='replacement';return p;};await assert.rejects(f.service.prepare(request),/identidade/i);assert.equal(f.calls.length,0);
});
test('simultaneous starts cannot enter two different batch execution loops',async t=>{
 let release,enter;const gate=new Promise(resolve=>release=resolve),sent=new Promise(resolve=>enter=resolve),f=await fixture(t,{confirm:async()=>{enter();await gate;}}),a=await f.service.prepare({...request,refs:[ref(1)]}),b=await f.service.prepare({...request,refs:[ref(2)]});
 const results=Promise.allSettled([f.service.start(a.batchId),f.service.start(b.batchId)]);await sent;release();const values=await results;assert.equal(values.filter(value=>value.status==='fulfilled').length,1);assert.equal(values.filter(value=>value.status==='rejected').length,1);assert.equal(f.calls.length,1);
});
test('batch journal write failure prevents any mutation and confirmed claim',async t=>{
 const f=await fixture(t),review=await f.service.prepare(request);await fs.rm(f.deps.filePath);await fs.mkdir(f.deps.filePath);await assert.rejects(f.service.start(review.batchId));assert.equal(f.calls.length,0);assert.equal((await f.service.list())[0].state,'review');
});
test('storage confirmation for a different unit never proves the requested destination',async t=>{
 const f=await fixture(t,{confirm:async op=>{op.destinationStorageUnitId='f'.repeat(24);}}),review=await f.service.prepare({...request,kind:'move-to-storage',destinationStorageUnitId:'b'.repeat(24)}),result=await f.service.start(review.batchId);assert.equal(result.items[0].state,'unconfirmed');assert.equal(result.items[0].finalLocation,null);assert.equal(f.calls.length,1);
});
test('review expiring during fresh item preflight prevents mutation submission',async t=>{
 let time=0;const f=await fixture(t);f.deps.now=()=>time;const s=createInventoryBatch(f.deps),review=await s.prepare(request),original=f.deps.actions.prepare;f.deps.actions.prepare=async input=>{const value=await original(input);time=300001;return value;};const result=await s.start(review.batchId);assert.equal(f.calls.length,0);assert.equal(result.items[0].state,'queued');assert.match(result.message,/expirou/i);
});
test('async transfer remaining running after local wait stays pending and continuation cannot submit another item',async t=>{
 const f=await fixture(t,{confirm:async op=>{op.state='running';op.verified=false;}}),review=await f.service.prepare(request),result=await f.service.start(review.batchId);assert.equal(result.items[0].state,'unconfirmed');assert.equal(f.service.hasPending(),true);await f.service.resume(review.batchId);assert.equal(f.calls.length,1);assert.equal(f.service.hasPending(),true);
 const op=[...f.operations.values()][0];Object.assign(op,{state:'confirmed',verified:true});await f.service.verify(review.batchId);assert.equal(f.service.hasPending(),false);assert.equal((await f.service.list())[0].items[0].state,'confirmed');assert.equal(f.calls.length,1);
});
test('resuming a different batch cannot bypass an unresolved earlier batch',async t=>{const f=await fixture(t,{timeout:true});const a=await f.service.prepare({...request,refs:[ref(1)]});await f.service.start(a.batchId);const b=await f.service.prepare({...request,refs:[ref(3)]});await f.service.stop(b.batchId);await assert.rejects(f.service.resume(b.batchId),/outro lote|pendente/i);assert.equal(f.calls.length,1);});
for(const kind of ['sell','convert']){
 test(kind+' batch requires no destination and records a confirmed result for original account',async t=>{
  const f=await fixture(t),review=await f.service.prepare({kind,refs:[ref(1),ref(2)]});assert.equal(f.calls.length,0);assert.match(review.limitation,/irreversíveis/);const result=await f.service.start(review.batchId);assert.equal(result.state,'completed');assert.equal(result.items[0].finalLocation.accountId,'source');assert.equal(result.items[0].finalLocation.location,kind==='sell'?'sold':'converted');assert.equal(f.calls.length,2);
 });
 test(kind+' batch retains favorite protection in the real action service',async t=>{
  const {inventoryFixture}=require('./helpers/inventory-fixture.cjs'),{createInventoryActions}=require('../electron/inventoryActions.cjs'),f=await inventoryFixture(t,{favorite:true}),dir=await fs.mkdtemp(path.join(os.tmpdir(),'batch-protected-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const service=createInventoryBatch({actions:createInventoryActions(f.deps),operationStore:f.store,locator:f.deps.locator,filePath:path.join(dir,'batch.json')});await assert.rejects(service.prepare({kind,refs:[f.ref]}),/favorito/i);assert.equal(f.state.mutations.length,0);
 });
 test(kind+' batch withdraws storage item and verifies the real result once',async t=>{
  const {inventoryFixture}=require('./helpers/inventory-fixture.cjs'),{createInventoryActions}=require('../electron/inventoryActions.cjs'),f=await inventoryFixture(t,{storage:true}),dir=await fs.mkdtemp(path.join(os.tmpdir(),'batch-disposal-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const service=createInventoryBatch({actions:createInventoryActions(f.deps),operationStore:f.store,locator:f.deps.locator,filePath:path.join(dir,'batch.json')}),p=await service.prepare({kind,refs:[f.ref]}),r=await service.start(p.batchId);assert.equal(r.state,'completed');assert.equal(f.state.mutations.length,2);assert.equal(f.state.mutations[0].init.method,'DELETE');assert.equal(r.items[0].finalLocation.location,kind==='sell'?'sold':'converted');
 });
}
