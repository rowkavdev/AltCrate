const test=require('node:test'),assert=require('node:assert/strict');
const {consolidationFixture,settled}=require('./helpers/consolidation-fixture.cjs');
const {createTokenConverter}=require('../engine/tokenConverter.cjs');
async function start(f,steps,extra={}){const preview=await f.service.prepare({action:'sequence',accountIds:['source'],steps,routing:'selected',...extra});await f.service.start({action:'sequence',previewId:preview.previewId});return settled(f.service);}
const mutations=f=>f.requests.filter(r=>r.method!=='GET');
test('sell and buy finish with capsules and never open, convert or transfer',async t=>{
 const f=await consolidationFixture(t,{money:50,cases:5});const s=await start(f,['sell','buy']);
 assert.equal(s.rows[0].state,'confirmed',s.rows[0].message);assert.equal(s.rows[0].sold,5);assert.equal(s.rows[0].bought,4);
 assert.equal(f.caseStock.source[1].amount,4);assert.deepEqual(mutations(f).map(r=>r.path),['/api/cases','/api/cases']);assert.equal(f.commands.length,0);
});
test('buy and open stop with identified stickers and no conversions',async t=>{
 const f=await consolidationFixture(t,{money:200,noItems:true});const s=await start(f,['buy','open']);
 assert.equal(s.rows[0].state,'paused',s.rows[0].message);assert.equal(s.rows[0].opened,2);assert.equal(s.rows[0].pendingStickers,2);assert.equal(f.stock.source.length,2);
 assert.equal(mutations(f).filter(r=>r.path==='/api/casino/skinToTokens').length,0);assert.equal(f.commands.length,0);
});
test('open plus convert only converts identified drops and leaves old source stock intact',async t=>{
 const f=await consolidationFixture(t,{capsules:3});const s=await start(f,['open','convert-stickers']);
 assert.equal(s.rows[0].state,'confirmed',s.rows[0].message);assert.equal(s.rows[0].converted,3);assert.deepEqual(f.stock.source.map(i=>i._id),[f.originalId]);assert.equal(f.me.source.tokens,500);
});
test('a lost purchase reply is reconciled after restart without buying again',async t=>{
 const f=await consolidationFixture(t,{money:200,noItems:true,lostBuy:true});let s=await start(f,['buy','open']);assert.equal(s.rows[0].state,'unconfirmed');
 const recovered=createTokenConverter(f.deps);await recovered.ready();await recovered.verify(s.rows[0].operationId);s=recovered.status();assert.equal(s.rows[0].state,'stopped',s.rows[0].message);
 const p=await recovered.prepare({action:'sequence',accountIds:['source'],steps:['buy','open'],resumeOperationIds:[s.rows[0].operationId]});await recovered.start({action:'sequence',previewId:p.previewId});s=await settled(recovered);
 assert.equal(s.rows[0].opened,2,s.rows[0].message);assert.equal(f.requests.filter(r=>r.path==='/api/cases'&&r.method==='POST').length,1);
});
