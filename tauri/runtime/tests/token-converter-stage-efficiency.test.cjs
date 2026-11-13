const test=require('node:test'),assert=require('node:assert/strict');
const {consolidationFixture,settled}=require('./helpers/consolidation-fixture.cjs');
const {createTokenConverter}=require('../engine/tokenConverter.cjs');
const {createSequenceReview}=require('../engine/converterSequenceReview.cjs');
async function run(service,steps){const p=await service.prepare({action:'sequence',accountIds:['source'],steps});await service.start({action:'sequence',previewId:p.previewId});return settled(service);}
const calls=(f,path,method='GET')=>f.requests.filter(r=>r.path===path&&r.method===method);

test('twenty conversions reuse the individually verified token balances without twenty extra reads',async t=>{
 const f=await consolidationFixture(t);
 f.stock.source=Array.from({length:20},(_,i)=>({_id:(100+i).toString(16).padStart(24,'0'),name:'Skin '+i,price:10,isFavorite:false}));
 const result=await run(f.service,['convert-inventory']);
 assert.equal(result.rows[0].state,'confirmed',result.rows[0].message);assert.equal(result.rows[0].converted,20);
 assert.equal(f.me.source.tokens,2200);assert.equal(f.stock.source.length,0);assert.equal(f.saved().rows[0].pending,null);
 assert.equal(calls(f,'/api/casino/skinToTokens','POST').length,20);
 assert.ok(calls(f,'/api/me').length<=42,'a confirmed conversion should not need another balance request');
});

test('an older confirmed child record without observed tokens still gets a fresh balance read',async t=>{
 const f=await consolidationFixture(t),actions={...f.deps.inventoryActions,confirm:async id=>{
  const result=await f.deps.inventoryActions.confirm(id);delete result.operation.observedTokens;return result;
 }};
 const service=createTokenConverter({...f.deps,inventoryActions:actions});
 const result=await run(service,['convert-inventory']);
 assert.equal(result.rows[0].state,'confirmed',result.rows[0].message);assert.equal(result.rows[0].converted,1);
 assert.equal(f.me.source.tokens,300);assert.equal(calls(f,'/api/me').length,5);
});

test('ten opening batches reuse confirmed resources and preserve all sixty identified drops',async t=>{
 const f=await consolidationFixture(t,{capsules:60,noItems:true}),result=await run(f.service,['open']);
 assert.equal(result.rows[0].state,'paused',result.rows[0].message);assert.equal(result.rows[0].opened,60);
 assert.equal(result.rows[0].pendingStickers,60);assert.equal(f.caseStock.source[1].amount,0);
 assert.equal(new Set(f.stock.source.map(item=>item._id)).size,60);assert.equal(calls(f,'/api/open/capsule','POST').length,10);
 assert.ok(calls(f,'/api/cases').length<=13,'opening reread stock already verified after the previous batch');
 assert.ok(calls(f,'/api/me').length<=13,'opening reread settings already verified after the previous batch');
 assert.equal(f.saved().rows[0].pending,null);
});

test('opening resource reuse still detects an identity change before the second batch',async t=>{
 const f=await consolidationFixture(t,{capsules:12,noItems:true});let checks=0;
 const service=createTokenConverter({...f.deps,transport:{...f.deps.transport,identity:async account=>++checks>=3?'changed':f.deps.transport.identity(account)}});
 const result=await run(service,['open']);assert.equal(result.rows[0].state,'failed');
 assert.equal(result.rows[0].opened,6);assert.equal(calls(f,'/api/open/capsule','POST').length,1);
 assert.equal(f.caseStock.source[1].amount,6);
});

test('capsules changing during drop verification never allow a second opening from stale stock',async t=>{
 let changed=false;
 const f=await consolidationFixture(t,{capsules:12,noItems:true,beforeRequest:({path,caseStock})=>{
  if(!changed&&path.startsWith('/api/inventory?')&&caseStock.source[1].amount===6){changed=true;caseStock.source[1].amount+=6;}
 }}),result=await run(f.service,['open']);
 assert.equal(calls(f,'/api/open/capsule','POST').length,1,'stock changed during the inventory scan but another opening was sent');
 assert.equal(result.rows[0].state,'unconfirmed');assert.equal(f.caseStock.source[1].amount,12);
 assert.equal(f.saved().rows[0].pending.kind,'seq-open');assert.equal(f.saved().rows[0].pending.skinIds.length,6);
 assert.equal(new Set(f.stock.source.map(i=>i._id)).size,6);
});

test('fifty source reviews share one main trading check and revalidate it at confirmation',async()=>{
 const accounts=[...Array.from({length:50},(_,i)=>({id:'source-'+i,label:'Source '+i})),{id:'main',label:'Main'}];
 let unlocked=true,mainChecks=0;
 const service=createSequenceReview({listAccounts:async()=>accounts,locator:{identity:async id=>id+'-identity'},readInventory:async()=>{throw Error('Token route should not read inventory');},read:async(account,work)=>work({
  converterProfile:async()=>({membership:'pro',tokens:100,money:0,inventoryCount:0,inventorySize:100,dailyTradesLeft:100}),
  tradingStatus:async()=>{if(account.id==='main')mainChecks++;return {isUnlocked:account.id==='main'?unlocked:true};},
 })});
 const config={accountIds:accounts.slice(0,50).map(a=>a.id),destinationAccountId:'main',steps:['transfer'],routing:'auto'};
 const preview=await service.prepare(config);assert.equal(preview.rows.length,50);assert.equal(mainChecks,1);
 await service.consume(preview.previewId);assert.equal(mainChecks,2);
 const next=await service.prepare(config);unlocked=false;
 await assert.rejects(service.consume(next.previewId),/Trocas bloqueadas/);assert.equal(mainChecks,4);
});
