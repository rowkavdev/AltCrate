const test=require('node:test'),assert=require('node:assert/strict');
const {consolidationFixture,settled}=require('./helpers/consolidation-fixture.cjs');
const {createTokenConverter}=require('../engine/tokenConverter.cjs');
const config={accountIds:['source'],destinationAccountId:'destination',includeInventory:true};
test('non-Pro consolidates reviewed inventory through skins, transfers exact IDs and protects existing main inventory',async t=>{
 const f=await consolidationFixture(t),preview=await f.service.prepare(config);assert.equal(f.requests.filter(r=>r.method!=='GET').length,0);
 await f.service.start({action:'consolidate',previewId:preview.previewId});const result=await settled(f.service);
 assert.equal(result.rows[0].state,'confirmed',result.rows[0].message);assert.equal(result.sentTokens,300);assert.equal(f.me.destination.tokens,350);
 assert.deepEqual(f.stock.destination.map(i=>i._id),[f.mainId]);assert.equal(f.stock.source.length,0);
 assert.equal(f.commands.filter(c=>c.event==='tradeAddTokens').length,0);
 assert.equal(f.requests.filter(r=>r.path==='/api/casino/skinToTokens'&&r.body.id===f.mainId).length,0);
 assert.equal(f.requests.filter(r=>r.path==='/api/casino/tokensToSkins'&&r.method==='POST').length,1);
});
test('Pro keeps direct token sending and does not mint skins',async t=>{
 const f=await consolidationFixture(t,{pro:true}),preview=await f.service.prepare(config);await f.service.start({action:'consolidate',previewId:preview.previewId});const result=await settled(f.service);
 assert.equal(result.rows[0].state,'confirmed',result.rows[0].message);assert.equal(result.sentTokens,300);assert.equal(f.commands.filter(c=>c.event==='tradeAddTokens').length,1);assert.equal(f.requests.filter(r=>r.path==='/api/casino/tokensToSkins'&&r.method==='POST').length,0);
});
test('balances above 100 million are split into bounded batches, with each arrival converted before the next trade',async t=>{
 const f=await consolidationFixture(t,{tokens:100000010,noItems:true}),preview=await f.service.prepare({...config,includeInventory:false});await f.service.start({action:'consolidate',previewId:preview.previewId});const result=await settled(f.service);
 assert.equal(result.rows[0].state,'confirmed',result.rows[0].message);assert.deepEqual(f.requests.filter(r=>r.path==='/api/casino/tokensToSkins'&&r.method==='POST').map(r=>r.body.tokens),[100000000,10]);assert.equal(result.sentTokens,100000010);
});
test('stop after converting original inventory is resumable and does not convert the same source item twice',async t=>{
 const f=await consolidationFixture(t,{stopAfterOriginal:true}),preview=await f.service.prepare(config);await f.service.start({action:'consolidate',previewId:preview.previewId});let result=await settled(f.service);
 assert.equal(result.rows[0].canResume,true);await f.service.resume(result.rows[0].operationId);result=await settled(f.service);
 assert.equal(result.rows[0].state,'confirmed',result.rows[0].message);assert.equal(f.requests.filter(r=>r.path==='/api/casino/skinToTokens'&&r.body.id===f.originalId).length,1);
});
test('lost mint response remains blocked after restart and only read verification recovers the known skins',async t=>{
 const f=await consolidationFixture(t,{lostMint:true}),preview=await f.service.prepare(config);await f.service.start({action:'consolidate',previewId:preview.previewId});let result=await settled(f.service);assert.equal(result.rows[0].state,'unconfirmed');
 const recovered=createTokenConverter(f.deps);await recovered.ready();await assert.rejects(recovered.start({action:'consolidate',previewId:preview.previewId}));await recovered.verify(result.rows[0].operationId);result=recovered.status();
 assert.equal(result.rows[0].canResume,true);assert.equal(f.requests.filter(r=>r.path==='/api/casino/tokensToSkins'&&r.method==='POST').length,1);await assert.rejects(recovered.acknowledge(result.rows[0].operationId));
});
test('a lost outer child response is recovered by preview ID without replaying the item conversion',async t=>{
 const f=await consolidationFixture(t),confirm=f.deps.inventoryActions.confirm;let lost=false;
 f.deps.inventoryActions.confirm=async id=>{const value=await confirm(id);if(!lost){lost=true;throw Error('Lost child response');}return value;};
 const preview=await f.service.prepare(config);await f.service.start({action:'consolidate',previewId:preview.previewId});let result=await settled(f.service);assert.equal(result.rows[0].state,'unconfirmed');
 const recovered=createTokenConverter(f.deps);await recovered.ready();await recovered.verify(result.rows[0].operationId);assert.equal(recovered.status().rows[0].canResume,true);
 await recovered.resume(result.rows[0].operationId);result=await settled(recovered);assert.equal(result.rows[0].state,'confirmed',result.rows[0].message);
 assert.equal(f.requests.filter(r=>r.path==='/api/casino/skinToTokens'&&r.body.id===f.originalId).length,1);
});
test('a changed recipient stops skin trades before adding or confirming an item',async t=>{
 const f=await consolidationFixture(t,{unexpectedGuest:true}),preview=await f.service.prepare(config);await f.service.start({action:'consolidate',previewId:preview.previewId});const result=await settled(f.service);
 assert.equal(result.rows[0].state,'unconfirmed');assert.equal(f.commands.filter(c=>['tradeAddSkins','tradeConfirm'].includes(c.event)).length,0);
 assert.equal(result.rows[0].pendingItems,1);await f.service.acknowledge(result.rows[0].operationId);assert.equal(f.service.status().rows[0].state,'unconfirmed');
});
test('a finished trade without verified skin arrival is never converted in the destination',async t=>{
 const f=await consolidationFixture(t,{missingArrival:true}),preview=await f.service.prepare(config);await f.service.start({action:'consolidate',previewId:preview.previewId});const result=await settled(f.service);
 assert.equal(result.rows[0].state,'unconfirmed');assert.equal(f.requests.filter(r=>r.accountId==='destination'&&r.path==='/api/casino/skinToTokens').length,0);
});
test('a Pro transfer can be re-observed after its first arrival check failed',async t=>{
 const f=await consolidationFixture(t,{pro:true,missingArrival:true}),preview=await f.service.prepare(config);await f.service.start({action:'consolidate',previewId:preview.previewId});const result=await settled(f.service);
 assert.equal(result.rows[0].state,'unconfirmed');f.me.destination.tokens+=300;await f.service.verify(result.rows[0].operationId);
 assert.equal(f.service.status().rows[0].state,'confirmed',f.service.status().rows[0].message);
});
test('a new consolidation cannot discard legacy sticker IDs awaiting explicit conversion',async t=>{
 const f=await consolidationFixture(t);await f.deps.store.save({version:1,phase:'idle',action:'open',rows:[{operationId:'legacy',accountId:'source',state:'stopped',remainingSkinIds:['f'.repeat(24)],sentTokens:0}]});
 const recovered=createTokenConverter(f.deps);await recovered.ready();await assert.rejects(recovered.prepare(config),/sticker|anterior|pendente/i);
});
test('an item gaining a top float rank after review is protected at the final individual check',async t=>{
 const f=await consolidationFixture(t),prepare=f.deps.inventoryActions.prepare;let changed=false;
 f.deps.inventoryActions.prepare=async request=>{if(!changed&&request.kind==='convert'){changed=true;f.stock.source[0].floatRanks={lowestFloatBySkingroupRank:1};}return prepare(request);};
 const preview=await f.service.prepare(config);await f.service.start({action:'consolidate',previewId:preview.previewId});const result=await settled(f.service);
 assert.notEqual(result.rows[0].state,'confirmed');assert.equal(f.requests.filter(r=>r.path==='/api/casino/skinToTokens').length,0);assert.equal(f.stock.source[0]._id,f.originalId);
});
test('stop between outer intention and inner confirmation remains resumable with zero item mutations',async t=>{
 const f=await consolidationFixture(t);let service,stopped=false;
 service=createTokenConverter({...f.deps,emit:()=>{if(!stopped&&f.saved()?.rows?.[0]?.pending?.kind==='inventory-child'&&!f.records.size){stopped=true;void service.stop();}}});
 const preview=await service.prepare(config);await service.start({action:'consolidate',previewId:preview.previewId});const result=await settled(service);
 assert.equal(f.requests.filter(r=>r.method!=='GET').length,0);assert.equal(f.records.size,0);assert.equal(result.rows[0].canResume,true,result.rows[0].message);
 await service.resume(result.rows[0].operationId);assert.equal((await settled(service)).rows[0].state,'confirmed');
});
test('a restart at the outer intention boundary proves the inner request was not sent and allows explicit resume',async t=>{
 const f=await consolidationFixture(t);let service,checkpoint;
 service=createTokenConverter({...f.deps,emit:()=>{if(!checkpoint&&f.saved()?.rows?.[0]?.pending?.kind==='inventory-child'&&!f.records.size){checkpoint=structuredClone(f.saved());void service.stop();}}});
 const preview=await service.prepare(config);await service.start({action:'consolidate',previewId:preview.previewId});await settled(service);await f.deps.store.save(checkpoint);
 const recovered=createTokenConverter(f.deps);await recovered.ready();const id=recovered.status().rows[0].operationId;await recovered.verify(id);
 assert.equal(recovered.status().rows[0].canResume,true);assert.equal(f.requests.filter(r=>r.method!=='GET').length,0);
 await recovered.resume(id);assert.equal((await settled(recovered)).rows[0].state,'confirmed');
});
