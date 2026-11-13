const test=require('node:test'),assert=require('node:assert/strict');
const {consolidationFixture}=require('./helpers/consolidation-fixture.cjs');
const {createSequenceReview}=require('../engine/converterSequenceReview.cjs');
const steps=['sell','buy','open','convert-stickers','mint','transfer','convert-received'];
test('new streaming openings do not scan existing skins when space is already available',async t=>{
 const f=await consolidationFixture(t,{capsules:12,inventorySize:100});
 const preview=await f.service.prepare({action:'sequence',accountIds:['source'],steps:['open','convert-stickers']});
 assert.equal(preview.rows[0].inventoryCount,1);assert.deepEqual(preview.rows[0].stickerItems,[]);
 assert.equal(f.requests.filter(r=>r.path.startsWith('/api/inventory?')).length,0);
 assert.equal(f.requests.some(r=>r.method!=='GET'),false);
});
test('a fifty-account review only scans stock required by selected existing-inventory actions',async()=>{
 const sources=Array.from({length:50},(_,i)=>({id:'source-'+i,label:'Source '+i})),accounts=[...sources,{id:'main',label:'Main'}],calls=[];
 const review=createSequenceReview({listAccounts:async()=>accounts,locator:{identity:async id=>id},readInventory:async id=>{calls.push('inventory:'+id);return {skins:[],pages:1,count:0};},read:async(account,work)=>work({
  converterProfile:async()=>({membership:'free',tokens:100,money:100,rank:20,inventoryCount:account.id==='main'?0:350,inventorySize:1000,dailyTradesLeft:100}),
  converterOpeningConfiguration:async()=>({config:{autosellActivated:false,autosellAmount:0,autosellVariant:'money'}}),
  tradingStatus:async()=>({isUnlocked:true}),converterCases:async()=>[{id:'64d9ecad463b7ffa9697e2ea',type:'capsule',amount:12}],converterCapsule:async()=>({id:'64d9ecad463b7ffa9697e2ea',price:100,rankNeeded:11})
 })});
 const p=await review.prepare({accountIds:sources.map(a=>a.id),destinationAccountId:'main',steps});
 assert.equal(p.rows.length,50);assert.deepEqual(calls,[]);
 // Final consumption still revalidates current state independently of the prepared review.
 assert.equal((await review.consume(p.previewId)).rows.length,50);assert.deepEqual(calls,[]);
});
test('existing-inventory conversion still scans the current items in preparation and final consumption',async t=>{
 const f=await consolidationFixture(t,{capsules:2,inventorySize:100});
 const p=await f.service.prepare({action:'sequence',accountIds:['source'],steps:['open','convert-stickers','convert-inventory']});
 assert.equal(f.requests.filter(r=>r.path.startsWith('/api/inventory?')).length,1);
 f.stock.source[0].price=999;
 await assert.rejects(f.service.start({action:'sequence',previewId:p.previewId}),/mudou|revê/i);
 assert.equal(f.requests.some(r=>r.method!=='GET'),false);
});
