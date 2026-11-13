const {randomUUID}=require('node:crypto');
const TYPES=new Set(['request','vault','open','conversion','opening-item','game','inventory-action','progression','token-converter','purchase','boost','cooldown','account-error']);
const KINDS=new Set(['case','money','vault','open','conversion','sell','convert','favorite','withdraw','transfer','move-to-storage','reward','mission','pass','skill-buy','skill-sell','skill-preset','autoopen','purchase','boost','storage','keep']);
const STATES=new Set(['running','stopping','completed','confirmed','failed','cancelled','stopped','unconfirmed','blocked']);
const NUMBERS=['clicks','awardedCount','openedCount','skinCount','acceptedCount','confirmedCount','unconfirmedCount','requestedCount','selectedCaseDelta','observedCaseDelta','verifiedDelta','confirmedDelta','observedMoney','observedTokens','moneyDelta','tokenDelta','price','cost','refund','pointCost','completed','total','quantity','sentTokens','sold','bought','opened','converted','reviewedCost'];
const identifier=v=>typeof v==='string'&&/^[a-zA-Z0-9:_-]{1,128}$/.test(v)?v:null;
function resultOf(e){if(['running','stopping'].includes(e.state))return 'running';if(e.state==='cancelled'||e.state==='stopped')return 'cancelled';if(e.state==='failed'||e.httpStatus>=400||e.type==='account-error')return 'failed';if(e.verified===true||e.verification==='confirmed')return 'confirmed';return ['running','stopping'].includes(e.state)?'running':'unconfirmed';}
function normalize(e,now){if(!e||!TYPES.has(e.type))return null;
 if(e.type==='token-converter'){const row=e.status?.rows?.find(r=>r.accountId===e.accountId);if(!row)return null;e={...row,type:'token-converter',at:e.at,kind:({buy:'purchase',sell:'sell',open:'open',trade:'transfer',result:'transfer'})[row.stage]||'conversion'};}
const time=Number.isFinite(Date.parse(e.at))?Date.parse(e.at):now;const row={id:randomUUID(),type:e.type,at:new Date(time).toISOString(),accountId:identifier(e.accountId),destinationAccountId:identifier(e.destinationAccountId),operationId:identifier(e.operationId),kind:KINDS.has(e.kind)?e.kind:KINDS.has(e.action)?e.action:null,state:STATES.has(e.state)?e.state:null,result:resultOf(e),values:{}};
 for(const key of ['skinId','destinationStorageUnitId'])if(typeof e[key]==='string'&&/^[a-f0-9]{24}$/i.test(e[key]))row[key]=e[key];
 if(Number.isInteger(e.ruleIndex)&&e.ruleIndex>=0&&e.ruleIndex<500)row.ruleIndex=e.ruleIndex;
 if(['favorite-protected','attribute-missing','ranking-unavailable','rule-matched','no-rule','preview-changed','stopped'].includes(e.reasonCode))row.reasonCode=e.reasonCode;
 if(Number.isInteger(e.httpStatus)&&e.httpStatus>=100&&e.httpStatus<=599)row.httpStatus=e.httpStatus;
 if(typeof e.durationMs==='number'&&Number.isFinite(e.durationMs)&&e.durationMs>=0)row.durationMs=e.durationMs;
 for(const key of NUMBERS)if(typeof e[key]==='number'&&Number.isFinite(e[key]))row.values[key]=e[key];
 if(e.type==='game'&&e.result){if(Number.isInteger(e.result.status))row.httpStatus=e.result.status;row.result=e.result.verified===true?'confirmed':row.httpStatus>=400?'failed':'unconfirmed';}
 return row;}
function createOperationHistory({store,now=Date.now,maxEntries=20000,retentionDays=90,maxPending=512}){
 let rows=[],pending=null,running=null,timer=null;const prune=items=>items.filter(r=>Date.parse(r.at)>=now()-retentionDays*86400000).slice(-maxEntries);
 if(!Number.isSafeInteger(maxPending)||maxPending<1||maxPending>10000)throw Error('Fila de histórico inválida');
 if(!Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>100000||!Number.isInteger(retentionDays)||retentionDays<1||retentionDays>3650)throw Error('Retenção inválida');
 async function ready(){const saved=await store.load();if(!saved)return;if(saved.version!==1||!Array.isArray(saved.rows))throw Error('Histórico inválido');const valid=saved.rows.filter(r=>r&&TYPES.has(r.type)&&Number.isFinite(Date.parse(r.at)));const latest=new Map();for(const r of valid)if(r.operationId)latest.set(r.operationId,r);rows=prune(valid.map(r=>r.result==='running'&&(!r.operationId||latest.get(r.operationId)?.result==='running')?{...r,result:'unconfirmed',interrupted:true}:r));}
 async function drain(){
  if(running){await running;return drain();}if(!pending)return;
  clearTimeout(timer);timer=null;const batch=pending;pending=null;
  running=(async()=>{try{const next=prune([...rows,...batch.rows]);await store.save({version:1,retentionDays,maxEntries,rows:next});rows=next;batch.resolve();}catch(error){batch.reject(error);throw error;}})();
  try{await running;}finally{running=null;if(pending&&!timer)timer=setTimeout(()=>{drain().catch(()=>{});},20);}
 }
 function append(event){
  const row=normalize(event,now());if(!row)return Promise.resolve();
  if(pending?.rows.length>=maxPending)return Promise.reject(Error('Fila do histórico cheia. O evento não foi guardado.'));
  if(!pending){let resolve,reject;const promise=new Promise((ok,fail)=>{resolve=ok;reject=fail;});promise.catch(()=>{});pending={rows:[],promise,resolve,reject};}
  pending.rows.push(row);if(!timer&&!running)timer=setTimeout(()=>{drain().catch(()=>{});},20);return pending.promise;
 }
 async function flush(){while(pending||running)await drain();}
 function query({accountId,kind,result,from,to,offset=0,limit=200}={}){if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>1000)throw Error('Página de histórico inválida');const start=from?Date.parse(from):-Infinity,end=to?Date.parse(to):Infinity;if(Number.isNaN(start)||Number.isNaN(end))throw Error('Período inválido');const filtered=prune(rows).filter(r=>(!accountId||accountId==='all'||r.accountId===accountId||r.destinationAccountId===accountId)&&(!kind||kind==='all'||r.kind===kind||r.type===kind)&&(!result||result==='all'||r.result===result)&&Date.parse(r.at)>=start&&Date.parse(r.at)<=end).reverse();return structuredClone({rows:filtered.slice(offset,offset+limit),total:filtered.length,offset,limit,retentionDays,maxEntries});}
 return {ready,append,query,flush,export:()=>({version:1,exportedAt:new Date(now()).toISOString(),retentionDays,rows:structuredClone(prune(rows))})};
}
module.exports={createOperationHistory,normalize};
