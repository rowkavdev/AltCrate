const test=require('node:test'),assert=require('node:assert/strict');
const {consolidationFixture,settled}=require('./helpers/consolidation-fixture.cjs');
const {createTokenConverter}=require('../engine/tokenConverter.cjs');
async function run(service,steps,extra={}){const p=await service.prepare({action:'sequence',accountIds:['source'],steps,...extra});await service.start({action:'sequence',previewId:p.previewId});return settled(service);}
test('external token credits during conversion never enlarge the reviewed mint budget',async t=>{
 let injected=false;const f=await consolidationFixture(t,{beforeRequest:({path,method,accountId,me})=>{if(!injected&&accountId==='source'&&path==='/api/casino/skinToTokens'&&method==='POST'){injected=true;me.source.tokens+=1000;}}});
 await run(f.service,['convert-inventory','mint']);const spent=f.requests.filter(r=>r.path==='/api/casino/tokensToSkins'&&r.method==='POST').reduce((sum,r)=>sum+r.body.tokens,0);assert.ok(spent<=300,'mint consumed '+spent+' tokens instead of at most the reviewed 300');
});
test('external money credits during selling are never spent as case proceeds',async t=>{
 let injected=false;const f=await consolidationFixture(t,{money:50,cases:5,beforeRequest:({path,method,me})=>{if(!injected&&path==='/api/cases'&&method==='DELETE'){injected=true;me.source.money+=1000;}}});
 await run(f.service,['sell','buy']);const bought=f.requests.filter(r=>r.path==='/api/cases'&&r.method==='POST').reduce((sum,r)=>sum+r.body.amount,0);assert.ok(bought<=4,'bought '+bought+' capsules using unreviewed money');
});
test('external credits in main are not counted as tokens received from the sequence',async t=>{
 let injected=false;const f=await consolidationFixture(t,{noItems:true,beforeRequest:({path,method,accountId,me})=>{if(!injected&&accountId==='destination'&&path==='/api/casino/skinToTokens'&&method==='POST'){injected=true;me.destination.tokens+=1000;}}});
 const s=await run(f.service,['mint','transfer','convert-received'],{destinationAccountId:'destination'});assert.equal(s.rows[0].state,'confirmed',s.rows[0].message);assert.equal(s.rows[0].receivedTokens,200);assert.equal(s.sentTokens,200);
});
test('local continuation preserves already received main items without requiring or changing main',async t=>{
 const f=await consolidationFixture(t,{noItems:true,capsules:1});let s=await run(f.service,['open','mint','transfer'],{destinationAccountId:'destination'});assert.deepEqual(s.rows[0].handoffCounts,{source:1,destination:1});
 const before=f.stock.destination.map(i=>i._id);s=await run(f.service,['convert-stickers'],{resumeOperationIds:[s.rows[0].operationId]});assert.equal(s.rows[0].state,'paused',s.rows[0].message);assert.deepEqual(s.rows[0].handoffCounts,{source:0,destination:1});assert.deepEqual(f.stock.destination.map(i=>i._id),before);
});
test('restart at the first waiting continuation checkpoint offers review and never sends automatically',async t=>{
 const f=await consolidationFixture(t,{noItems:true});let s=await run(f.service,['mint']);let crashed=false;
 const service=createTokenConverter({...f.deps,store:{...f.deps.store,save:async value=>{await f.deps.store.save(value);if(!crashed&&value.rows.some(r=>r.state==='waiting')){crashed=true;throw Error('Simulated crash at durable waiting checkpoint');}}}});
 await service.ready();const p=await service.prepare({action:'sequence',accountIds:['source'],steps:['transfer'],destinationAccountId:'destination',resumeOperationIds:[s.rows[0].operationId]});await assert.rejects(service.start({action:'sequence',previewId:p.previewId}),/crash/i);
 const recovered=createTokenConverter(f.deps);await recovered.ready();s=recovered.status();assert.equal(s.rows[0].canReviewNext,true);assert.equal(f.commands.filter(c=>c.event==='tradeAddSkins').length,0);
 s=await run(recovered,['transfer'],{destinationAccountId:'destination',resumeOperationIds:[s.rows[0].operationId]});assert.equal(s.rows[0].state,'paused',s.rows[0].message);assert.equal(f.commands.filter(c=>c.event==='tradeAddSkins').length,1);
});
test('unstarted sequence rows beyond fifty workers are reviewable after restart',async t=>{
 const f=await consolidationFixture(t,{noItems:true});await run(f.service,['mint']);const saved=structuredClone(f.saved()),template=saved.rows[0];saved.rows=Array.from({length:51},(_,i)=>({...structuredClone(template),operationId:'waiting-'+i,accountId:'source-'+i,state:'waiting'}));
 const recovered=createTokenConverter({...f.deps,store:{...f.deps.store,load:async()=>saved}});await recovered.ready();assert.equal(recovered.status().rows.filter(r=>r.canReviewNext).length,51);assert.equal(f.commands.length,0);
});
