const test=require('node:test'),assert=require('node:assert/strict');
const {createSequenceReview}=require('../engine/converterSequenceReview.cjs');
const {consolidationFixture,settled}=require('./helpers/consolidation-fixture.cjs');
const id=n=>n.toString(16).padStart(24,'0');
function fixture({sources=1,itemCount=250}={}){
 const accounts=[...Array.from({length:sources},(_,i)=>({id:'source-'+i,label:'Source '+i})),{id:'main',label:'Main'}],calls=[];
 const profiles=Object.fromEntries(accounts.map(a=>[a.id,{membership:'free',tokens:100,money:0,rank:20,inventoryCount:a.id==='main'?0:itemCount,inventorySize:1000,dailyTradesLeft:100}]));
 const stock=Object.fromEntries(accounts.map((a,n)=>[a.id,a.id==='main'?[]:Array.from({length:itemCount},(_,i)=>({id:id(n*1000+i+1),name:'Skin '+i,type:'skin',price:1,quality:0,isFavorite:false}))]));
 const identities=Object.fromEntries(accounts.map(a=>[a.id,a.id+'-identity']));let clock=1000,run={rows:[]},beforePage=()=>{},beforeList=()=>{};
 const config={accountIds:accounts.filter(a=>a.id!=='main').map(a=>a.id),destinationAccountId:'main',steps:['convert-inventory','mint','transfer','convert-received']};
 const deps={listAccounts:async()=>{await beforeList();return accounts;},now:()=>clock,readRun:()=>run,locator:{identity:async accountId=>{calls.push(['identity',accountId]);return identities[accountId];}},read:async(account,work)=>work({converterProfile:async()=>{calls.push(['profile',account.id]);return {...profiles[account.id]};},tradingStatus:async()=>{calls.push(['trading',account.id]);return {isUnlocked:profiles[account.id].dailyTradesLeft>0};}}),readInventory:async(accountId,page)=>{calls.push(['inventory',accountId,page]);await beforePage(accountId,page);return {skins:structuredClone(stock[accountId].slice((page-1)*100,page*100)),pages:Math.max(1,Math.ceil(stock[accountId].length/100)),count:stock[accountId].length};}};
 return {service:createSequenceReview(deps),config,calls,profiles,stock,identities,advance:ms=>{clock+=ms;},setRun:value=>{run=value;},beforePage:fn=>{beforePage=fn;},beforeList:fn=>{beforeList=fn;}};
}
const inventoryCalls=f=>f.calls.filter(c=>c[0]==='inventory');
test('continuing only inventory conversion retains unconverted reviewed prerequisite items',async t=>{
 const f=await consolidationFixture(t,{inventorySize:3,capsules:1,stopAfterOriginal:true}),remainder='d'.repeat(24),outside='e'.repeat(24);
 f.stock.source.push({_id:remainder,name:'Reviewed remainder',price:20,isFavorite:false});
 const first=await f.service.prepare({action:'sequence',accountIds:['source'],steps:['open','convert-stickers','convert-inventory']});
 await f.service.start({action:'sequence',previewId:first.previewId});let result=await settled(f.service);assert.equal(result.rows[0].state,'stopped');
 f.stock.source.push({_id:outside,name:'Unreviewed arrival',price:50,isFavorite:false});
 const next=await f.service.prepare({action:'sequence',accountIds:['source'],steps:['convert-inventory'],resumeOperationIds:[result.rows[0].operationId]});
 assert.deepEqual(next.rows[0].items.map(item=>item.id),[remainder]);
 await f.service.start({action:'sequence',previewId:next.previewId});result=await settled(f.service);
 assert.equal(result.rows[0].state,'confirmed',result.rows[0].message);assert.equal(result.rows[0].converted,2);
 assert.deepEqual(f.stock.source.map(item=>item._id),[outside]);
 assert.equal(f.requests.filter(r=>r.path==='/api/casino/skinToTokens'&&r.body.id===remainder).length,1);
});
test('confirmation refreshes heads and live account guards while reusing reviewed inventory tails',async()=>{
 const f=fixture({sources:50,itemCount:150}),preview=await f.service.prepare(f.config),prepared=f.calls.length;
 assert.equal(prepared,253);f.calls.length=0;
 assert.equal((await f.service.consume(preview.previewId)).rows.length,50);
 assert.equal(f.calls.length,203);assert.equal(inventoryCalls(f).length,50);
 assert.ok(inventoryCalls(f).every(call=>call[2]===1));
 for(const kind of ['profile','identity','trading'])assert.equal(f.calls.filter(call=>call[0]===kind).length,51);
});
test('a failed preparation reuses successful tail pages on explicit retry and never retries the failed read itself',async()=>{
 const f=fixture();let failed=false;f.beforePage((_account,page)=>{if(page===3&&!failed){failed=true;throw Object.assign(Error('Quota reached'),{status:429});}});
 await assert.rejects(f.service.prepare(f.config),error=>error.status===429);
 assert.deepEqual(inventoryCalls(f).map(call=>call[2]),[1,2,3]);f.calls.length=0;
 const preview=await f.service.prepare(f.config);assert.equal(preview.rows[0].items.length,250);
 assert.deepEqual(inventoryCalls(f).map(call=>call[2]),[1,3]);
});
test('expired observations reread every inventory page and reject changed tail metadata',async()=>{
 const f=fixture(),preview=await f.service.prepare(f.config);f.calls.length=0;f.advance(30001);f.stock['source-0'][150].price=99;
 await assert.rejects(f.service.consume(preview.previewId),/mud|rev/i);assert.deepEqual(inventoryCalls(f).map(call=>call[2]),[1,2,3]);
});
test('changed head metadata invalidates all cached tail pages and prevents confirmation',async()=>{
 const f=fixture(),preview=await f.service.prepare(f.config);f.calls.length=0;f.stock['source-0'][0].price=99;
 await assert.rejects(f.service.consume(preview.previewId),/mud|rev/i);assert.deepEqual(inventoryCalls(f).map(call=>call[2]),[1,2,3]);
});
test('a changed head item type discards tails even when its action metadata and inventory count stay equal',async()=>{
 const f=fixture();await f.service.prepare(f.config);f.calls.length=0;f.stock['source-0'][0].type='terminal';
 const preview=await f.service.prepare(f.config);assert.equal(preview.rows[0].excludedItems[0].id,id(1));
 assert.deepEqual(inventoryCalls(f).map(call=>call[2]),[1,2,3]);
});
test('remaining item scope changes discard inventory observations',async()=>{
 const f=fixture(),row={operationId:'another-op',accountId:'unselected',state:'stopped',remainingItems:[]};f.setRun({rows:[row]});
 await f.service.prepare(f.config);f.calls.length=0;row.remainingItems.push({id:id(999998)});
 await f.service.prepare(f.config);assert.deepEqual(inventoryCalls(f).map(call=>call[2]),[1,2,3]);
});
for(const change of ['identity','profile','selection','run','invalidate'])test(change+' changes discard observations before another inventory review',async()=>{
 const f=fixture();await f.service.prepare(f.config);f.calls.length=0;
 if(change==='identity')f.identities['source-0']='different-identity';
 if(change==='profile')f.profiles['source-0'].tokens++;
 if(change==='selection')f.config.protectedItemIds=[id(999999)];
 if(change==='run')f.setRun({rows:[{operationId:'another-op',accountId:'unselected',state:'stopped',remainingSkinIds:[id(999998)]}]});
 if(change==='invalidate')f.service.invalidate();
 await f.service.prepare(f.config);assert.deepEqual(inventoryCalls(f).map(call=>call[2]),[1,2,3]);
});
test('a consumed review discards inventory observations before a subsequent preparation',async()=>{
 const f=fixture(),preview=await f.service.prepare(f.config);await f.service.consume(preview.previewId);f.calls.length=0;
 await f.service.prepare(f.config);assert.deepEqual(inventoryCalls(f).map(call=>call[2]),[1,2,3]);
});
test('repeated reviews do not extend the lifetime of cached tail observations',async()=>{
 const f=fixture();await f.service.prepare(f.config);f.calls.length=0;f.advance(20000);
 await f.service.prepare(f.config);assert.deepEqual(inventoryCalls(f).map(call=>call[2]),[1]);f.calls.length=0;f.advance(10001);
 await f.service.prepare(f.config);assert.deepEqual(inventoryCalls(f).map(call=>call[2]),[1,2,3]);
});
test('invalidation during a page read aborts the review and cannot repopulate observations',async()=>{
 const f=fixture();let release,reached;const pageReached=new Promise(resolve=>{reached=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 f.beforePage(async(_account,page)=>{if(page===2){reached();await gate;}});
 const pending=f.service.prepare(f.config);await pageReached;f.service.invalidate();release();await assert.rejects(pending,/mud|rev/i);
 f.calls.length=0;await f.service.prepare(f.config);assert.deepEqual(inventoryCalls(f).map(call=>call[2]),[1,2,3]);
});
test('invalidation while listing accounts stops preparation before any account read',async()=>{
 const f=fixture();let release,reached;const listReached=new Promise(resolve=>{reached=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 f.beforeList(async()=>{reached();await gate;});const pending=f.service.prepare(f.config);await listReached;f.service.invalidate();release();
 await assert.rejects(pending,/mud|rev/i);assert.deepEqual(f.calls,[]);
});
test('confirmation rejects a newly locked trade even when inventory observations remain reusable',async()=>{
 const f=fixture(),preview=await f.service.prepare(f.config);f.profiles['source-0'].dailyTradesLeft=0;
 await assert.rejects(f.service.consume(preview.previewId),/Trocas bloqueadas|limite/i);
});
test('preview scope is available during confirmation and expires with the review',async()=>{
 const f=fixture(),preview=await f.service.prepare(f.config);assert.deepEqual(f.service.previewScope(preview.previewId).accountIds,['source-0']);
 f.advance(300001);assert.equal(f.service.previewScope(preview.previewId),null);
});
test('a same-count tail item change is stopped by the immediate mutation guard',async t=>{
 const f=await consolidationFixture(t,{noItems:true});
 f.stock.source.push(...Array.from({length:150},(_,i)=>({_id:id(i+1),name:'Inventory '+i,price:1,isFavorite:i<100})));
 const preview=await f.service.prepare({action:'sequence',accountIds:['source'],steps:['convert-inventory']});
 f.stock.source[100].price=999;
 await f.service.start({action:'sequence',previewId:preview.previewId});const result=await settled(f.service);
 assert.equal(result.rows[0].state,'failed');assert.match(result.rows[0].message,/mud|rev/i);
 assert.equal(f.requests.some(r=>r.method!=='GET'),false);
});

test('a cached tail item that becomes a terminal is rejected before any economic request',async t=>{
 const f=await consolidationFixture(t,{noItems:true});
 f.stock.source.push(...Array.from({length:150},(_,i)=>({_id:id(i+1),name:'Inventory '+i,price:1,isFavorite:i<100})));
 const preview=await f.service.prepare({action:'sequence',accountIds:['source'],steps:['convert-inventory']});
 f.stock.source[100].isTerminal=true;
 await f.service.start({action:'sequence',previewId:preview.previewId});const result=await settled(f.service);
 assert.equal(result.rows[0].state,'failed');assert.match(result.rows[0].message,/mud|rev/i);
 assert.equal(f.requests.some(r=>r.method!=='GET'),false);
});
