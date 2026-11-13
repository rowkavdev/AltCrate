const test=require('node:test'),assert=require('node:assert/strict');
let createConverterReview;try{({createConverterReview}=require('../engine/converterReview.cjs'));}catch{}
const id=n=>n.toString(16).padStart(24,'0');
function fixture(options={}){
 let now=1000;
 const accounts=['pro','free','main'].map(id=>({id,label:id})),profiles=Object.fromEntries(accounts.map(a=>[a.id,{membership:a.id==='free'?'free':'pro',tokens:100,money:10,inventoryCount:a.id==='main'?0:2,inventorySize:100,dailyTradesLeft:100,tradeItems:6}]));
 const items={pro:[{id:id(1),name:'ordinary',price:2,isFavorite:false},{id:id(2),name:'pattern',price:4,hasPattern:true,isFavorite:false}],free:[{id:id(3),name:'ordinary',price:8,isFavorite:false},{id:id(4),name:'favorite',price:5,isFavorite:true}],main:[]};
 const calls=[];
 const deps={listAccounts:async()=>accounts,apiForAccount:a=>({converterProfile:async()=>({...profiles[a.id]}),tradingStatus:async()=>({isUnlocked:true})}),read:async(a,work)=>work(deps.apiForAccount(a)),locator:{identity:async accountId=>options.sameIdentity?'same':accountId+'-identity'},readInventory:async(a,p)=>{calls.push([a,p]);const data=items[a];return {pages:Math.max(1,data.length),count:data.length,skins:data.length?[data[p-1]]:[]};},now:()=>now};
 const service=createConverterReview(deps);
 return {service,items,profiles,calls,advance:ms=>{now+=ms;}};
}
const config={accountIds:['pro','free'],destinationAccountId:'main',includeInventory:true};
test('review reads every page, separates routes and protected items, and has no mutation capability',async()=>{
 const f=fixture(),p=await f.service.prepare(config);
 assert.equal(p.rows.length,2);assert.deepEqual(p.rows.map(r=>r.route),['tokens','skins']);
 assert.deepEqual(p.rows.map(r=>r.items.map(i=>i.id)),[[id(1)],[id(3)]]);
 assert.deepEqual(p.rows.map(r=>r.excludedItems.map(i=>i.id)),[[id(2)],[id(4)]]);
 assert.equal(p.rows[0].maxTokens,120);assert.equal(p.rows[1].maxTokens,180);assert.ok(f.calls.some(([a,p])=>a==='free'&&p===2));
 assert.equal(JSON.stringify(p).includes('identity'),false);assert.equal(p.expiresAt,301000);
});
test('review includes explicitly selected special IDs while keeping favorites excluded',async()=>{
 const f=fixture(),p=await f.service.prepare({...config,protectedItemIds:['pro:'+id(2),'free:'+id(4)]});
 assert.equal(p.rows[0].items.length,2);assert.equal(p.rows[1].items.length,1);assert.equal(p.rows[1].excludedItems[0].isFavorite,true);
});
test('unknown membership, duplicated identities, main in sources and incomplete inventory block review',async()=>{
 const f=fixture();f.profiles.free.membership=null;await assert.rejects(f.service.prepare(config),/verificar|subscrição|tipo/i);
 await assert.rejects(fixture({sameIdentity:true}).service.prepare(config),/mesma|identidade/i);
 await assert.rejects(fixture().service.prepare({...config,accountIds:['main']}),/diferente|origem/i);
 const incomplete=fixture();incomplete.profiles.free.inventoryCount=3;await assert.rejects(incomplete.service.prepare(config),/inventário|incomplet/i);
});
test('expired, changed identity or changed item reviews cannot be consumed',async()=>{
 const f=fixture(),p=await f.service.prepare(config);f.advance(300001);await assert.rejects(f.service.consume(p.previewId),/expir/i);
 const other=fixture(),q=await other.service.prepare(config);other.items.pro[0].price=99;await assert.rejects(other.service.consume(q.previewId),/mud|rev/i);
 const changed=fixture(),r=await changed.service.prepare(config);changed.profiles.free.membership='pro';await assert.rejects(changed.service.consume(r.previewId),/mud|rev/i);
});
test('a valid review is consumed once and token-only review never loads inventory',async()=>{
 const f=fixture(),p=await f.service.prepare({...config,includeInventory:false});assert.equal(f.calls.length,0);
 const plan=await f.service.consume(p.previewId);assert.equal(plan.rows[0].sourceIdentity,'pro-identity');
 await assert.rejects(f.service.consume(p.previewId));
});
test('full inventory or exhausted trading limits block the skin route before any token conversion',async()=>{
 const f=fixture();f.profiles.main.inventoryCount=100;await assert.rejects(f.service.prepare({...config,includeInventory:false}),/espaço|cheio/i);
 const q=fixture();q.profiles.free.dailyTradesLeft=0;await assert.rejects(q.service.prepare(config),/limite|troca/i);
});
test('source inventory may be full when the reviewed conversions will free space before minting',async()=>{
 const f=fixture();f.profiles.free.inventorySize=2;
 assert.equal((await f.service.prepare(config)).rows[1].items.length,1);
 await assert.rejects(f.service.prepare({...config,includeInventory:false}),/espaço|cheio/i);
});
