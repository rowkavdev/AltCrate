const {pageProps}=require('./publicCatalogPage.cjs');
const {canonicalSkinName}=require('./openingPolicy.cjs');
const {safeSkinImage}=require('./skinArtwork.cjs');
const TTL=5*60_000,PATTERN_TTL=TTL;
const name=value=>typeof value==='string'&&value.trim().length<=130&&!/[\x00-\x1f]/.test(value)?value.trim():'';
function eventStatus(event,now){
 if(!event)return null;
 const start=Date.parse(event.startingAt),end=Date.parse(event.endingAt);
 return {...event,status:now>=end?'ended':now<start?'scheduled':event.sourceActive?'active':'inactive'};
}
function normalizeSiteEvent(html,now=Date.now()){
 const props=pageProps(html),raw=typeof props.currentEvent==='string'?JSON.parse(props.currentEvent):props.currentEvent;
 if(!raw)return null;
 if(!/^[a-f0-9]{24}$/i.test(raw._id)||!name(raw.name)||!Number.isFinite(Date.parse(raw.startingAt))||!Number.isFinite(Date.parse(raw.endingAt))||Date.parse(raw.startingAt)>=Date.parse(raw.endingAt))throw Error('Evento publicado inválido');
 return eventStatus({id:raw._id,name:name(raw.name),startingAt:new Date(raw.startingAt).toISOString(),endingAt:new Date(raw.endingAt).toISOString(),sourceActive:props.isEventRunning===true},now);
}
function image(value){
 if(typeof value!=='string')return '';
 if(value.startsWith('/pictures/skins/'))value='https://case-clicker.com'+value;
 if(/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,238}\.(?:png|webp|jpe?g)$/i.test(value)&&!value.includes('..'))value='https://case-clicker.com/pictures/skins/'+value;
 return safeSkinImage(value);
}
function normalizePatternRows(groups){
 return groups.slice(0,1000).filter(group=>name(group?.name)).map(group=>({name:name(group.name),variants:[...new Map((Array.isArray(group.variants)?group.variants:[]).slice(0,100).filter(v=>/^[a-f0-9]{24}$/i.test(v?.id)&&name(v.name)&&image(v.image)).map(v=>[v.id,{id:v.id,name:name(v.name),image:image(v.image),...(Number.isFinite(v.minFloat)&&v.minFloat>=0&&v.minFloat<=1?{minFloat:v.minFloat}:{}),...(Number.isFinite(v.maxFloat)&&v.maxFloat>=0&&v.maxFloat<=1?{maxFloat:v.maxFloat}:{}),...(/^#[a-f0-9]{6}$/i.test(v.color||'')?{color:v.color}:{}),...(Number.isFinite(v.overpay)?{overpay:v.overpay}:{}),...(Number.isFinite(v.probability)&&v.probability>=1?{probability:v.probability}:{})}])).values()]}));
}
function normalizePatternCatalog(html){
 const groups=pageProps(html).skingroups;if(!Array.isArray(groups))throw Error('Catálogo de variantes inválido');
 return normalizePatternRows(groups.map(group=>({name:group?.name,variants:(Array.isArray(group?.patterns)?group.patterns:[]).map(v=>({id:v?._id,name:v?.name,image:v?.iconUrl,minFloat:v?.minFloat,maxFloat:v?.maxFloat,color:v?.color,overpay:v?.overpay,probability:v?.probability}))})));
}
function bounded(work,ms){let timer;return Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Prazo de leitura do catálogo excedido')),ms);})]).finally(()=>clearTimeout(timer));}
function createSiteCatalogMetadata({read,store,now=Date.now,timeoutMs=5000,ioTimeoutMs=200}={}){
 let loaded,pending,retryAt=0,error='';let saved={version:1,event:null,eventAt:0,patterns:[],patternsAt:0};let variants=new Map();
 function rebuild(){variants=new Map(saved.patterns.map(group=>[canonicalSkinName(group.name),group.variants]));}
 async function load(){if(!loaded)loaded=(async()=>{try{const data=await bounded(()=>store?.load(),ioTimeoutMs);if(data?.version===1){
   if(Array.isArray(data.patterns)&&Number.isFinite(data.patternsAt)){saved.patterns=normalizePatternRows(data.patterns);saved.patternsAt=data.patternsAt;rebuild();}
   if(Number.isFinite(data.eventAt)){saved.event=normalizeSiteEvent(`<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:{currentEvent:data.event?{...data.event,_id:data.event.id}:null,isEventRunning:data.event?.sourceActive===true}}})}</script>`,now());saved.eventAt=data.eventAt;}
  }}catch{/* Rebuild public metadata when the cache is unavailable. */}})();return loaded;}
 function status(){return {event:eventStatus(saved.event,now()),observedAt:Math.max(saved.eventAt,saved.patternsAt),stale:!!error,error,nextRefreshAt:Math.max(retryAt,saved.eventAt+TTL)};}
 async function refresh({force=false}={}){await load();if(pending)return pending;if(now()<retryAt)return status();
  const tasks=[];if(force||!saved.eventAt||now()-saved.eventAt>=TTL)tasks.push(async()=>{saved.event=normalizeSiteEvent(await bounded(()=>read('/'),timeoutMs),now());saved.eventAt=now();});
  if(force||!saved.patternsAt||now()-saved.patternsAt>=PATTERN_TTL)tasks.push(async()=>{saved.patterns=normalizePatternCatalog(await bounded(()=>read('/help/patterns'),timeoutMs));saved.patternsAt=now();rebuild();});
  if(!tasks.length)return status();
  pending=(async()=>{const results=await Promise.allSettled(tasks.map(task=>task()));const failure=results.find(result=>result.status==='rejected');error=failure?failure.reason.message:'';if(failure)retryAt=Math.max(now()+TTL,Number(failure.reason.retryAt)||0);try{await bounded(()=>store?.save(saved),ioTimeoutMs);}catch{}return status();})().finally(()=>{pending=null;});return pending;
 }
 function enrich(detail){const fill=item=>{const found=variants.get(canonicalSkinName(item.name));return found?.length?{...item,variants:found}:item;};return {...detail,items:detail.items.map(item=>({...fill(item),...(item.specialItems?{specialItems:item.specialItems.map(fill)}:{})}))};}
 return {refresh,enrich,status};
}
module.exports={normalizeSiteEvent,normalizePatternCatalog,createSiteCatalogMetadata};
