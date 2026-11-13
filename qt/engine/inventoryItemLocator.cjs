const {identityFromToken}=require('./sessionIdentity.cjs');
const {normalizeInventoryItem,inventoryQuery}=require('./inventoryView.cjs');
const validId=value=>typeof value==='string'&&/^[a-f0-9]{24}$/i.test(value);
function createItemLocator({listAccounts,fetchForAccount,accountQueue}){
 async function context(accountId,storageUnitId=null){
  const account=(await listAccounts()).find(a=>a.id===accountId);if(!account)throw Error('Conta não encontrada');
  if(storageUnitId!==null&&!validId(storageUnitId))throw Error('Storage inválido');
  const get=async path=>{const work=async()=>{const response=await fetchForAccount(account)(path,{method:'GET',credentials:'include',cache:'no-store'});if(!response.ok){const e=Error('Inventário: HTTP '+response.status);e.status=response.status;e.retryAfter=response.headers?.get('Retry-After');throw e;}return response.json();};return accountQueue?accountQueue.run(accountId,work):work();};
  if(storageUnitId){const units=await get('/api/inventory/storageUnits');if(!Array.isArray(units)||!units.some(u=>u?._id===storageUnitId))throw Error('Storage não encontrado nesta conta');}
  return {account,get};
 }
 async function page(ctx,storageUnitId,p,search=''){
  let path=inventoryQuery(p,{search});if(storageUnitId){const params=new URLSearchParams(path.split('?')[1]);params.delete('showStickers');params.delete('showUpgradedSkins');params.set('id',storageUnitId);path='/api/inventory/storageUnits/skins?'+params;}
  const body=await ctx.get(path);if(!body||!Array.isArray(body.skins)||!Number.isSafeInteger(body.pages)||body.pages<1||body.pages>10000)throw Error('Resposta inválida do inventário');return body;
 }
 const fingerprint=body=>JSON.stringify([body.pages,body.count??null,body.skins.map(i=>i?._id)]);
 async function scan(accountId,itemId,storageUnitId=null,cursor=null){
  if(!validId(itemId))throw Error('Item inválido');const ctx=await context(accountId,storageUnitId),head=await page(ctx,storageUnitId,1),stamp=fingerprint(head);
  if(cursor&&cursor.stamp!==stamp)return {outcome:'unknown'};
  const start=cursor?.page||1;for(let p=start;p<=Math.min(head.pages,start+19);p++){
   const body=p===1?head:await page(ctx,storageUnitId,p);if(body.pages!==head.pages)return {outcome:'unknown'};
   const raw=body.skins.find(i=>i?._id===itemId);if(raw)return {outcome:'found',item:normalizeInventoryItem(raw),ref:{accountId,itemId,storageUnitId,page:p,name:typeof raw.name==='string'?raw.name:''}};
   if(p===head.pages){const end=await page(ctx,storageUnitId,1);return {outcome:fingerprint(end)===stamp?'absent':'unknown'};}
  }
  return {outcome:'unknown',cursor:{page:start+20,stamp}};
 }
 async function identity(accountId){const ctx=await context(accountId),body=await ctx.get('/api/auth/token');return identityFromToken(body);}
 return {scan,identity,async locate(ref){
  if(!ref||!validId(ref.itemId)||!Number.isSafeInteger(ref.page)||ref.page<1||ref.page>10000)throw Error('Item ou página inválidos');
  const storageUnitId=ref.storageUnitId??null,ctx=await context(ref.accountId,storageUnitId);
  const direct=await page(ctx,storageUnitId,ref.page);let raw=direct.skins.find(i=>i?._id===ref.itemId),p=ref.page;
  if(!raw&&typeof ref.name==='string'&&ref.name){for(p=1;p<=20;p++){const body=await page(ctx,storageUnitId,p,ref.name);raw=body.skins.find(i=>i?._id===ref.itemId);if(raw||p>=body.pages)break;}}
  let located;if(raw)located={item:normalizeInventoryItem(raw),ref:{accountId:ref.accountId,itemId:ref.itemId,storageUnitId,page:p,name:raw.name||''}};else{located=await scan(ref.accountId,ref.itemId,storageUnitId);if(located.outcome!=='found')throw Error('Item não encontrado ou leitura incompleta. Atualiza o inventário.');}
  const identity=identityFromToken(await ctx.get('/api/auth/token'));
  return {...located,identity,account:ctx.account};
 }};
}
module.exports={createItemLocator,validId};
