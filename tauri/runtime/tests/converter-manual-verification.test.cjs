const test=require('node:test'),assert=require('node:assert/strict');
const {createTokenConverter}=require('../engine/tokenConverter.cjs');
const {createConverterApiFactory}=require('../engine/converterNetwork.cjs');
const {createRequestCoordinator}=require('../engine/requestCoordinator.cjs');
const {consolidationFixture}=require('./helpers/consolidation-fixture.cjs');
test('manual result verification cancels background readiness before reading the saved operation',async t=>{
 const f=await consolidationFixture(t,{noItems:true}),unknown={operationId:'pending',accountId:'source',sourceIdentity:'source-identity',state:'unconfirmed',sold:0,sequencePlan:{selectedSteps:['sell']},pending:{kind:'seq-sell',id:'a'.repeat(24),before:1,amount:1,beforeMoney:0,maximumCredit:70}};
 let service,entered,first=true;const waiting=new Promise(resolve=>entered=resolve),reads=[];
 const factory=createConverterApiFactory({requestWork:createRequestCoordinator(),coordinator:{cooldown:async()=>0},captureMutationGuard:()=>service.dispatchGuard(),network:{fetch:async(_account,path,init)=>{
  reads.push(path);if(first){first=false;entered();return new Promise((resolve,reject)=>{init.signal?.addEventListener('abort',()=>reject(Error('background cancelled')),{once:true});});}
  return new Response(JSON.stringify(path==='/api/me'?{tokens:200,money:70,membership:'free',rank:{id:18},inventoryCount:0,inventorySize:100,caseOpenCount:2,maxCaseOpenMultiplier:3,dailyTradesLeft:100,tradeItems:6}:[]));
 }}});
 service=createTokenConverter({...f.deps,apiForAccount:factory,store:{...f.deps.store,load:async()=>({version:1,rows:[unknown]})}});
 const inspecting=service.inspect({accountIds:['source'],steps:['transfer']});await waiting;
 const verifying=service.verify('pending');const result=await Promise.race([verifying,new Promise((_,reject)=>setTimeout(()=>reject(Error('manual verification blocked behind background readiness')),150))]);
 assert.equal(result.rows[0].state,'stopped',result.rows[0].message);assert.equal(result.rows[0].sold,1);assert.equal((await inspecting).cancelled,true);assert.deepEqual(reads,['/api/me','/api/me','/api/cases']);
});
