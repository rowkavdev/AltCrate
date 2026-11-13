const test=require('node:test'),assert=require('node:assert/strict');
let createItemLocator;try{({createItemLocator}=require('../engine/inventoryItemLocator.cjs'));}catch{}
const id='a'.repeat(24),other='b'.repeat(24),unit='c'.repeat(24);
function setup(pages,units=[{_id:unit}]){
 const calls=[];return {calls,locator:()=>{assert.equal(typeof createItemLocator,'function');return createItemLocator({listAccounts:async()=>[{id:'a'}],fetchForAccount:()=>async path=>{calls.push(path);let body;if(path==='/api/auth/token')body={token:'header.'+Buffer.from(JSON.stringify({id:'identity'})).toString('base64url')+'.signature'};else if(path==='/api/me')body={money:100};else if(path==='/api/inventory/storageUnits')body=units;else{const p=Number(new URL(path,'https://game.test').searchParams.get('page'));body=pages(p,path);}return {ok:true,status:200,json:async()=>body};}});}};
}
test('locator finds moved page by exact identifier without substituting homonym',async()=>{
 const f=setup(p=>({pages:2,skins:p===1?[{_id:other,name:'Item'}]:[{_id:id,name:'Item',price:5}]}));
 const result=await f.locator().locate({accountId:'a',itemId:id,name:'Item',page:1,storageUnitId:null});assert.equal(result.ref.itemId,id);assert.equal(result.ref.page,2);
 await assert.rejects(f.locator().locate({accountId:'missing',itemId:id,page:1}),/Conta/);
});
test('partial and changing pagination never proves absence',async()=>{
 const f=setup(p=>({pages:21,skins:[{_id:other,name:'Item'}]}));assert.equal((await f.locator().scan('a',id,null)).outcome,'unknown');
 let n=0;const changing=setup(()=>({pages:1,skins:[{_id:(++n===1?other:'d'.repeat(24))}]}));assert.equal((await changing.locator().scan('a',id,null)).outcome,'unknown');
});
test('unknown storage refuses content read and a complete stable scan proves absence',async()=>{
 const f=setup(()=>({pages:1,skins:[]}),[]);await assert.rejects(f.locator().locate({accountId:'a',itemId:id,storageUnitId:unit,page:1}),/Storage/);assert.equal(f.calls.some(p=>p.includes('/skins?')),false);
 assert.equal((await f.locator().scan('a',id,null)).outcome,'absent');
});

test("identity comes from authenticated session, not game balance",async()=>{const f=setup(()=>({pages:1,skins:[{_id:id,name:"Item"}]})),locator=f.locator();assert.equal(await locator.identity("a"),"identity");assert.equal((await locator.locate({accountId:"a",itemId:id,page:1})).identity,"identity");assert.ok(f.calls.includes("/api/auth/token"));});
