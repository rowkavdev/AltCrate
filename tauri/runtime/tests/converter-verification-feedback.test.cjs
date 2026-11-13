const test=require('node:test'),assert=require('node:assert/strict');
const {createTokenConverter}=require('../engine/tokenConverter.cjs');
const {consolidationFixture}=require('./helpers/consolidation-fixture.cjs');
const capsule='64d9ecad463b7ffa9697e2ea',missing='f'.repeat(24);
function pendingRow(id){return {operationId:'pending',accountId:'source',sourceIdentity:'source-identity',state:'unconfirmed',sold:0,opened:0,sequencePlan:{selectedSteps:['open']},pending:{kind:'seq-open',id:capsule,before:2,amount:2,skinIds:[id,missing]}};}
test('manual verification publishes progress and a durable pending result when an expected sticker is missing',async t=>{
 const f=await consolidationFixture(t);f.stock.source.push(...Array.from({length:100},(_,i)=>({_id:(i+1).toString(16).padStart(24,'0'),name:'Sticker',price:1})));
 const row=pendingRow(f.originalId);let entered,release;const waiting=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const service=createTokenConverter({...f.deps,store:{...f.deps.store,load:async()=>({version:1,rows:[row]})},readInventory:async(...args)=>{if(args[1]===1){entered();await gate;}return f.deps.readInventory(...args);}});
 const task=service.verify('pending');await waiting;
 assert.equal(service.status().rows[0].verification?.phase,'running');
 release();const result=await task,v=result.rows[0].verification;
 assert.equal(v.phase,'complete');assert.equal(v.outcome,'pending');assert.equal(v.expected,2);assert.equal(v.found,1);assert.equal(v.attempt,1);
 assert.deepEqual(v.inventory,{page:2,pages:2,read:101,total:101});assert.ok(Date.parse(v.startedAt));assert.ok(Date.parse(v.finishedAt));
 assert.equal(result.rows[0].state,'unconfirmed');assert.equal(result.rows[0].opened,0);assert.deepEqual(f.saved().rows[0].pending.skinIds,[f.originalId,missing]);
 assert.equal(f.requests.some(r=>r.method!=='GET'),false);assert.equal(f.commands.length,0);
 await service.verify('pending');assert.equal(service.status().rows[0].verification.attempt,2);
 // A later read may confirm the same saved operation; it must never replay the opening.
 f.stock.source.push({_id:missing,name:'Sticker',price:1});const confirmed=await service.verify('pending');
 assert.equal(confirmed.rows[0].verification.outcome,'confirmed');assert.equal(confirmed.rows[0].verification.found,2);assert.equal(confirmed.rows[0].state,'stopped');assert.equal(confirmed.rows[0].opened,2);assert.equal(f.saved().rows[0].pending,null);
 assert.equal(f.requests.some(r=>r.method!=='GET'),false);
});
test('restarting an interrupted verification exposes interruption without discarding pending item IDs',async t=>{
 const f=await consolidationFixture(t),row={...pendingRow(f.originalId),verification:{phase:'running',attempt:1,startedAt:'2026-10-17T10:00:00Z'}};
 const service=createTokenConverter({...f.deps,store:{...f.deps.store,load:async()=>({version:1,rows:[row]})}});await service.ready();
 const result=service.status().rows[0];assert.equal(result.verification?.phase,'interrupted');assert.equal(result.state,'unconfirmed');assert.deepEqual(f.saved().rows[0].pending.skinIds,[f.originalId,missing]);assert.equal(f.requests.length,0);
});
test('a known rejected child operation is not presented as a confirmed conversion',async t=>{
 const f=await consolidationFixture(t),row={operationId:'rejected',accountId:'source',sourceIdentity:'source-identity',state:'unconfirmed',originalConverted:0,sequencePlan:{selectedSteps:['convert-inventory'],tokenBudget:200},childOperations:[],pending:{kind:'inventory-child',childKind:'convert',accountId:'source',itemId:f.originalId,operationId:'child-rejected',beforeTokens:200,maximumCredit:100}};
 f.records.set('child-rejected',{operationId:'child-rejected',accountId:'source',ref:{accountId:'source',itemId:f.originalId},kind:'convert',state:'failed',verified:false,item:{id:f.originalId},message:'Conversion rejected',httpStatus:400});
 const service=createTokenConverter({...f.deps,store:{...f.deps.store,load:async()=>({version:1,rows:[row]})}});
 const result=await service.verify('rejected');assert.equal(result.rows[0].verification.outcome,'failed');assert.equal(result.rows[0].originalConverted,0);assert.equal(f.requests.some(r=>r.method!=='GET'),false);
});
test('manual acknowledgement replaces stale pending-verification feedback',async t=>{
 const f=await consolidationFixture(t),row={operationId:'legacy',accountId:'source',sourceIdentity:'source-identity',state:'unconfirmed',pending:{kind:'create'}};
 const service=createTokenConverter({...f.deps,store:{...f.deps.store,load:async()=>({version:1,rows:[row]})}});
 await service.verify('legacy');assert.equal(service.status().rows[0].verification.outcome,'pending');
 const result=await service.acknowledge('legacy');assert.equal(result.rows[0].state,'reviewed');assert.equal(result.rows[0].verification,undefined);assert.equal(f.requests.some(r=>r.method!=='GET'),false);
});
