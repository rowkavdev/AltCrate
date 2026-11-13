const {imageUrl,inventoryQuery,normalizeInventoryPage,normalizeEvents,validateEventFilter}=require('./inventoryView.cjs');
const {parseRetryAfter}=require('./scheduler.cjs');
const validId=value=>typeof value==='string'&&/^[a-fA-F0-9]{24}$/.test(value);
const count=value=>Number.isFinite(Number(value))?Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,Math.floor(Number(value)))):0;
function normalizeStorageUnits(value){
 if(!Array.isArray(value))throw Error('Resposta inválida dos storages');
 return value.slice(0,1000).filter(item=>validId(item?._id)).map(item=>({id:item._id,name:typeof item.name==='string'?item.name.slice(0,180):'Storage sem nome',count:count(item.skinCount),...(Number.isSafeInteger(item.index)&&item.index>=0?{index:item.index}:{}),...(typeof item.skinIconUrl==='string'?{skinIconUrl:item.skinIconUrl.slice(0,2000)}:{}),image:imageUrl(item.skinIconUrl)}));
}
function storageQuery(id,page,filters){
 if(!validId(id))throw Error('Storage inválido');
 const query=new URLSearchParams(inventoryQuery(page,filters).split('?')[1]);
 query.delete('showStickers');query.delete('showUpgradedSkins');query.set('id',id);
 return '/api/inventory/storageUnits/skins?'+query;
}
function createStorageReader({listAccounts,fetchForAccount,coordinator,now=Date.now}){
 async function accountFetch(accountId){
  if(typeof accountId!=='string'||!accountId)throw Error('Conta inválida');
  const account=(await listAccounts()).find(item=>item.id===accountId);
  if(!account)throw Error('Conta não encontrada');
  return fetchForAccount(account);
 }
 async function get(fetcher,path){
  if(await coordinator?.cooldown()>now())throw Error('Storages: HTTP 429. Aguarda antes de atualizar.');
  const response=await fetcher(path,{method:'GET',credentials:'include',cache:'no-store'});
  if(response.status===429&&coordinator)await coordinator.limit(now()+parseRetryAfter(response.headers?.get('Retry-After'),now()));
  if(!response.ok)throw Error('Storages: HTTP '+response.status+(response.status===429?'. Aguarda antes de atualizar.':''));
  try{return await response.json();}catch{throw Error('Resposta inválida dos storages');}
 }
 return {
  async list(accountId){return normalizeStorageUnits(await get(await accountFetch(accountId),'/api/inventory/storageUnits'));},
  async read(accountId,id,page=1,filters={}){
   if(!filters||typeof filters!=='object'||Array.isArray(filters))throw Error('Filtros inválidos');
   const query=storageQuery(id,page,filters),fetcher=await accountFetch(accountId);
   if(filters.eventName)validateEventFilter(filters,normalizeEvents(await get(fetcher,'/api/events')));
   const unit=normalizeStorageUnits(await get(fetcher,'/api/inventory/storageUnits')).find(item=>item.id===id);
   if(!unit)throw Error('Storage não encontrado nesta conta');
   const value=await get(fetcher,query);
   if(!value||!Array.isArray(value.skins))throw Error('Resposta inválida do storage');
   return {...normalizeInventoryPage({...value,count:unit.count}),value:Number.isFinite(value.value)?value.value:null};
  },
 };
}
module.exports={createStorageReader};
