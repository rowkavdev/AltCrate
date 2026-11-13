const {pageProps}=require('./publicCatalogPage.cjs');
const {safeSkinImage}=require('./skinArtwork.cjs');
const {canonicalSkinName}=require('./openingPolicy.cjs');
const TTL=7*86400_000;
const text=value=>typeof value==='string'&&!/[\x00-\x1f]/.test(value)?value.trim().slice(0,180):'';
const finite=value=>Number.isFinite(value)?value:null;
const price=value=>Number.isFinite(value)&&value>=0?value:null;
const unit=value=>Number.isFinite(value)&&value>=0&&value<=1?value:null;
const flag=value=>typeof value==='boolean'?value:null;
const color=value=>/^#?[a-f0-9]{6}$/i.test(value||'')?'#'+value.replace(/^#/,''):'';
function image(value){return safeSkinImage(typeof value==='string'&&value.startsWith('/pictures/skins/')?'https://case-clicker.com'+value:value);}
function normalizeSkinMetadata(input,expectedName){
 const model=typeof input==='string'?pageProps(input).model:input;
 const skin=model?.skin||model;
 if(!skin||canonicalSkinName(skin.name)!==canonicalSkinName(expectedName)||!text(skin.name)||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skin.slug||''))throw Error('Dados da skin inválidos');
 const minFloat=unit(skin.minFloat),maxFloat=unit(skin.maxFloat);
 if(minFloat!==null&&maxFloat!==null&&minFloat>maxFloat)throw Error('Intervalo da skin inválido');
 return {
  name:text(skin.name),slug:skin.slug,image:image(skin.imageUrl||skin.image),weapon:text(skin.weapon),weaponSlug:text(skin.weaponSlug),weaponClass:text(skin.weaponClass),collection:text(skin.collection),rarity:text(skin.rarity),rarityColor:color(skin.rarityColor),minFloat,maxFloat,hasPattern:flag(skin.hasPattern),wearKeys:(Array.isArray(model.wearKeys)?model.wearKeys:[]).filter(key=>['FN','MW','FT','WW','BS'].includes(key)).slice(0,5),
  isVanilla:flag(skin.isVanilla),isNonObtainable:flag(skin.isNonObtainable),hasStatTrak:flag(model.hasStatTrak),hasSouvenir:flag(model.hasSouvenir),priceMin:price(model.priceMin),priceMax:price(model.priceMax),
  exteriors:(Array.isArray(model.exteriors)?model.exteriors:[]).slice(0,5).filter(e=>['FN','MW','FT','WW','BS'].includes(e?.key)).map(e=>({key:e.key,label:text(e.label),available:flag(e.available),min:unit(e.min),max:unit(e.max),price:price(e.price),statTrakPrice:price(e.statTrakPrice),souvenirPrice:price(e.souvenirPrice)})),
  variants:(Array.isArray(model.patterns||model.variants)?model.patterns||model.variants:[]).slice(0,100).filter(v=>text(v?.name)).map(v=>({name:text(v.name),image:image(v.iconUrl||v.image),color:color(v.color),overpay:finite(v.overpay),probability:Number.isFinite(v.probability)&&v.probability>=1?v.probability:null,minFloat:unit(v.minFloat),maxFloat:unit(v.maxFloat)})),
  containers:(Array.isArray(model.containers)?model.containers:[]).slice(0,200).filter(c=>/^\/cases\/(?:cases|capsules|collections|keychainCollections)\/[a-z0-9-]+$/.test(c?.href||'')).map(c=>({name:text(c.name),href:c.href,kind:text(c.kind),price:price(c.price)})),
  sourceUrl:'https://case-clicker.com/skin/'+skin.slug,
 };
}
function deadline(work,ms){let timer;return Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Prazo de leitura dos dados da skin excedido')),ms);})]).finally(()=>clearTimeout(timer));}
function createSkinMetadataCatalog({read,resolveLink,store,now=Date.now,timeoutMs=7000,ioTimeoutMs=200}={}){
 const cache=new Map(),pending=new Map(),retry=new Map();let loaded;
 async function ready(){if(!loaded)loaded=(async()=>{try{const data=await deadline(()=>store?.load(),ioTimeoutMs);if(data?.version===1&&Array.isArray(data.entries))for(const row of data.entries.slice(-2000)){if(!Number.isFinite(row.observedAt)||row.observedAt>now())continue;try{const profile=normalizeSkinMetadata(row.data,row.data?.name);cache.set(canonicalSkinName(profile.name),{data:profile,observedAt:row.observedAt});}catch{}}}catch{}})();return loaded;}
 async function get(name){
  if(typeof name!=='string'||!name.trim()||name.length>130)throw Error('Skin inválida');await ready();const key=canonicalSkinName(name),entry=cache.get(key);
  if(entry&&now()-entry.observedAt<TTL)return {...entry.data,observedAt:entry.observedAt,stale:false};
  if(now()<(retry.get(key)||0)){if(entry)return {...entry.data,observedAt:entry.observedAt,stale:true};throw Error('Os dados desta skin estão indisponíveis. Aguarda antes de repetir.');}
  if(pending.has(key))return pending.get(key);
  if(pending.size>=4)throw Error('A carregar outras skins. Tenta novamente dentro de instantes.');
  let expired=false;
  const task=(async()=>{try{
   const data=await deadline(async()=>{const link=await resolveLink(name);if(expired)throw Error('Consulta da skin expirada');if(!/^\/skin\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(link||''))throw Error('Página oficial da skin indisponível');return normalizeSkinMetadata(await read(link),name);},timeoutMs).finally(()=>{expired=true;});
   const observedAt=now();cache.delete(key);cache.set(key,{data,observedAt});while(cache.size>2000)cache.delete(cache.keys().next().value);retry.delete(key);
   try{await deadline(()=>store?.save({version:1,entries:[...cache.values()]}),ioTimeoutMs);}catch{}
   return {...data,observedAt,stale:false};
  }catch(error){retry.set(key,Math.max(now()+300000,Number(error.retryAt)||0));if(entry)return {...entry.data,observedAt:entry.observedAt,stale:true};throw error;}finally{pending.delete(key);}})();pending.set(key,task);return task;
 }
 return {get};
}
module.exports={normalizeSkinMetadata,createSkinMetadataCatalog};
