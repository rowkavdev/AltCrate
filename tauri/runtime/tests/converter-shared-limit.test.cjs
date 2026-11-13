const test=require('node:test'),assert=require('node:assert/strict');
const {createRequestCoordinator}=require('../engine/requestCoordinator.cjs');
const {createClickCoordinator}=require('../engine/clickCoordinator.cjs');
const {withRouteBudgets}=require('../engine/serverFarmRoutes.cjs');
const {createCoordinatedTransport}=require('../engine/coordinatedTransport.cjs');
const {createConverterApiFactory}=require('../engine/converterNetwork.cjs');
test('an inventory 429 holds queued converter and other-page reads on the same connection',async()=>{
 const memory=()=>{let value;return {load:async()=>value,save:async v=>{value=structuredClone(v)}};},stores=[memory(),memory()],coordinator=withRouteBudgets({coordinator:createClickCoordinator({store:stores[0]}),routeCoordinator:createClickCoordinator({store:stores[1]}),routeFor:()=> 'direct',accountIds:()=>['inventory','converter','overview']}),queue=createRequestCoordinator({maxInFlight:1}),sent=[];
 const inventory=createCoordinatedTransport({requestWork:queue,coordinator,fetchForAccount:account=>async()=>{sent.push(account.id);return new Response('{}',{status:429,headers:{'Retry-After':'60'}});}});
 const converter=createConverterApiFactory({requestWork:queue,coordinator,network:{fetch:async account=>{sent.push(account.id);return new Response('[]');}}});
 const first=inventory({id:'inventory'})('/api/inventory?page=1'),other=inventory({id:'overview'})('/api/inventory?value=true'),review=converter({id:'converter'}).converterCases();
 const results=await Promise.allSettled([first,other,review]);assert.equal(results[0].value.status,429);assert.deepEqual(sent,['inventory']);
 for(const result of results.slice(1)){assert.equal(result.status,'rejected');assert.equal(result.reason.status,429);assert.equal(result.reason.notSent,true);assert.ok(result.reason.retryAt>Date.now());}
 // The existing persisted route budget also protects the same connection after a restart.
 const restored=withRouteBudgets({coordinator:createClickCoordinator({store:stores[0]}),routeCoordinator:createClickCoordinator({store:stores[1]}),routeFor:()=> 'direct',accountIds:()=>['converter']});
 assert.ok(await restored.cooldown('converter')>Date.now());assert.deepEqual(sent,['inventory']);
});
