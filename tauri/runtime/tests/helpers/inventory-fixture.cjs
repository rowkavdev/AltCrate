const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createCaseApi}=require('../../engine/api.cjs'),{createItemLocator}=require('../../engine/inventoryItemLocator.cjs'),{createAccountQueue}=require('../../engine/accountQueue.cjs'),{createInventoryOperationStore}=require('../../engine/inventoryOperationStore.cjs');
const {createStorageReader}=require('../../engine/storageView.cjs'),{createStorageDeposit}=require('../../engine/storageDeposit.cjs');
const itemId='a'.repeat(24),storageUnitId='b'.repeat(24),targetStorageId='d'.repeat(24);
async function inventoryFixture(t,options={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cp-actions-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const accounts=[{id:'source',label:'Origem'},{id:'destination',label:'Destino'}],raw={_id:itemId,name:'Skin',price:5,iconUrl:'ak_ch_bg.png',isFavorite:options.favorite||false};
 const state={inventory:options.storage?[]:[raw],destinationInventory:[],storage:options.storage?[raw]:[],targetStorage:[],money:100,tokens:0,mutations:[],fail:options.fail,withdrawn:false,missingTarget:false};
 const response=(body,status=200)=>({ok:status>=200&&status<300,status,headers:new Headers(),json:async()=>body,text:async()=>JSON.stringify(body)});
 const fetchForAccount=account=>async(endpoint,init={})=>{
  if((init.method||'GET')==='GET'){
   if(endpoint==='/api/auth/token')return response({token:'header.'+Buffer.from(JSON.stringify({id:account.id==='source'&&state.identityOverride?state.identityOverride:(options.duplicateIdentity?'source':account.id)+'-identity'})).toString('base64url')+'.signature'});
   if(endpoint==='/api/me')return response({money:state.money,tokens:state.tokens});
   if(endpoint==='/api/trading')return response({isUnlocked:true,activeUserTradeHostCount:0,activeUserTrades:state.trade?[state.trade]:[],finishedUserTrades:[]});
   if(endpoint==='/api/inventory/storageUnits')return response([{_id:storageUnitId,name:'Arquivo'},...(!state.missingTarget?[{_id:targetStorageId,name:'Blue'}]:[])]);
   if(endpoint.startsWith('/api/inventory')){(state.reads||=[]).push(endpoint);const query=new URL(endpoint,'https://fixture.test'),page=Number(query.searchParams.get('page'));const storage=endpoint.includes('/storageUnits/skins'),target=storage&&query.searchParams.get('id')===targetStorageId;const manyStorage=storage&&!target&&state.withdrawn&&options.storagePages;const manyDest=!storage&&account.id==='destination'&&options.destinationPages;const filler={_id:'e'.repeat(24),name:'Another item'};return response({pages:manyStorage?options.storagePages:manyDest?options.destinationPages:1,skins:manyStorage?[filler]:storage?(target?state.targetStorage:state.storage):account.id==='source'?(state.emptySessionInventory?[]:state.inventory):manyDest&&page<options.destinationPages?[filler]:state.destinationInventory,count:state.inventory.length});}
  }
  state.mutations.push({endpoint,init});const body=init.body?JSON.parse(init.body):{};
  if(endpoint==='/api/trading'){if(options.creationTimeout)throw Error('Creation timeout');if(options.creation429){const r=response({error:'Limit'},429);r.headers.set('Retry-After','60');return r;}return response({_id:'c'.repeat(24)});}
  if(endpoint==='/api/inventory/storageUnits/skins'&&init.method==='DELETE'){if(options.withdrawFail==='reject')return response({error:'Rejeitado'},400);state.inventory.push(...state.storage.splice(0));state.withdrawn=true;return response({});}
  if(endpoint==='/api/inventory/storageUnits/skins'&&init.method==='POST'){
   if(options.depositFail==='reject')return response({error:'Rejeitado'},400);
   if(options.depositFail==='timeout')throw Error('Timeout');
   const inventory=account.id==='source'?state.inventory:state.destinationInventory;
   const index=inventory.findIndex(item=>item._id===body.skinIds?.[0]);if(index>=0)state.targetStorage.push(...inventory.splice(index,1));
   if(options.depositFail==='after-send')throw Error('Timeout after deposit');return response({});
  }
  if(state.fail==='persist-test')throw Error('No request expected');
  if(state.fail==='reject')return response({error:'Rejeitado'},400);
  if(state.fail==='429'){const r=response({error:'Limit'},429);r.headers.set('Retry-After','60');return r;}
  if(state.fail==='timeout')throw Error('Timeout');
  if(endpoint==='/api/inventory/skin/favorite'){raw.isFavorite=body.isFavorite;return response({});}
  if(!options.keepItem)state.inventory=[];if(endpoint.includes('skinToTokens'))state.tokens+=3;else state.money+=options.vaultCredit?105:5;
  if(state.fail==='after-send')throw Error('Timeout after mutation');return response({});
 };
 const queue=createAccountQueue(),store=createInventoryOperationStore({filePath:path.join(dir,'ops.json')}),locator=createItemLocator({listAccounts:async()=>accounts,fetchForAccount,accountQueue:queue});
 const reader=createStorageReader({listAccounts:async()=>accounts,fetchForAccount});
 const deps={listAccounts:async()=>accounts,apiForAccount:a=>createCaseApi(fetchForAccount(a)),locator,accountQueue:queue,store,emit:()=>{},now:Date.now};
 deps.storageDeposit=createStorageDeposit({...deps,listStorageUnits:id=>reader.list(id)});
 return {deps,state,raw,accounts,store,fetchForAccount,targetStorageId,ref:{accountId:'source',itemId,storageUnitId:options.storage?storageUnitId:null,page:1,name:'Skin'}};
}
module.exports={inventoryFixture,itemId,storageUnitId,targetStorageId};
