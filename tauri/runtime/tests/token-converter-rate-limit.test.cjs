const test=require('node:test'),assert=require('node:assert/strict');
const {consolidationFixture,settled}=require('./helpers/consolidation-fixture.cjs');
const {createTokenConverter}=require('../engine/tokenConverter.cjs');
const config={action:'sequence',accountIds:['source'],steps:['sell'],routing:'selected'};
async function start(service){const preview=await service.prepare(config);await service.start({action:'sequence',previewId:preview.previewId});return settled(service);}
const sales=f=>f.requests.filter(r=>r.path==='/api/cases'&&r.method==='DELETE');

test('a known cooldown pauses the reviewed sequence before sending a sale',async t=>{
 const f=await consolidationFixture(t,{cases:5,noItems:true}),until=Date.now()+60000;
 const service=createTokenConverter({...f.deps,coordinator:{cooldown:async()=>f.saved()?.phase==='running'?until:0}});
 const result=await start(service),row=result.rows[0];
 assert.equal(row.state,'stopped',row.message);assert.equal(row.retryAt,until);assert.equal(result.retryAt,until);
 assert.equal(row.canReviewNext,true);assert.equal(sales(f).length,0);assert.equal(f.saved().rows[0].pending,undefined);
});

test('an explicit HTTP 429 rejection keeps the stock and review scope without replaying',async t=>{
 const f=await consolidationFixture(t,{cases:5,noItems:true});let attempts=0,until=0;
 const service=createTokenConverter({...f.deps,coordinator:{cooldown:async()=>until,limit:async value=>{until=value;}},
  apiForAccount:account=>({...f.deps.apiForAccount(account),sellCase:async()=>{attempts++;return {ok:false,status:429,retryAfter:'60',message:'HTTP 429'};}})});
 const before=Date.now(),result=await start(service),row=result.rows[0];
 assert.equal(row.state,'stopped',row.message);assert.equal(row.canReviewNext,true);
 assert.ok(row.retryAt>=before+60000&&row.retryAt<=Date.now()+60000);assert.equal(result.retryAt,row.retryAt);
 assert.equal(f.saved().rows[0].pending,null);assert.equal(f.caseStock.source[0].amount,5);assert.equal(attempts,1);
 await assert.rejects(service.prepare({...config,resumeOperationIds:[row.operationId]}),e=>e.status===429&&e.retryAt===row.retryAt);
 assert.equal(attempts,1);
});

test('HTTP 429 after an accepted sale preserves the intent and read-only verification never resells',async t=>{
 let limited=true,until=0;
 const f=await consolidationFixture(t,{cases:5,noItems:true,beforeRequest:async({path,method,caseStock})=>{
  if(limited&&path==='/api/cases'&&method==='GET'&&caseStock.source[0].amount===0)
   throw Object.assign(Error('HTTP 429'),{status:429,retryAfter:'60'});
 }});
 const service=createTokenConverter({...f.deps,coordinator:{cooldown:async()=>until,limit:async value=>{until=value;}}});
 let result=await start(service);assert.equal(result.phase,'blocked');assert.equal(result.rows[0].state,'unconfirmed');
 assert.equal(f.saved().rows[0].pending.kind,'seq-sell');assert.equal(sales(f).length,1);
 limited=false;until=0;
 // Model an expired server deadline on a restarted journal, without changing its pending intent.
 const journal=f.saved();journal.retryAt=Date.now()-1;journal.rows[0].retryAt=Date.now()-1;
 const recovered=createTokenConverter({...f.deps,store:{load:async()=>journal,save:f.deps.store.save},coordinator:{cooldown:async()=>0}});
 await recovered.ready();await recovered.verify(result.rows[0].operationId);result=recovered.status();
 assert.equal(result.phase,'idle');assert.equal(result.rows[0].state,'stopped',result.rows[0].message);
 assert.equal(result.rows[0].sold,5);assert.equal(f.saved().rows[0].pending,null);assert.equal(sales(f).length,1);
});

test('a preparation rate limit is emitted and persists across restart',async t=>{
 let limited=true;const events=[];
 const f=await consolidationFixture(t,{cases:5,beforeRequest:async({path})=>{
  if(limited&&path==='/api/me')throw Object.assign(Error('HTTP 429'),{status:429,retryAfter:'60'});
 }}),service=createTokenConverter({...f.deps,emit:event=>events.push(event)});
 await assert.rejects(service.prepare(config),e=>e.status===429);
 assert.ok(f.saved().retryAt>Date.now());assert.ok(events.some(e=>e.status.retryAt>Date.now()));
 limited=false;const recovered=createTokenConverter(f.deps);await recovered.ready();
 await assert.rejects(recovered.prepare(config),e=>e.status===429);assert.equal(sales(f).length,0);
});

test('identity and inventory preparation rate limits also persist the converter deadline',async t=>{
 const identity=await consolidationFixture(t,{cases:5});
 const service=createTokenConverter({...identity.deps,locator:{...identity.deps.locator,identity:async()=>{throw Object.assign(Error('HTTP 429'),{status:429,retryAfter:'60'});}}});
 await assert.rejects(service.prepare(config),e=>e.status===429);assert.ok(identity.saved()?.retryAt>Date.now());
 const inventory=await consolidationFixture(t,{beforeRequest:async({path})=>path.startsWith('/api/inventory?')?new Response('{}',{status:429,headers:{'Retry-After':'60'}}):undefined});
 await assert.rejects(inventory.service.prepare({...config,steps:['convert-inventory']}),e=>e.status===429&&e.retryAfter==='60');
 assert.ok(inventory.saved()?.retryAt>Date.now());
});

test('a rejected child conversion reports a stopped converter with a durable deadline',async t=>{
 const f=await consolidationFixture(t,{tokens:0,beforeRequest:async({path,method})=>{
  if(path==='/api/casino/skinToTokens'&&method==='POST')return new Response('{}',{status:429,headers:{'Retry-After':'60'}});
 }});
 const preview=await f.service.prepare({...config,steps:['convert-inventory']});await f.service.start({action:'sequence',previewId:preview.previewId});
 const result=await settled(f.service),row=result.rows[0];assert.equal(row.state,'stopped',row.message);assert.ok(result.retryAt>Date.now());
 assert.equal(f.saved().rows[0].pending,null);assert.equal(f.stock.source.length,1);assert.equal(f.me.source.tokens,0);
 assert.equal(f.requests.filter(r=>r.path==='/api/casino/skinToTokens').length,1);
});

test('stop during child revalidation prevents the later conversion dispatch',async t=>{
 let f;f=await consolidationFixture(t,{tokens:0,coordinated:true,beforeRequest:async({path})=>{
  if(path.startsWith('/api/inventory?')&&f?.saved()?.rows[0]?.pending?.kind==='inventory-child')await f.service.stop();
 }});
 const preview=await f.service.prepare({...config,steps:['convert-inventory']});await f.service.start({action:'sequence',previewId:preview.previewId});
 const result=await settled(f.service);assert.equal(result.rows[0].state,'stopped',result.rows[0].message);
 assert.equal(f.requests.filter(r=>r.path==='/api/casino/skinToTokens').length,0);assert.equal(f.me.source.tokens,0);assert.equal(f.stock.source.length,1);
});

test('a rejected child trade creation preserves Retry-After without inventing a pending trade',async t=>{
 const f=await consolidationFixture(t,{tokens:0,beforeRequest:async({path,method})=>{
  if(path==='/api/trading'&&method==='POST')return new Response('{}',{status:429,headers:{'Retry-After':'60'}});
 }}),before=Date.now();
 const preview=await f.service.prepare({...config,steps:['transfer'],destinationAccountId:'destination'});await f.service.start({action:'sequence',previewId:preview.previewId});
 const result=await settled(f.service);assert.equal(result.rows[0].state,'stopped',result.rows[0].message);
 assert.ok(result.retryAt>=before+60000&&result.retryAt<=Date.now()+60000);assert.equal(f.saved().rows[0].pending,null);
 assert.equal(f.requests.filter(r=>r.path==='/api/trading'&&r.method==='POST').length,1);assert.equal(f.commands.length,0);
});
