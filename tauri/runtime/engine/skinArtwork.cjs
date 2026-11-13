const {pageProps}=require('./publicCatalogPage.cjs');
const {canonicalSkinName}=require('./openingPolicy.cjs');
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const validSlug=value=>typeof value==='string'&&value.length<=100&&SLUG.test(value);
const TTL=7*24*60*60_000;
function safeSkinImage(value){
 if(typeof value!=='string'||value.length>2300||value.includes('..'))return '';
 if(/^https:\/\/steamcommunity-a\.akamaihd\.net\/economy\/image\/[A-Za-z0-9_-]{20,2048}(?:\/\d{1,4}fx\d{1,4})?$/.test(value))return value;
 if(/^https:\/\/case-clicker\.com\/pictures\/skins\/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,238}\.(?:png|webp|jpe?g)$/i.test(value))return value;
 return '';
}
function cleanName(value){return typeof value==='string'&&value.trim()&&value.length<=130&&!/[\x00-\x1f]/.test(value)?value.trim():'';}
function normalizeWeaponIndex(html){
 const classes=pageProps(html).model?.classes;
 if(!Array.isArray(classes))throw Error('Índice de imagens inválido');
 return classes.flatMap(group=>Array.isArray(group?.weapons)?group.weapons:[]).filter(w=>cleanName(w?.name)&&validSlug(w?.slug)).slice(0,200).map(w=>({name:w.name.trim(),slug:w.slug,weaponClass:typeof w.weaponClass==='string'?w.weaponClass.slice(0,40):''}));
}
function normalizeArtworkRows(rows,weaponClass){
 return (Array.isArray(rows)?rows:[]).slice(0,500).filter(item=>cleanName(item?.name)&&safeSkinImage(item.imageUrl||item.image)).map(item=>({name:item.name.trim(),image:safeSkinImage(item.imageUrl||item.image),weaponClass,rarity:typeof item.rarity==='string'?item.rarity.slice(0,40):'',rarityColor:/^#?[a-f0-9]{6}$/i.test(item.rarityColor||'')?'#'+item.rarityColor.replace(/^#/,''):'',...(validSlug(item.slug)?{slug:item.slug}:{})}));
}
function normalizeWeaponArtwork(html,expectedSlug){
 const model=pageProps(html).model;
 if(!validSlug(expectedSlug)||model?.weapon?.slug!==expectedSlug||!Array.isArray(model.rarities))throw Error('Imagens da arma inválidas');
 const weaponClass=typeof model.weapon.weaponClass==='string'?model.weapon.weaponClass.slice(0,40):'';
 const decode=s=>s.replace(/&(?:amp|quot|apos|#x27|#39|lt|gt);/g,x=>({'&amp;':'&','&quot;':'"','&apos;':"'",'&#x27;':"'",'&#39;':"'",'&lt;':'<','&gt;':'>'}[x]));
 const links=new Map();for(const tag of html.match(/<a\b[^>]*>/gi)||[]){const attrs=new Map([...tag.matchAll(/\b(aria-label|href)="([^"]*)"/g)].map(m=>[m[1],decode(m[2])]));const href=attrs.get('href');if(/^\/skin\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(href||'')&&attrs.get('aria-label'))links.set(canonicalSkinName(attrs.get('aria-label')),href.slice(6));}
 return {slug:expectedSlug,items:normalizeArtworkRows(model.rarities.flatMap(r=>Array.isArray(r?.skins)?r.skins:[]),weaponClass).map(item=>({...item,...(links.has(canonicalSkinName(item.name))?{slug:links.get(canonicalSkinName(item.name))}:{})}))};
}
function createSkinArtworkCatalog({read,cache,now=Date.now,timeoutMs=2200,ioTimeoutMs=200,readTimeoutMs=2500}){
 let loaded=null,indexPromise=null,retryAt=0,active=0;
 let saved={version:1,indexAt:0,index:[],weapons:{}};
 const indexByName=new Map(),images=new Map(),pending=new Map(),waiting=[];
 function addRows(rows){for(const item of rows)images.set(canonicalSkinName(item.name),item);}
 function updateIndex(){indexByName.clear();for(const w of saved.index)indexByName.set(canonicalSkinName(w.name),w);}
 function bounded(work,ms){let timer;return Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Optional artwork deadline')),ms);})]).finally(()=>clearTimeout(timer));}
 async function load(){if(!loaded)loaded=(async()=>{try{const value=await bounded(()=>cache?.load(),ioTimeoutMs);if(value?.version===1&&Array.isArray(value.index)&&value.index.length<=200&&value.weapons&&typeof value.weapons==='object'){
   saved.index=value.index.filter(w=>cleanName(w?.name)&&validSlug(w?.slug)).map(w=>({name:w.name,slug:w.slug,weaponClass:String(w.weaponClass||'').slice(0,40)}));saved.indexAt=Number.isFinite(value.indexAt)?value.indexAt:0;
   for(const w of saved.index){const entry=value.weapons[w.slug];if(entry&&Number.isFinite(entry.observedAt)){const items=normalizeArtworkRows(entry.items,w.weaponClass);saved.weapons[w.slug]={observedAt:entry.observedAt,items};addRows(items);}}
   updateIndex();
  }}catch{/* Public artwork cache can be rebuilt without affecting accounts. */}})();return loaded;}
 async function persist(){try{await bounded(()=>cache?.save(saved),ioTimeoutMs);}catch{/* A cache write cannot block case contents. */}}
 async function limited(fn){if(active>=2)await new Promise(resolve=>waiting.push(resolve));else active++;try{return await fn();}finally{if(waiting.length)waiting.shift()();else active--;}}
 function readPage(path){let expired=false;return bounded(()=>limited(()=>{if(expired||now()<retryAt)throw Error('Optional artwork read expired');return read(path);}),readTimeoutMs).finally(()=>{expired=true;});}
 async function index(){await load();if(saved.index.length&&now()-saved.indexAt<TTL)return;
  if(now()<retryAt)return;
  if(!indexPromise)indexPromise=(async()=>{try{saved.index=normalizeWeaponIndex(await readPage('/skins'));saved.indexAt=now();updateIndex();await persist();}catch{retryAt=now()+300_000;}finally{indexPromise=null;}})();
  return indexPromise;
 }
 async function weapon(w,force=false){const prior=saved.weapons[w.slug];if(!force&&prior&&now()-prior.observedAt<TTL)return;if(now()<retryAt)return;
  if(!pending.has(w.slug))pending.set(w.slug,(async()=>{if(now()<retryAt)return;try{const value=normalizeWeaponArtwork(await readPage('/skins/'+w.slug),w.slug);saved.weapons[w.slug]={observedAt:now(),items:value.items};addRows(value.items);await persist();}catch{retryAt=now()+300_000;}})().finally(()=>pending.delete(w.slug)));
  return pending.get(w.slug);
 }
 async function enrichWithinDeadline(detail){
  const missing=(detail.items||[]).flatMap(item=>item.specialItems?.length?item.specialItems:[item]).filter(item=>item.name&&!item.image);
  if(!missing.length)return detail;
  await index();const needed=new Map();for(const item of missing){const name=canonicalSkinName(item.name).split(' | ')[0],w=indexByName.get(name);if(w)needed.set(w.slug,w);}
  await Promise.all([...needed.values()].map(w=>weapon(w)));
  const fill=item=>{const art=images.get(canonicalSkinName(item.name));return art?{...item,image:item.image||art.image,weaponClass:art.weaponClass,rarity:item.rarity||art.rarity,rarityColor:item.rarityColor||art.rarityColor}:item;};
  return {...detail,items:detail.items.map(item=>({...fill(item),...(item.specialItems?{specialItems:item.specialItems.map(fill)}:{})}))};
 }
 async function enrich(detail){try{return await bounded(()=>enrichWithinDeadline(detail),timeoutMs);}catch{return detail;}}
 async function resolveSkinLink(name){await index();const key=canonicalSkinName(name);let art=images.get(key);if(art?.slug)return '/skin/'+art.slug;const w=indexByName.get(key.split(' | ')[0]);if(!w)throw Error('Página oficial da arma indisponível');await weapon(w,true);art=images.get(key);if(!art?.slug)throw Error('Página oficial da skin indisponível');return '/skin/'+art.slug;}
 return {enrich,resolveSkinLink};
}
module.exports={safeSkinImage,normalizeWeaponIndex,normalizeWeaponArtwork,createSkinArtworkCatalog};
