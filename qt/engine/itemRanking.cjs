const ID=/^[a-f0-9]{24}$/i;
const SCOPE='lowestFloatBySkingroupRank';
const CONTRACT={method:'GET',path:'/api/inventory/skin/rank?skinId=',scope:SCOPE,scopeLabel:'Overall · menor float',evidence:'public-client-declared',source:'https://case-clicker.com/_next/static/chunks/7450-af858352121d8619.js'};
const GAP='Transporte de ranking individual indisponível nesta ligação. O contrato declarado no cliente público usa GET /api/inventory/skin/rank?skinId= e devolve floatRanks e floatRanksUpdatedAt. A cobertura agregada de float não fornece uma posição.';
function createItemRanking({now=Date.now,maxAgeMs=300000,maxEntries=10000,load=async()=>null,save=async()=>{},fetchForAccount}={}){
 if(!Number.isFinite(maxAgeMs)||maxAgeMs<=0||!Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>100000)throw Error('Limites da cache de ranking inválidos');
 let cache=new Map(),initialization,queue=Promise.resolve();const refreshing=new Map();
 function reference(value){if(typeof value?.accountId!=='string'||!value.accountId||value.accountId.length>180||!ID.test(value.itemId))throw Error('Referência de ranking inválida');return JSON.stringify([value.accountId,value.itemId]);}
 function normalize(value){
  reference(value);
  if(value.scope!==undefined&&value.scope!==SCOPE||value.rank!==null&&(!Number.isSafeInteger(value.rank)||value.rank<1)||!Number.isFinite(value.observedAt)||value.observedAt<0||value.observedAt>now()||value.sourceUpdatedAt!==null&&(!Number.isFinite(value.sourceUpdatedAt)||value.sourceUpdatedAt<0||value.sourceUpdatedAt>now())||typeof value.identity!=='string'||!value.identity||value.identity.length>2048)throw Error('Observação de ranking individual inválida');
  return {accountId:value.accountId,itemId:value.itemId,identity:value.identity,rank:value.rank,scope:SCOPE,observedAt:value.observedAt,sourceUpdatedAt:value.sourceUpdatedAt};
 }
 async function ready(){
  if(!initialization)initialization=(async()=>{const value=await load();if(value==null)return;if(value.version!==1||!Array.isArray(value.entries)||value.entries.length>100000)throw Error('Cache de ranking inválida');const entries=value.entries.map(normalize).sort((a,b)=>a.observedAt-b.observedAt).slice(-maxEntries);cache=new Map(entries.map(entry=>[reference(entry),entry]));})();
  return initialization;
 }
 function read(value){
  const entry=cache.get(reference(value));
  if(!entry)return {state:'unavailable',accountId:value.accountId,itemId:value.itemId,scope:SCOPE,rank:null,reason:fetchForAccount?'Sem observação individual guardada. Seleciona o item e consulta o ranking.':GAP};
  const result={...structuredClone(entry),scopeLabel:CONTRACT.scopeLabel};
  if(value.identity!==undefined&&entry.identity!==value.identity)return {...result,state:'identity-changed',reason:'A identidade ou os atributos do item mudaram; o ranking guardado não se aplica.'};
  if(entry.rank===null||entry.sourceUpdatedAt===null)return {...result,state:'unavailable',reason:'A resposta não fornece uma posição individual Overall e uma data de atualização válidas; não é inferida uma posição a partir de #10+ ou da cobertura.'};
  const age=now()-Math.min(entry.observedAt,entry.sourceUpdatedAt),stale=age<0||age>maxAgeMs;
  return {...result,state:stale?'stale':'fresh',reason:stale?'A observação ou a atualização na origem do ranking individual está obsoleta.':'Posição individual Overall observada nesta conta e neste item.'};
 }
 async function observe(value){
  const entry=normalize(value),key=reference(entry);await ready();
  const work=async()=>{const previous=cache.get(key);if(previous&&previous.observedAt>entry.observedAt)return structuredClone(previous);const next=new Map(cache);next.delete(key);next.set(key,entry);while(next.size>maxEntries)next.delete(next.keys().next().value);await save({version:1,entries:[...next.values()].map(value=>structuredClone(value))});cache=next;return structuredClone(entry);};
  const result=queue.then(work);queue=result.catch(()=>{});return result;
 }
 async function refresh(value){
  const key=reference(value);if(typeof value.identity!=='string'||!value.identity)throw Error('Identidade do item necessária para consultar ranking');await ready();
  if(!fetchForAccount)return {...read(value),state:'unavailable',reason:GAP};
  const running=refreshing.get(key);if(running){await running;return read(value);}
  const task=(async()=>{
   // Public source contract only; the response is not treated as verified game behavior.
   const response=await fetchForAccount(value.accountId)(CONTRACT.path+encodeURIComponent(value.itemId));
   if(!response?.ok){const error=Error('Não foi possível consultar o ranking individual'+(response?.status?' (HTTP '+response.status+')':'')+'.');error.status=response?.status??null;error.retryAfter=response?.headers?.get?.('retry-after')||null;throw error;}
   const body=await response.json();if(!body||typeof body!=='object'||Array.isArray(body)||!body.floatRanks||typeof body.floatRanks!=='object'||Array.isArray(body.floatRanks))throw Error('Resposta de ranking individual inválida');
   const rank=body.floatRanks[SCOPE]??null;
   const sourceUpdatedAt=typeof body.floatRanksUpdatedAt==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(body.floatRanksUpdatedAt)?Date.parse(body.floatRanksUpdatedAt):null;
   await observe({...value,rank,observedAt:now(),sourceUpdatedAt});return read(value);
  })();refreshing.set(key,task);try{return await task;}finally{refreshing.delete(key);}
 }
 return {ready,read,refresh,observe,capability:()=>({available:typeof fetchForAccount==='function',reason:typeof fetchForAccount==='function'?'Contrato declarado no cliente público; consultas apenas dos itens selecionados.':GAP,...CONTRACT,maxAgeMs})};
}
module.exports={createItemRanking,RANKING_SCOPE:SCOPE,RANKING_CONTRACT:CONTRACT,RANKING_CONTRACT_GAP:GAP};
