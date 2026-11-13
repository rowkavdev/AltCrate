const test=require('node:test'),assert=require('node:assert/strict');
const {consolidationFixture,settled}=require('./helpers/consolidation-fixture.cjs');
const {createTokenConverter}=require('../engine/tokenConverter.cjs');
const ids=Array.from({length:25},(_,i)=>(100+i).toString(16).padStart(24,'0'));
async function fixture(t,{count=25,beforeRequest,apiForAccount,transport}={}){
 let f;f=await consolidationFixture(t,{noItems:true,beforeRequest:async request=>{
  const result=await beforeRequest?.({...request,f});if(result)return result;
  if(request.path==='/api/cases/cases')return new Response(JSON.stringify(ids.slice(0,count).map(id=>({_id:id,price:70}))));
 }});
 f.caseStock.source=ids.slice(0,count).map((id,i)=>({_id:id,type:'case',amount:1+i%5}));
 let started=false;
 const service=createTokenConverter({...f.deps,...(transport?{transport:transport(f)}:{}),...(apiForAccount?{apiForAccount:apiForAccount(f)}:{}),store:{...f.deps.store,save:async value=>{await f.deps.store.save(value);if(!started&&value.phase==='running'){started=true;f.requests.length=0;}}}});
 const prepare=async(s=service,steps=['sell'],extra={})=>s.prepare({action:'sequence',accountIds:['source'],steps,...extra});
 return {...f,service,prepare};
}
async function run(f){const p=await f.prepare();await f.service.start({action:'sequence',previewId:p.previewId});return settled(f.service);}
const calls=(f,path,method='GET')=>f.requests.filter(r=>r.path===path&&r.method===method);

test('selling 25 case types reuses each confirmed stock and balance for the following sale',async t=>{
 const f=await fixture(t),s=await run(f);
 assert.equal(s.rows[0].state,'confirmed',s.rows[0].message);assert.equal(s.rows[0].sold,75);
 assert.equal(calls(f,'/api/cases','DELETE').length,25);assert.ok(f.caseStock.source.every(box=>box.amount===0));
 assert.ok(calls(f,'/api/cases').length<=26,'repeated a stock read already confirmed after the preceding sale');
 assert.ok(calls(f,'/api/me').length<=26,'repeated a balance read already confirmed after the preceding sale');
 assert.equal(calls(f,'/api/auth/token').length,26,'session identity must still be checked before every sale');
 assert.equal(f.saved().rows[0].stepProgress.soldCases.length,25);assert.equal(f.saved().rows[0].pending,null);
});

test('a changed remaining case stock is caught in the confirmation before its sale',async t=>{
 let changed=false;
 const f=await fixture(t,{count:3,beforeRequest:({f,path,method,caseStock})=>{
  if(!changed&&path==='/api/me'&&method==='GET'&&f?.requests.some(r=>r.method==='DELETE')){changed=true;caseStock.source[1].amount=20;}
 }}),s=await run(f);
 assert.equal(s.rows[0].state,'failed');assert.equal(calls(f,'/api/cases','DELETE').length,1);
 assert.equal(f.caseStock.source[1].amount,20);assert.equal(s.rows[0].sold,1);
});

test('reusing confirmed stock never skips the identity check on the following sale',async t=>{
 let checks=0;const f=await fixture(t,{count:3,transport:f=>({...f.deps.transport,identity:async account=>{
  checks++;return checks>=3?'different-session':f.deps.transport.identity(account);
 }})}),s=await run(f);
 assert.equal(s.rows[0].state,'failed');assert.equal(calls(f,'/api/cases','DELETE').length,1);assert.equal(s.rows[0].sold,1);
});

test('a lost second sale response is recovered after restart without using or replaying old snapshots',async t=>{
 let lost=false;const f=await fixture(t,{count:3,apiForAccount:f=>account=>{
  const api=f.deps.apiForAccount(account);return {...api,sellCase:async(id,amount)=>{const result=await api.sellCase(id,amount);if(id===ids[1]&&!lost){lost=true;throw Error('Lost response');}return result;}};
 }});
 let s=await run(f);assert.equal(s.rows[0].state,'unconfirmed');assert.equal(s.rows[0].sold,1);assert.equal(f.saved().rows[0].pending.id,ids[1]);
 const recovered=createTokenConverter(f.deps);await recovered.ready();await recovered.verify(s.rows[0].operationId);s=recovered.status();assert.equal(s.rows[0].sold,3);
 const p=await f.prepare(recovered,['sell'],{resumeOperationIds:[s.rows[0].operationId]});await recovered.start({action:'sequence',previewId:p.previewId});s=await settled(recovered);
 assert.equal(s.rows[0].state,'confirmed',s.rows[0].message);assert.equal(s.rows[0].sold,6);assert.equal(calls(f,'/api/cases','DELETE').length,3);
});
