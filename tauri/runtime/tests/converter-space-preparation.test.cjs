const test=require('node:test'),assert=require('node:assert/strict');
const {consolidationFixture,settled}=require('./helpers/consolidation-fixture.cjs');
const id=n=>n.toString(16).padStart(24,'0');
const config={action:'sequence',independent:true,accountIds:['source'],steps:['buy','open','convert-stickers','mint']};
test('full inventory preparation reviews only the cheapest necessary unprotected items and starts the chosen stages',async t=>{
 const f=await consolidationFixture(t,{noItems:true,money:100,tokens:0,inventorySize:2});
 f.stock.source.push({_id:id(100),name:'Cheap',price:1},{_id:id(101),name:'Next',price:2},{_id:id(102),name:'Favorite',price:100,isFavorite:true});
 const p=await f.service.prepare(config),prep=p.rows[0].prerequisites.find(s=>s.kind==='free-inventory');assert.deepEqual(prep.items.map(i=>i.id),[id(100),id(101)]);assert.equal(f.requests.some(r=>r.method!=='GET'),false);
 await f.service.start({action:'sequence',previewId:p.previewId});const result=await settled(f.service);assert.equal(result.rows[0].state,'paused');assert.equal(result.rows[0].bought,1);assert.equal(result.rows[0].opened,1);assert.equal(result.rows[0].mintedItems,1);assert.equal(f.stock.source.some(i=>i._id===id(102)),true);
 assert.deepEqual(f.requests.filter(r=>r.path==='/api/casino/skinToTokens').map(r=>r.body.id).slice(0,2),[id(100),id(101)]);
});
test('preparation never selects favorite, special or unknown-result items even when they are cheaper',async t=>{
 const f=await consolidationFixture(t,{noItems:true,inventorySize:4,tokens:10});
 f.stock.source.push({_id:id(100),name:'Favorite',price:0.01,isFavorite:true},{_id:id(101),name:'Pattern',price:0.02,hasPattern:true,patternName:'Tier 4'},{_id:id(102),name:'Protected rank',price:0.03,floatRanks:{lowestFloatBySkinRank:1}},{_id:id(103),name:'Eligible',price:4});
 const p=await f.service.prepare({...config,steps:['mint']});assert.deepEqual(p.rows[0].prerequisites[0].items.map(i=>i.id),[id(103)]);
});
test('inventory conversion already selected before mint provides its space without an extra preparation conversion',async t=>{
 const f=await consolidationFixture(t,{inventorySize:1});const p=await f.service.prepare({...config,steps:['convert-inventory','mint']});assert.deepEqual(p.rows[0].prerequisites,[]);
 await f.service.start({action:'sequence',previewId:p.previewId});await settled(f.service);assert.equal(f.requests.filter(r=>r.path==='/api/casino/skinToTokens').length,1);
});
test('sell-only stages do not free inventory and insufficient safe stock reports the shortage before any write',async t=>{
 const f=await consolidationFixture(t,{noItems:true,inventorySize:1});f.stock.source.push({_id:id(100),name:'Favorite',price:2,isFavorite:true});
 const p=await f.service.prepare({...config,steps:['sell']});assert.deepEqual(p.rows[0].prerequisites,[]);
 await assert.rejects(f.service.prepare({...config,steps:['mint']}),/espaço|proteg|libertar/i);assert.equal(f.requests.some(r=>r.method!=='GET'),false);
});
test('a partial shortage reads eligible stock and frees only the missing slot',async t=>{
 const f=await consolidationFixture(t,{inventorySize:3,capsules:3});const p=await f.service.prepare({...config,steps:['open']});assert.equal(p.rows[0].prerequisites[0].items.length,1);
});
test('a no-op mint with less than one token does not convert existing skins to create a budget',async t=>{
 const f=await consolidationFixture(t,{inventorySize:1,tokens:0.5});const p=await f.service.prepare({...config,steps:['mint']});assert.deepEqual(p.rows[0].prerequisites,[]);
 await f.service.start({action:'sequence',previewId:p.previewId});await settled(f.service);assert.equal(f.requests.some(r=>r.method!=='GET'),false);
});
test('the option for all existing skins converts them before opening and only once',async t=>{
 const f=await consolidationFixture(t,{noItems:true,inventorySize:4,capsules:2});f.stock.source.push({_id:id(100),name:'One',price:1},{_id:id(101),name:'Two',price:2},{_id:id(102),name:'Favorite',price:100,isFavorite:true});
 const p=await f.service.prepare({...config,steps:['open','convert-stickers','convert-inventory']});assert.equal(p.rows[0].prerequisites.find(p=>p.kind==='convert-existing').items.length,2);
 await f.service.start({action:'sequence',previewId:p.previewId});await settled(f.service);const mutations=f.requests.filter(r=>r.method!=='GET');assert.deepEqual(mutations.slice(0,2).map(r=>r.body.id),[id(100),id(101)]);assert.equal(mutations[2].path,'/api/open/capsule');assert.equal(f.stock.source.length,1);assert.equal(f.stock.source[0]._id,id(102));
});
test('resuming interrupted existing-inventory preparation keeps the reviewed remainder without replay',async t=>{
 const f=await consolidationFixture(t,{inventorySize:2,capsules:1,stopAfterOriginal:true});f.stock.source.push({_id:id(101),name:'Remainder',price:20},{_id:id(102),name:'Favorite',price:100,isFavorite:true});
 const cfg={...config,independent:false,steps:['open','convert-stickers','convert-inventory']},p=await f.service.prepare(cfg);await f.service.start({action:'sequence',previewId:p.previewId});await settled(f.service);const row=f.service.status().rows[0];assert.equal(row.state,'stopped');
 const next=await f.service.prepare({...cfg,resumeOperationIds:[row.operationId]});assert.deepEqual(next.rows[0].prerequisites.find(p=>p.kind==='convert-existing').items.map(i=>i.id),[id(101)]);
 await f.service.start({action:'sequence',previewId:next.previewId});await settled(f.service);assert.equal(f.requests.filter(r=>r.path==='/api/casino/skinToTokens'&&r.body.id===f.originalId).length,1);assert.equal(f.requests.filter(r=>r.path==='/api/casino/skinToTokens'&&r.body.id===id(101)).length,1);
});
