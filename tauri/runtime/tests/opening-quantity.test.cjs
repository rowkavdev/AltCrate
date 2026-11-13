const test=require('node:test');
const assert=require('node:assert/strict');
const {createOpenScheduler}=require('../engine/openScheduler.cjs');
const id='691f90c11ff412261c423a3f';
const config={accounts:[{id:'a'},{id:'b'}],caseId:id,continuous:true,adaptive:true,concurrency:2,convert:false,maxPrice:0,conversionCap:null,maxCasesPerAccount:13};
function harness(extra={}){
 let clock=0,sequence=0;const stock={a:100,b:30},calls=[];
 const scheduler=createOpenScheduler({now:()=>clock,sleep:async ms=>{clock+=ms;},apiForAccount:account=>({
  snapshot:async()=>({cases:[{id,amount:stock[account.id]}],caseOpenCount:account.id==='a'?4:2,maxCaseOpenMultiplier:account.id==='a'?2:3}),
  openCase:async(_id,count,multiplier)=>{calls.push({account:account.id,count,multiplier});stock[account.id]-=count*multiplier;return {ok:true,status:200,skinIds:Array.from({length:count*multiplier},()=> (++sequence).toString(16).padStart(24,'0'))};},
 }),...extra});
 return {scheduler,stock,calls};
}
test('bounded quantity stops at exactly the requested number of cases in each account',async()=>{
 const h=harness();const status=await h.scheduler.start(config);
 assert.deepEqual(h.stock,{a:87,b:17});assert.equal(status.confirmed,26);assert.equal(status.phase,'complete');
 assert.deepEqual(status.accounts.map(a=>a.opened),[13,13]);
 assert(h.calls.some(call=>call.count===1&&call.multiplier===1),'The last remainder must not exceed the target');
});
test('bounded quantity cannot spend more than the account owns',async()=>{
 const h=harness();await h.scheduler.start({...config,maxCasesPerAccount:50});assert.deepEqual(h.stock,{a:50,b:0});
});
test('invalid bounded quantities are rejected before any game read or write',()=>{
 for(const maxCasesPerAccount of [0,-1,1.5,'13',10001,Infinity]){
  const h=harness();assert.throws(()=>h.scheduler.start({...config,maxCasesPerAccount}),/quantidade/i);assert.equal(h.calls.length,0);
 }
});
test('one-case mode ignores the account batch and multiplier',async()=>{
 const h=harness();const status=await h.scheduler.start({...config,accounts:[{id:'a'}],continuous:false,maxOpens:1,conversionCap:1,testOnce:true,maxCasesPerAccount:1});
 assert.deepEqual(h.stock,{a:99,b:30});assert.equal(status.confirmed,1);assert.deepEqual(h.calls,[{account:'a',count:1,multiplier:1}]);
});
