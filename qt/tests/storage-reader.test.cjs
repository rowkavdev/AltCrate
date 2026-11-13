const test=require('node:test'),assert=require('node:assert/strict');
const {createStorageReader}=require('../engine/storageView.cjs');
const unitId='111111111111111111111111',otherId='222222222222222222222222';
function setup(){
 assert.equal(typeof createStorageReader,'function');
 const requests=[];
 const reader=createStorageReader({listAccounts:async()=>[{id:'a'},{id:'b'}],fetchForAccount:account=>async(path,init)=>{
  requests.push({account:account.id,path,method:init.method});
  return {ok:true,status:200,json:async()=>path==='/api/inventory/storageUnits'?[{_id:account.id==='a'?unitId:otherId,name:'Arquivo',skinCount:26,skinIconUrl:'a'.repeat(30),userId:'private',secret:'hidden'}]:{pages:1,value:120,skins:[{_id:'skin',name:'AK-47',price:12,iconUrl:'a'.repeat(30),userId:'private'}]}};
 }});return {reader,requests};
}
test('storage list displays the selected account units without private fields',async()=>{
 const {reader,requests}=setup();
 await assert.rejects(reader.list('missing'),/Conta/);assert.equal(requests.length,0);
 const units=await reader.list('a');
 assert.equal(units[0].id,unitId);assert.equal(units[0].count,26);assert.equal(units[0].name,'Arquivo');
 assert.match(units[0].image,/^https:\/\/steamcommunity-a\.akamaihd\.net\/economy\/image\//);
 assert.equal(JSON.stringify(units).includes('private'),false);assert.equal(JSON.stringify(units).includes('hidden'),false);
 assert.equal(requests[0].account,'a');assert.equal(requests[0].method,'GET');
});
test('storage content refuses a unit belonging to another account before fetching its skins',async()=>{
 const {reader,requests}=setup();
 await assert.rejects(reader.read('b',unitId),/Storage não encontrado nesta conta/);
 assert.equal(requests.length,1);assert.equal(requests[0].path,'/api/inventory/storageUnits');
 await assert.rejects(reader.read('a','../arbitrary'),/Storage inválido/);assert.equal(requests.length,1);
});
test('storage content uses the observed read endpoint and preserves photos and virtual value',async()=>{
 const {reader,requests}=setup();const page=await reader.read('a',unitId,2,{sort:'price',search:'AK-47',favorites:'only'});
 const query=new URL(requests[1].path,'https://case-clicker.com');
 assert.equal(query.pathname,'/api/inventory/storageUnits/skins');assert.equal(query.searchParams.get('id'),unitId);
 assert.equal(query.searchParams.get('page'),'2');assert.equal(query.searchParams.get('sort'),'price');assert.equal(query.searchParams.get('search'),'AK-47');assert.equal(query.searchParams.get('favoriteSkinsFilter'),'only');
 assert.equal(requests[1].method,'GET');assert.equal(page.count,26);assert.equal(page.value,120);assert.equal(page.skins[0].name,'AK-47');assert.equal(JSON.stringify(page).includes('private'),false);
});
test('storage reader reports HTTP failures and rejects malformed successful payloads',async()=>{
 assert.equal(typeof createStorageReader,'function');
 let response={ok:false,status:429};
 const reader=createStorageReader({listAccounts:async()=>[{id:'a'}],fetchForAccount:()=>async()=>response});
 await assert.rejects(reader.list('a'),/HTTP 429/);
 response={ok:true,json:async()=>({unexpected:[]})};await assert.rejects(reader.list('a'),/Resposta inválida/);
 response={ok:true,json:async()=>{throw Error('HTML');}};await assert.rejects(reader.list('a'),/Resposta inválida/);
});
test('storage 429 records shared cooldown and reopening sends no new requests',async()=>{
 let until=0,requests=0;const now=()=>1000,coordinator={cooldown:async()=>until,limit:async value=>{until=value;}};
 const reader=createStorageReader({listAccounts:async()=>[{id:'a'}],fetchForAccount:()=>async()=>{requests++;return {ok:false,status:429,headers:{get:()=> '60'}};},coordinator,now});
 await assert.rejects(reader.list('a'),/HTTP 429/);assert.equal(requests,1);assert.equal(until,61000);
 await assert.rejects(reader.list('a'),/HTTP 429/);assert.equal(requests,1);
});
