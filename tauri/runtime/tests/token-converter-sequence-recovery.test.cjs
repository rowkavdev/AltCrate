const test=require('node:test'),assert=require('node:assert/strict');
const {consolidationFixture,settled}=require('./helpers/consolidation-fixture.cjs');
const {createTokenConverter}=require('../engine/tokenConverter.cjs');
test('mint, restart, transfer, restart and convert received never repeat any mutation',async t=>{
 const f=await consolidationFixture(t,{noItems:true});let service=f.service;
 async function run(steps,extra={}){const p=await service.prepare({action:'sequence',accountIds:['source'],steps,...extra});await service.start({action:'sequence',previewId:p.previewId});return settled(service);}
 let s=await run(['mint']);const op=s.rows[0].operationId;assert.equal(s.rows[0].state,'paused',s.rows[0].message);
 service=createTokenConverter(f.deps);await service.ready();s=await run(['transfer'],{resumeOperationIds:[op],destinationAccountId:'destination'});assert.equal(s.rows[0].state,'paused',s.rows[0].message);
 service=createTokenConverter(f.deps);await service.ready();s=await run(['convert-received'],{resumeOperationIds:[op],destinationAccountId:'destination'});assert.equal(s.rows[0].state,'confirmed',s.rows[0].message);
 assert.equal(f.me.destination.tokens,250);assert.deepEqual(f.stock.destination.map(i=>i._id),[f.mainId]);assert.equal(f.requests.filter(r=>r.path==='/api/casino/tokensToSkins'&&r.method==='POST').length,1);assert.equal(f.requests.filter(r=>r.path==='/api/casino/skinToTokens'&&r.method==='POST').length,1);assert.equal(f.commands.filter(c=>c.event==='tradeAddSkins').length,1);
 await assert.rejects(service.start({action:'sequence',previewId:'consumed'}));
});
test('paused items cannot be discarded by a fresh sequence or old resume',async t=>{
 const f=await consolidationFixture(t,{noItems:true});const p=await f.service.prepare({action:'sequence',accountIds:['source'],steps:['mint']});await f.service.start({action:'sequence',previewId:p.previewId});const s=await settled(f.service);
 await assert.rejects(f.service.prepare({action:'sequence',accountIds:['source'],steps:['sell']}),/anterior|identific|continu/i);await assert.rejects(f.service.resume(s.rows[0].operationId),/revis|etapas/i);assert.equal(f.saved().rows[0].handoffs.length,1);
});
test('a lost mint reply is verified by reads and a reviewed continuation never mints again',async t=>{
 const f=await consolidationFixture(t,{noItems:true,lostMint:true});const p=await f.service.prepare({action:'sequence',accountIds:['source'],destinationAccountId:'destination',steps:['mint','transfer','convert-received']});await f.service.start({action:'sequence',previewId:p.previewId});let s=await settled(f.service);assert.equal(s.rows[0].state,'unconfirmed');
 const service=createTokenConverter(f.deps);await service.ready();await service.verify(s.rows[0].operationId);s=service.status();assert.equal(s.rows[0].state,'stopped',s.rows[0].message);
 const next=await service.prepare({action:'sequence',accountIds:['source'],destinationAccountId:'destination',steps:['mint','transfer','convert-received'],resumeOperationIds:[s.rows[0].operationId]});await service.start({action:'sequence',previewId:next.previewId});s=await settled(service);assert.equal(s.rows[0].state,'confirmed',s.rows[0].message);assert.equal(f.requests.filter(r=>r.path==='/api/casino/tokensToSkins'&&r.method==='POST').length,1);
});
test('continuing one origin preserves a different paused origin and all its known items',async t=>{
 const f=await consolidationFixture(t,{noItems:true});const p=await f.service.prepare({action:'sequence',accountIds:['source'],steps:['mint']});await f.service.start({action:'sequence',previewId:p.previewId});const s=await settled(f.service),saved=structuredClone(f.saved());const other={...structuredClone(saved.rows[0]),accountId:'other',operationId:'other-op',sourceIdentity:'other-identity'};saved.rows.push(other);
 const service=createTokenConverter({...f.deps,store:{...f.deps.store,load:async()=>saved}});await service.ready();const next=await service.prepare({action:'sequence',accountIds:['source'],destinationAccountId:'destination',steps:['transfer'],resumeOperationIds:[s.rows[0].operationId]});await service.start({action:'sequence',previewId:next.previewId});await settled(service);const preserved=f.saved().rows.find(r=>r.operationId==='other-op');assert.deepEqual(preserved,other);
});
