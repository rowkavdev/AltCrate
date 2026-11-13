const test=require('node:test'),assert=require('node:assert/strict');
const inventory=require('../electron/inventoryView.cjs');
test('inventory reads belong to a registered account and return display fields only',async()=>{
 assert.equal(typeof inventory.createInventoryReader,'function');
 const requests=[];const reader=inventory.createInventoryReader({listAccounts:async()=>[{id:'a',partition:'persist:private'}],fetchForAccount:account=>async(path,init)=>{
  requests.push({id:account.id,path,method:init.method});return {ok:true,status:200,json:async()=>({pages:2,count:101,skins:[{_id:'skin',name:'USP-S',price:12,iconUrl:'a'.repeat(30),cookie:'secret',owner:'private'}]})};
 }});
 await assert.rejects(reader('missing',1),/Conta/);assert.equal(requests.length,0);
 const data=await reader('a',2,{search:'USP-S',favorites:'only',sort:'price'});
 assert.equal(requests[0].method,'GET');assert.equal(requests[0].id,'a');assert.match(requests[0].path,/page=2.*sort=price/);assert.equal(data.skins[0].name,'USP-S');assert.equal(JSON.stringify(data).includes('private'),false);assert.equal(JSON.stringify(data).includes('secret'),false);
});
test('inventory refuses non-JSON success responses and preserves HTTP failure context',async()=>{
 assert.equal(typeof inventory.createInventoryReader,'function');
 let response={ok:true,status:200,json:async()=>{throw Error('HTML');}};
 const reader=inventory.createInventoryReader({listAccounts:async()=>[{id:'a'}],fetchForAccount:()=>async()=>response});
 await assert.rejects(reader('a'),/Resposta inválida/);
 response={ok:false,status:429};await assert.rejects(reader('a'),/HTTP 429/);
 response={ok:true,status:200,json:async()=>({skins:'invalid',pages:1})};await assert.rejects(reader('a'),/Resposta inválida/);
});
test('inventory page totals remain finite and integral for malformed data',()=>{
 const page=inventory.normalizeInventoryPage({pages:Infinity,count:Infinity,skins:[]});assert.equal(Number.isFinite(page.pages),true);assert.equal(Number.isFinite(page.count),true);
 assert.equal(inventory.normalizeInventoryPage({pages:2.5,count:3.5}).pages,2);
});
