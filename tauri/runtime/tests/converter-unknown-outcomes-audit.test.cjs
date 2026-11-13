const test=require('node:test'),assert=require('node:assert/strict');
const {createTokenConverter}=require('../engine/tokenConverter.cjs');
const {createInventoryActions}=require('../engine/inventoryActions.cjs');
const {consolidationFixture,settled}=require('./helpers/consolidation-fixture.cjs');
async function run(service,steps,extra={}){const review=await service.prepare({action:'sequence',accountIds:['source'],steps,...extra});await service.start({action:'sequence',previewId:review.previewId});return settled(service);}
async function lostConversion(t){let injected=false;return consolidationFixture(t,{beforeRequest:({path,method,accountId,body,me,stock})=>{
 if(injected||path!=='/api/casino/skinToTokens'||method!=='POST')return;
 injected=true;const at=stock[accountId].findIndex(i=>i._id===body.id);me[accountId].tokens+=stock[accountId][at].price*10;stock[accountId].splice(at,1);throw Error('lost successful conversion response');
}});}
async function lostOpening(t){let injected=false;return consolidationFixture(t,{noItems:true,capsules:2,beforeRequest:({path,method,caseStock,stock})=>{
 if(injected||path!=='/api/open/capsule'||method!=='POST')return;
 injected=true;caseStock.source[1].amount-=2;stock.source.push(...['d','e'].map(x=>({_id:x.repeat(24),name:'Opened sticker',price:10,isFavorite:false})));throw Error('lost successful opening response');
}});}
test('a lost conversion reply has an explicit closure that preserves child provenance and its item reservation after restart',async t=>{
 const f=await lostConversion(t);let s=await run(f.service,['convert-inventory']);
 const service=createTokenConverter(f.deps);await service.ready();s=await service.verify(s.rows[0].operationId);const id=s.rows[0].operationId;
 assert.equal(s.rows[0].state,'unconfirmed');assert.equal(s.rows[0].converted,0);assert.equal(s.rows[0].canCloseUnresolved,true);
 const intent=structuredClone(f.saved().rows[0].pending);s=await service.closeUnresolved(id);
 assert.equal(s.rows[0].state,'unresolved');assert.equal(s.rows[0].verified,false);assert.equal(s.rows[0].converted,0);assert.equal(s.sentTokens,0);assert.deepEqual(f.saved().rows[0].pending,intent);
 const child=[...f.records.values()][0];assert.equal(child.state,'unresolved');assert.equal(child.verified,false);assert.equal(child.intent,'convert');assert.equal(child.item.id,f.originalId);assert.equal(child.resolution.kind,'unresolved-conversion');
 const reloaded=createInventoryActions({...f.deps,store:f.deps.operationStore});await reloaded.list();assert.equal(reloaded.isItemReserved('source',f.originalId),true);
 await assert.rejects(reloaded.prepare({kind:'convert',ref:{accountId:'source',itemId:f.originalId,page:1,storageUnitId:null}}),/pendente|reservad|confirm/i);
 const restarted=createTokenConverter(f.deps);await restarted.ready();assert.equal(restarted.status().rows[0].state,'unresolved');await restarted.verify(id);
 assert.equal(f.requests.filter(r=>r.path==='/api/casino/skinToTokens'&&r.method==='POST').length,1);assert.equal(f.me.source.tokens,300);
});
test('a lost opening reply can be closed after complete diagnostics while unknown inventory scope stays isolated',async t=>{
 const f=await lostOpening(t);let s=await run(f.service,['open','convert-stickers']);const id=s.rows[0].operationId;
 const service=createTokenConverter(f.deps);await service.ready();s=await service.verify(id);
 assert.equal(s.rows[0].state,'unconfirmed');assert.equal(s.rows[0].unconfirmedResults,2);assert.equal(s.rows[0].canCloseUnresolved,true);
 assert.equal(s.rows[0].verification.inventory.read,2);assert.equal(s.rows[0].verification.unknownResultScope,true);
 const intent=structuredClone(f.saved().rows[0].pending);s=await service.closeUnresolved(id);
 assert.equal(s.rows[0].state,'unresolved');assert.equal(s.rows[0].opened,0);assert.equal(s.rows[0].converted,0);assert.equal(s.rows[0].canReviewNext,false);assert.deepEqual(s.rows[0].lockedAccountIds,['source']);assert.deepEqual(f.saved().rows[0].pending,intent);assert.equal(f.saved().rows[0].resolution.scope.kind,'unknown-opening-results');
 const restarted=createTokenConverter(f.deps);await restarted.ready();assert.equal(restarted.status().rows[0].state,'unresolved');assert.equal(restarted.blocksAccount('source'),true);
 await assert.rejects(restarted.prepare({action:'sequence',independent:true,accountIds:['source'],steps:['convert-inventory']}),/pendente|confirmar|isolad|resultado/i);
 await restarted.verify(id);assert.equal(restarted.status().rows[0].state,'unresolved');assert.equal(f.requests.filter(r=>r.path==='/api/open/capsule'&&r.method==='POST').length,1);assert.equal(f.requests.some(r=>r.path==='/api/casino/skinToTokens'),false);
 await restarted.prepare({action:'sequence',independent:true,accountIds:['source'],steps:['sell']});
});
test('unknown opening closure refuses an incomplete diagnostic and never sends another opening',async t=>{
 const f=await lostOpening(t);const s=await run(f.service,['open']);const service=createTokenConverter({...f.deps,readInventory:async()=>{throw Error('offline inventory');}});await service.ready();const result=await service.verify(s.rows[0].operationId);
 assert.equal(result.rows[0].canCloseUnresolved,false);await assert.rejects(service.closeUnresolved(s.rows[0].operationId));assert.equal(f.requests.filter(r=>r.path==='/api/open/capsule'&&r.method==='POST').length,1);
});
test('legacy destination conversion excludes a simultaneous unrelated token credit',async t=>{
 let external=false;const f=await consolidationFixture(t,{noItems:true,beforeRequest:({path,method,accountId,me})=>{if(!external&&accountId==='destination'&&path==='/api/casino/skinToTokens'&&method==='POST'){external=true;me.destination.tokens+=1000;}}});
 const review=await f.service.prepare({accountIds:['source'],destinationAccountId:'destination',includeInventory:false});await f.service.start({action:'consolidate',previewId:review.previewId});const s=await settled(f.service);
 assert.equal(s.rows[0].state,'confirmed');assert.equal(s.rows[0].receivedTokens,200);assert.equal(s.sentTokens,200);assert.equal(f.me.destination.tokens,1250);assert.equal(f.saved().rows[0].mintSpent,200);
});
test('closing an unknown opening keeps another saved session of the same identity isolated',async t=>{
 const f=await lostOpening(t);let s=await run(f.service,['open']);s=await f.service.verify(s.rows[0].operationId);await f.service.closeUnresolved(s.rows[0].operationId);
 const service=createTokenConverter({...f.deps,locator:{...f.deps.locator,identity:async accountId=>accountId==='destination'?'source-identity':f.deps.locator.identity(accountId)}});await service.ready();
 await assert.rejects(service.prepare({action:'sequence',independent:true,accountIds:['destination'],steps:['convert-inventory']}),/identidade|isolad|confirmar/i);assert.equal(f.requests.some(r=>r.path==='/api/casino/skinToTokens'),false);
});
test('a missing child journal prevents conversion closure even after a complete diagnostic',async t=>{
 const f=await lostConversion(t);let s=await run(f.service,['convert-inventory']);s=await f.service.verify(s.rows[0].operationId);f.records.clear();
 await assert.rejects(f.service.closeUnresolved(s.rows[0].operationId),/correla|individual|registo/i);assert.equal(f.service.status().rows[0].state,'unconfirmed');assert.equal(f.requests.filter(r=>r.path==='/api/casino/skinToTokens'&&r.method==='POST').length,1);
});
test('failure to persist child closure keeps the parent pending and the item reserved',async t=>{
 const f=await lostConversion(t);let s=await run(f.service,['convert-inventory']);s=await f.service.verify(s.rows[0].operationId);
 const store=f.deps.operationStore,put=store.put;store.put=async r=>{if(r.state==='unresolved')throw Error('disk full');return put(r);};
 await assert.rejects(f.service.closeUnresolved(s.rows[0].operationId),/disk full/);assert.equal(f.service.status().rows[0].state,'unconfirmed');assert.equal([...f.records.values()][0].state,'unconfirmed');assert.equal(f.deps.inventoryActions.isItemReserved('source',f.originalId),true);
});
test('an identity change during unknown opening diagnostics cannot authorize closure',async t=>{
 const f=await lostOpening(t);const s=await run(f.service,['open']);let checks=0;
 const service=createTokenConverter({...f.deps,transport:{...f.deps.transport,identity:async()=>++checks===1?'source-identity':'different-identity'}});await service.ready();const result=await service.verify(s.rows[0].operationId);
 assert.equal(result.rows[0].canCloseUnresolved,false);await assert.rejects(service.closeUnresolved(s.rows[0].operationId));
});
test('an identity change during conversion diagnostics cannot authorize parent closure',async t=>{
 const f=await lostConversion(t);const s=await run(f.service,['convert-inventory']);let checks=0;
 const service=createTokenConverter({...f.deps,transport:{...f.deps.transport,identity:async()=>++checks===1?'source-identity':'different-identity'}});await service.ready();const result=await service.verify(s.rows[0].operationId);
 assert.equal(result.rows[0].canCloseUnresolved,false);await assert.rejects(service.closeUnresolved(s.rows[0].operationId));
});
test('a saved child closure remains recoverable if parent persistence fails and verification is repeated after restart',async t=>{
 const f=await lostConversion(t);let s=await run(f.service,['convert-inventory']);let rejectParent=true;
 const service=createTokenConverter({...f.deps,store:{...f.deps.store,save:async value=>{if(rejectParent&&value.rows.some(r=>r.state==='unresolved'))throw Error('parent disk full');return f.deps.store.save(value);}}});await service.ready();s=await service.verify(s.rows[0].operationId);
 await assert.rejects(service.closeUnresolved(s.rows[0].operationId),/parent disk full/);assert.equal([...f.records.values()][0].state,'unresolved');assert.equal(service.status().rows[0].state,'unconfirmed');rejectParent=false;
 const restarted=createTokenConverter(f.deps);await restarted.ready();s=await restarted.verify(s.rows[0].operationId);assert.equal(s.rows[0].canCloseUnresolved,true);s=await restarted.closeUnresolved(s.rows[0].operationId);assert.equal(s.rows[0].state,'unresolved');assert.equal(f.requests.filter(r=>r.path==='/api/casino/skinToTokens'&&r.method==='POST').length,1);
});
