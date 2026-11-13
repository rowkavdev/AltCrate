const test=require('node:test'),assert=require('node:assert/strict');
const {createItemRanking}=require('../electron/itemRanking.cjs');
const id='a'.repeat(24),other='b'.repeat(24);
test('unproven individual ranking transport reports an exact gap without requests',async()=>{
 const service=createItemRanking();const result=await service.read({accountId:'a',itemId:id});
 assert.equal(result.state,'unavailable');assert.match(result.reason,/individual/i);assert.match(result.reason,/contrato/i);
});
test('observations are bound to account, item, identity and timestamp and expire',async()=>{
 let time=1000;const service=createItemRanking({now:()=>time,maxAgeMs:100});
 await service.observe({accountId:'a',itemId:id,identity:'variant-a',rank:3,observedAt:1000,sourceUpdatedAt:1000});
 assert.equal((await service.read({accountId:'a',itemId:id,identity:'variant-a'})).rank,3);
 assert.equal((await service.read({accountId:'b',itemId:id})).state,'unavailable');
 assert.equal((await service.read({accountId:'a',itemId:other})).state,'unavailable');
 assert.equal((await service.read({accountId:'a',itemId:id,identity:'variant-b'})).state,'identity-changed');
 time=1101;assert.equal((await service.read({accountId:'a',itemId:id,identity:'variant-a'})).state,'stale');
});
test('aggregate coverage, future timestamps and malformed rank never become individual rank',async()=>{
 const service=createItemRanking({now:()=>1000});
 for(const value of [{rankedSkins:1,totalSkins:10},{rank:0,observedAt:1000},{rank:1,observedAt:1001},{rank:1,observedAt:'yesterday'}])await assert.rejects(service.observe({accountId:'a',itemId:id,...value}));
});

test('explicit refresh uses the public declared individual rank route and Overall lowest scope',async()=>{
 const paths=[],saved=[];const service=createItemRanking({now:()=>1000,fetchForAccount:accountId=>async path=>{paths.push([accountId,path]);return {ok:true,json:async()=>({floatRanks:{lowestFloatBySkingroupRank:2,highestFloatBySkingroupRank:1},floatRanksUpdatedAt:new Date(990).toISOString()})};},save:async value=>saved.push(value)});
 await service.ready();assert.equal(service.read({accountId:'a',itemId:id}).state,'unavailable');assert.equal(paths.length,0);
 const result=await service.refresh({accountId:'a',itemId:id,identity:'variant-a'});assert.equal(result.rank,2);assert.equal(result.scope,'lowestFloatBySkingroupRank');assert.equal(result.observedAt,1000);assert.equal(result.sourceUpdatedAt,990);
 assert.deepEqual(paths,[['a','/api/inventory/skin/rank?skinId='+id]]);assert.equal(saved[0].version,1);
});
test('persistent cache reloads bounded allowlisted observations; a stale source is never refreshed by reading',async()=>{
 const entry={accountId:'a',itemId:id,identity:'variant-a',rank:2,scope:'lowestFloatBySkingroupRank',observedAt:1000,sourceUpdatedAt:100,cookie:'secret'};
 const service=createItemRanking({now:()=>1000,maxAgeMs:200,load:async()=>({version:1,entries:[entry]})});await service.ready();const result=service.read({accountId:'a',itemId:id,identity:'variant-a'});assert.equal(result.state,'stale');assert.equal(result.sourceUpdatedAt,100);assert.equal(result.cookie,undefined);
});
test('null or absent ranking is not converted into an exact position or a guessed #10+',async()=>{
 const service=createItemRanking({now:()=>1000,fetchForAccount:()=>async()=>({ok:true,json:async()=>({floatRanks:{lowestFloatBySkingroupRank:null,highestFloatBySkingroupRank:1},floatRanksUpdatedAt:new Date(990).toISOString()})})});
 const result=await service.refresh({accountId:'a',itemId:id,identity:'variant-a'});assert.equal(result.state,'unavailable');assert.equal(result.rank,null);assert.match(result.reason,/posição/i);
});
test('failed persistence never publishes a fresh ranking that was not saved',async()=>{
 const service=createItemRanking({now:()=>1000,save:async()=>{throw Error('disk full');}});await assert.rejects(service.observe({accountId:'a',itemId:id,identity:'variant-a',rank:1,observedAt:1000,sourceUpdatedAt:1000}),/disk full/);assert.equal(service.read({accountId:'a',itemId:id,identity:'variant-a'}).state,'unavailable');
});
test('429 and malformed source replies retain cached observation and never retry automatically',async()=>{
 let calls=0;const service=createItemRanking({now:()=>1000,fetchForAccount:()=>async()=>{calls++;return {ok:false,status:429,headers:{get:()=> '20'}};}});
 await service.observe({accountId:'a',itemId:id,identity:'variant-a',rank:1,observedAt:1000,sourceUpdatedAt:1000});await assert.rejects(service.refresh({accountId:'a',itemId:id,identity:'variant-a'}),error=>error.status===429&&error.retryAfter==='20');assert.equal(calls,1);assert.equal(service.read({accountId:'a',itemId:id,identity:'variant-a'}).rank,1);
});
test('malformed rank values and future source dates never overwrite a valid observation',async()=>{
 for(const body of [{floatRanks:{lowestFloatBySkingroupRank:'1'},floatRanksUpdatedAt:new Date(990).toISOString()},{floatRanks:{lowestFloatBySkingroupRank:0},floatRanksUpdatedAt:new Date(990).toISOString()},{floatRanks:{lowestFloatBySkingroupRank:1},floatRanksUpdatedAt:new Date(1001).toISOString()},{floatRanks:null}]){
  const service=createItemRanking({now:()=>1000,fetchForAccount:()=>async()=>({ok:true,json:async()=>body})});await service.observe({accountId:'a',itemId:id,identity:'variant-a',rank:3,observedAt:1000,sourceUpdatedAt:990});await assert.rejects(service.refresh({accountId:'a',itemId:id,identity:'variant-a'}));assert.equal(service.read({accountId:'a',itemId:id,identity:'variant-a'}).rank,3);
 }
});
test('saved cache is bounded and write ordering preserves distinct account observations',async()=>{
 const saves=[];const service=createItemRanking({now:()=>1000,maxEntries:1,save:async state=>{saves.push(state);}});
 await Promise.all(['a','b'].map(accountId=>service.observe({accountId,itemId:id,identity:'variant-a',rank:2,observedAt:1000,sourceUpdatedAt:990})));
 assert.equal(saves[1].entries.length,1);assert.equal(saves[1].entries[0].accountId,'b');assert.equal(service.read({accountId:'a',itemId:id}).state,'unavailable');assert.equal(service.read({accountId:'b',itemId:id}).rank,2);
});
