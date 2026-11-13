const test=require('node:test'),assert=require('node:assert/strict');
const {consolidationFixture,settled}=require('./helpers/consolidation-fixture.cjs');
const {createCaseApi}=require('../engine/api.cjs');
const {createTokenConverter}=require('../engine/tokenConverter.cjs');
const config=steps=>({action:'sequence',accountIds:['source'],steps});
const writes=f=>f.requests.filter(r=>r.method!=='GET');
async function start(service,steps,extra={}){const p=await service.prepare({...config(steps),...extra});await service.start({action:'sequence',previewId:p.previewId});return settled(service);}

test('opening policy reads both actual server config shapes and rejects unverified autosell flags',async()=>{
 for(const wrapped of [false,true]){
  const raw={autosellActivated:true,autosellAmount:500,autosellVariant:'money'},seen=[];
  const api=createCaseApi(async(path,init)=>{seen.push([path,init.method]);return new Response(JSON.stringify(wrapped?{config:raw}:raw));});
  assert.equal(typeof api.converterOpeningPolicy,'function');
  assert.deepEqual(await api.converterOpeningPolicy(),raw);assert.deepEqual(seen,[['/api/user/autoOpen/config','GET']]);
 }
 const malformed=createCaseApi(async()=>new Response('{}'));
 await assert.rejects(()=>malformed.converterOpeningPolicy(),/configura|automática|venda/i);
});

test('site autosell is reviewed as automatic preparation before any mutation',async t=>{
 const f=await consolidationFixture(t,{money:200,autosell:true});
 const p=await f.service.prepare(config(['buy','open','convert-stickers']));assert.equal(p.rows[0].prerequisites[0].kind,'disable-autosell');
 assert.equal(writes(f).length,0);assert.equal(f.me.source.money,200);
});

test('enabling autosell after review is caught before the purchase is dispatched',async t=>{
 const f=await consolidationFixture(t,{money:200}),preview=await f.service.prepare(config(['buy','open']));
 f.openingPolicies.source.autosellActivated=true;
 await assert.rejects(f.service.start({action:'sequence',previewId:preview.previewId}),/mudou|revê/i);assert.equal(writes(f).length,0);
});

test('opening without conversion rejects a stock exceeding inventory space before buying',async t=>{
 const f=await consolidationFixture(t,{money:200,capsules:9,inventorySize:10});
 await assert.rejects(f.service.prepare(config(['buy','open'])),/espaço|inventário/i);assert.equal(writes(f).length,0);
});

test('autosell enabled during a converted batch stops before opening another batch',async t=>{
 let changed=false,f;f=await consolidationFixture(t,{capsules:12,inventorySize:10,enforceCapacity:true,beforeRequest:({path,method})=>{
  if(!changed&&path==='/api/casino/skinToTokens'&&method==='POST'){changed=true;f.openingPolicies.source.autosellActivated=true;}
 }});
 const result=await start(f.service,['open','convert-stickers']);
 assert.equal(f.requests.filter(r=>r.path==='/api/open/capsule'&&r.method==='POST').length,1);
 assert.equal(result.rows[0].state,'failed');assert.equal(f.saved().rows[0].pending,null);
 assert.equal(result.rows[0].converted,6);assert.equal(f.caseStock.source[1].amount,6);
});

test('missing returned drops remain explicitly counted as unconfirmed instead of zero results',async t=>{
 const f=await consolidationFixture(t,{capsules:3,noItems:true,beforeRequest:({path,method,body,caseStock})=>{
  if(path==='/api/open/capsule'&&method==='POST'){
   caseStock.source[1].amount-=body.count*body.caseOpenMultiplier;
   return new Response(JSON.stringify([101,102,103].map(n=>({_id:n.toString(16).padStart(24,'0')}))));
  }
 }}),result=await start(f.service,['open']);
 assert.equal(result.rows[0].state,'unconfirmed');assert.equal(result.rows[0].opened,0);
 assert.equal(result.rows[0].handoffCounts.source,0);assert.equal(result.rows[0].unconfirmedResults,3);
 assert.equal(f.saved().rows[0].pending.skinIds.length,3);assert.equal(f.requests.filter(r=>r.path==='/api/open/capsule'&&r.method==='POST').length,1);
});

test('open plus convert drains each identified batch before opening more than the inventory can hold',async t=>{
 const f=await consolidationFixture(t,{capsules:12,inventorySize:10,enforceCapacity:true});
 f.stock.source=Array.from({length:7},(_,i)=>({_id:(100+i).toString(16).padStart(24,'0'),name:'Original '+i,price:10,isFavorite:false}));
 const original=f.stock.source.map(i=>i._id),result=await start(f.service,['open','convert-stickers']);
 assert.equal(result.rows[0].state,'confirmed',result.rows[0].message);assert.equal(result.rows[0].opened,12);assert.equal(result.rows[0].converted,12);
 assert.equal(result.rows[0].pendingStickers,0);assert.deepEqual(f.stock.source.map(i=>i._id),original);assert.equal(f.me.source.tokens,1400);
 assert.equal(f.requests.filter(r=>r.path==='/api/open/capsule'&&r.method==='POST').reduce((n,r)=>n+r.body.count*r.body.caseOpenMultiplier,0),12);
 assert.ok(writes(f).some(r=>r.path==='/api/casino/skinToTokens'));
 const first=f.requests.findIndex(r=>r.path==='/api/open/capsule'&&r.method==='POST'),second=f.requests.findIndex((r,i)=>i>first&&r.path==='/api/open/capsule'&&r.method==='POST');
 assert.ok(f.requests.slice(first+1,second).some(r=>r.path==='/api/casino/skinToTokens'&&r.method==='POST'));
});

test('restart with a saved sticker buffer converts it before continuing the remaining openings',async t=>{
 let stopped=false,f;f=await consolidationFixture(t,{capsules:12,inventorySize:10,enforceCapacity:true,beforeRequest:async({path,caseStock})=>{
  if(!stopped&&path.startsWith('/api/inventory?')&&caseStock.source[1].amount===6){stopped=true;await f.service.stop();}
 }});
 let result=await start(f.service,['open','convert-stickers']);
 assert.equal(result.rows[0].state,'stopped',result.rows[0].message);assert.equal(result.rows[0].opened,6);assert.equal(result.rows[0].pendingStickers,6);
 const recovered=createTokenConverter(f.deps);await recovered.ready();
 result=await start(recovered,['open','convert-stickers'],{resumeOperationIds:[result.rows[0].operationId]});
 assert.equal(result.rows[0].state,'confirmed',result.rows[0].message);assert.equal(result.rows[0].opened,12);assert.equal(result.rows[0].converted,12);
 assert.equal(f.stock.source.length,1);assert.equal(f.stock.source[0]._id,f.originalId);assert.equal(f.me.source.tokens,1400);
 assert.equal(f.requests.filter(r=>r.path==='/api/open/capsule'&&r.method==='POST').length,2);
});
