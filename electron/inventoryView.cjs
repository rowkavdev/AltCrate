const clean = value => typeof value==='string'?value.slice(0,180):'';
const number = value => Number.isFinite(value)?value:null;
const total=(value,fallback=0)=>Number.isFinite(Number(value))?Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,Math.floor(Number(value)))):fallback;
function imageUrl(value) {
  if(typeof value!=='string')return null;
  if(value.startsWith('https://case-clicker.com/'))value=value.slice('https://case-clicker.com'.length);
  if(/^\/pictures\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(png|webp|jpe?g)$/i.test(value)&&value.length<=512)return `https://case-clicker.com${value}`;
  if(/^[A-Za-z0-9_-]{1,120}\.(png|webp|jpe?g)$/i.test(value))return `https://case-clicker.com/pictures/skins/${value}`;
  const steamPrefix='https://steamcommunity-a.akamaihd.net/economy/image/';
  if(value.startsWith(steamPrefix))value=value.slice(steamPrefix.length);
  return /^[A-Za-z0-9_-]{20,2048}$/.test(value)?steamPrefix+value:null;
}
const color=value=>/^[a-fA-F0-9]{6}$/.test(value)?`#${value}`:null;
function accessory(item,type){return {name:clean(item.name),image:imageUrl(item.iconUrl),type,rarity:clean(item.rarity),rarityColor:color(item.rarityColor)};}
function normalizeInventoryItem(item) {
 return {
  id:clean(item?._id),name:clean(item?.name),image:imageUrl(item?.iconUrl),price:number(item?.price),rarity:clean(item?.rarity),rarityColor:color(item?.rarityColor),
  exterior:clean(item?.exterior),float:number(item?.float),quality:number(item?.quality),isFavorite:item?.isFavorite===true,statTrak:typeof item?.statTrak==='boolean'?item.statTrak:null,souvenir:typeof item?.souvenir==='boolean'?item.souvenir:null,origin:clean(item?.origin?.name),
  type:item?.isSticker===true?'sticker':item?.isKeychain===true?'charm':item?.isTerminal===true?'terminal':item?.name?'skin':'unknown',eventName:clean(item?.event?.name),patternId:clean(item?.patternId),
  stickers:Array.isArray(item?.stickers)?item.stickers.filter(x=>x&&typeof x==='object'&&!Array.isArray(x)).slice(0,5).map(x=>accessory(x,'sticker')):[],
  charm:item?.appliedKeychain&&typeof item.appliedKeychain==='object'&&!Array.isArray(item.appliedKeychain)?accessory(item.appliedKeychain,'charm'):null,
 };
}
function normalizeInventoryPage(value) {
 return {pages:Math.max(1,Math.min(10000,total(value?.pages,1))),count:total(value?.count),skins:Array.isArray(value?.skins)?value.skins.slice(0,100).map(normalizeInventoryItem):[]};
}
const FILTER_VALUES=Object.freeze({
 sort:['true','price','float','rank'], favorites:['all','none','only'],
 rarity:['Consumer Grade','Industrial Grade','Mil-Spec Grade','Restricted','Classified','Covert','Contraband','Base Grade','High Grade','Remarkable','Exotic','Extraordinary','Distinguished','Exceptional','Superior','Master'],
 exterior:['Factory New','Minimal Wear','Field-Tested','Well-Worn','Battle-Scarred'], quality:['0','1','2','3'], statTrakSouvenir:['None','Non ST','Non SV','Only ST','Only SV'],
});
function inventoryQuery(page=1,filters={}) {
 if(!Number.isSafeInteger(page)||page<1||page>10000)throw Error('Página inválida');
 if(!filters||typeof filters!=='object'||Array.isArray(filters))throw Error('Filtros inválidos');
 if(Object.keys(filters).some(key=>!['search','eventName',...Object.keys(FILTER_VALUES)].includes(key)))throw Error('Campo de filtro não permitido');
 for(const [key,values] of Object.entries(FILTER_VALUES))if(filters[key]!==undefined&&filters[key]!==''&&!values.includes(filters[key]))throw Error(key==='sort'?'Ordenação inválida':'Filtro '+key+' inválido');
 for(const key of ['search','eventName'])if(filters[key]!==undefined&&(typeof filters[key]!=='string'||filters[key].length>180||/[\x00-\x1f]/.test(filters[key])))throw Error(key==='sort'?'Ordenação inválida':'Filtro '+key+' inválido');
 const query=new URLSearchParams({page:String(page),sort:filters.sort||'true',showStickers:'true',showUpgradedSkins:'true'});
 for(const key of ['search','rarity','exterior','eventName','quality','statTrakSouvenir'])if(filters[key]!==undefined&&filters[key]!=='')query.set(key,filters[key]);
 if(['none','only'].includes(filters.favorites))query.set('favoriteSkinsFilter',filters.favorites);
 return '/api/inventory?'+query;
}
function normalizeEvents(value){
 if(!Array.isArray(value))throw Error('Opções de eventos indisponíveis');
 return value.filter(item=>typeof item?.value==='string'&&item.value.length<=180&&!/[\x00-\x1f]/.test(item.value)).slice(0,300).map(item=>({value:item.value,label:clean(item.label)||item.value}));
}
function validateEventFilter(filters,events){if(filters.eventName&&!events.some(event=>event.value===filters.eventName))throw Error('Evento inválido; atualiza as opções do inventário');}
const finite=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
function normalizeSummary(value,stats){
 const amount=finite(value?.inventoryValue),total=finite(stats?.totalSkins),ranked=finite(stats?.rankedSkins);
 const coverage=Number.isSafeInteger(total)&&total>=0&&Number.isSafeInteger(ranked)&&ranked>=0&&ranked<=total?{totalSkins:total,rankedSkins:ranked,percent:total?ranked/total*100:0,oldestUpdated:typeof stats.oldestUpdated==='string'||typeof stats.oldestUpdated==='number'?stats.oldestUpdated:null}:null;
 return {value:amount!==null&&amount>=0?amount:null,floatCoverage:coverage};
}
function createInventoryReader({listAccounts,fetchForAccount,now=Date.now}) {
 async function accountFetch(accountId){
  if(typeof accountId!=='string'||!accountId)throw Error('Conta inválida');
  const account=(await listAccounts()).find(item=>item.id===accountId);
  if(!account)throw Error('Conta não encontrada');
  return fetchForAccount(account);
 }
 async function get(fetcher,path){
  const response=await fetcher(path,{method:'GET',credentials:'include',cache:'no-store'});
  if(!response.ok)throw Error('Inventário: HTTP '+response.status+(response.status===429?'. Aguarda antes de atualizar.':''));
  try{return await response.json();}catch{throw Error('Resposta inválida do inventário');}
 }
 async function readInventory(accountId,page=1,filters={}) {
  const query=inventoryQuery(page,filters),fetcher=await accountFetch(accountId);
  if(filters.eventName)validateEventFilter(filters,normalizeEvents(await get(fetcher,'/api/events')));
  const value=await get(fetcher,query);
  if(!value||!Array.isArray(value.skins))throw Error('Resposta inválida do inventário');
  return normalizeInventoryPage(value);
 }
 readInventory.summary=async accountId=>{
  const fetcher=await accountFetch(accountId);
  const [value,stats,events]=await Promise.allSettled(['/api/inventory?value=true','/api/inventory/floatRanksStats','/api/events'].map(path=>get(fetcher,path)));
  const result=normalizeSummary(value.status==='fulfilled'?value.value:null,stats.status==='fulfilled'?stats.value:null);
  const errors=[];if(result.value===null)errors.push('Valor do inventário indisponível');if(!result.floatCoverage)errors.push('Cobertura de float indisponível');
  let options=[];try{if(events.status!=='fulfilled')throw Error();options=normalizeEvents(events.value);}catch{errors.push('Opções de eventos indisponíveis');}
  return {...result,events:options,errors,readAt:now()};
 };
 return readInventory;
}
module.exports={normalizeInventoryItem,imageUrl,normalizeInventoryPage,inventoryQuery,createInventoryReader,normalizeEvents,validateEventFilter,FILTER_VALUES};
