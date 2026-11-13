const PRIORITY={verification:0,user:1,background:2};
function createRequestCoordinator({maxInFlight=4,maxPending=128,perConnection=2,now=Date.now}={}){
 for(const n of [maxInFlight,maxPending,perConnection])if(!Number.isSafeInteger(n)||n<1)throw Error('Limite de pedidos inválido');
 const queue=[],accounts=new Set(),connections=new Map(),reads=new Map();let active=0,seq=0;
 const stats={completed:0,errors:0,limited:0,deduplicated:0,discarded:0,waitMs:0,durationMs:0};
 function drain(){
  queue.sort((a,b)=>a.priority-b.priority||a.sequence-b.sequence);
  while(active<maxInFlight){const i=queue.findIndex(r=>!accounts.has(r.accountId)&&(connections.get(r.connectionId)||0)<perConnection);if(i<0)return;const row=queue.splice(i,1)[0];
   if(row.priority===2&&row.expiresAt<=now()){stats.discarded++;row.reject(Error('Leitura antiga descartada'));continue;}
   active++;accounts.add(row.accountId);connections.set(row.connectionId,(connections.get(row.connectionId)||0)+1);stats.waitMs+=Math.max(0,now()-row.queuedAt);const start=now();
   Promise.resolve().then(row.work).then(value=>{if(value?.status===429)stats.limited++;row.resolve(value);},error=>{stats.errors++;row.reject(error);}).finally(()=>{stats.completed++;stats.durationMs+=Math.max(0,now()-start);active--;accounts.delete(row.accountId);const remaining=(connections.get(row.connectionId)||1)-1;if(remaining)connections.set(row.connectionId,remaining);else connections.delete(row.connectionId);drain();});
  }
 }
 function run({accountId,connectionId='direct',priority='user',key,expiresAt=Infinity}={},work){
  if(typeof accountId!=='string'||!accountId||typeof work!=='function'||!Object.hasOwn(PRIORITY,priority))return Promise.reject(Error('Pedido inválido'));
  const dedupKey=priority==='background'&&key?JSON.stringify([accountId,connectionId,key]):null;
  if(dedupKey&&reads.has(dedupKey)){stats.deduplicated++;return reads.get(dedupKey);}
  if(queue.length>=maxPending)return Promise.reject(Error('Fila de pedidos cheia. Aguarda e tenta novamente.'));
  const promise=new Promise((resolve,reject)=>{queue.push({accountId,connectionId,priority:PRIORITY[priority],expiresAt,sequence:seq++,queuedAt:now(),work,resolve,reject});drain();});
  if(dedupKey){reads.set(dedupKey,promise);promise.finally(()=>{if(reads.get(dedupKey)===promise)reads.delete(dedupKey);}).catch(()=>{});}return promise;
 }
 return {run,metrics:()=>({...stats,active,pending:queue.length,maxInFlight,maxPending,perConnection})};
}
module.exports={createRequestCoordinator};
