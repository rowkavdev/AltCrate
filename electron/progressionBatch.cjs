const {randomUUID}=require('node:crypto');
const {missionStep,passStep}=require('./missionPassClaims.cjs');
const TTL=300000,copy=value=>structuredClone(value);
function createProgressionBatch({progression,listAccounts,store,emit=()=>{},now=Date.now}){
 const batches=new Map(),tasks=new Map();let saveTail=Promise.resolve(),reviewing=false;
 const view=batch=>copy(batch);
 async function save(){if(!store)return;const value={version:1,batches:[...batches.values()].filter(b=>['running','stopping','blocked'].includes(b.phase)).concat([...batches.values()].filter(b=>!['running','stopping','blocked'].includes(b.phase)).slice(-100))};const task=saveTail.catch(()=>{}).then(()=>store.save(copy(value)));saveTail=task;await task;}
 async function publish(b){b.updatedAt=new Date(now()).toISOString();await save();emit({type:'progression-batch',batch:view(b),at:b.updatedAt});return view(b);}
 async function ready(){const state=await store?.load();if(!state)return;if(state.version!==1||!Array.isArray(state.batches))throw Error('Registo de lotes inválido');for(const raw of state.batches){const b=copy(raw);if(!b?.batchId||!Array.isArray(b.rows))throw Error('Lote inválido');if(['running','stopping'].includes(b.phase)){b.phase='blocked';b.stopped=true;for(const row of b.rows){if(row.state==='sending')row.state='unconfirmed';else if(row.state==='ready')row.state='cancelled';}}if(b.phase==='review'){b.phase='expired';for(const row of b.rows)if(row.state==='ready')row.state='expired';}batches.set(b.batchId,b);}}
 async function accounts(ids){if(!Array.isArray(ids)||!ids.length||ids.length>200||new Set(ids).size!==ids.length)throw Error('Seleciona contas diferentes');const known=await listAccounts();for(const id of ids)if(!known.some(a=>a.id===id))throw Error('Conta não encontrada');return known;}
 async function discover({accountIds,kinds=['reward','mission','pass']}){
  if(!Array.isArray(kinds)||!kinds.length||kinds.some(k=>!['reward','mission','pass'].includes(k)))throw Error('Tipo de recolha inválido');const known=await accounts(accountIds),rows=[];
  for(const accountId of accountIds){const label=known.find(a=>a.id===accountId)?.label||accountId;
   try{
    if(kinds.includes('reward')){const data=await progression.rewards(accountId);for(const t of data.tracks||[])if(t.id!==null&&t.id!==undefined)rows.push({accountId,label,kind:'reward',payload:{id:t.id},title:t.title,eligible:t.eligible===true,state:t.eligible?'available':'unavailable'});}
    if(kinds.includes('mission')||kinds.includes('pass')){const data=await progression.missions(accountId);
     if(kinds.includes('mission'))for(const m of data.missions||[]){let eligible=false;try{missionStep(data.missions,m.id,now());eligible=true;}catch{}rows.push({accountId,label,kind:'mission',payload:{id:m.id},title:m.title,eligible,state:eligible?'available':Date.parse(m.validTill)<=now()?'expired':'unavailable'});}
     if(kinds.includes('pass'))for(const tier of data.pass?.track||[])for(const track of ['free','premium']){if(!tier[track==='free'?'freeReward':'premiumReward'])continue;let eligible=false;try{passStep(data.pass,tier.tier,track,now());eligible=true;}catch{}rows.push({accountId,label,kind:'pass',payload:{tier:tier.tier,track},title:'Escalão '+tier.tier+' · '+(track==='free'?'Gratuito':'Premium'),eligible,state:eligible?'available':Date.parse(data.pass.endsAt)<=now()?'expired':'unavailable'});}
    }
   }catch(error){rows.push({accountId,label,kind:'read',title:'Consulta indisponível',eligible:false,state:'failed',message:String(error.message||error).slice(0,250)});}
  }return rows;
 }
 async function prepare({actions}){
  if(reviewing||active())throw Error('Aguarda o lote em curso ou verifica os resultados');if(!Array.isArray(actions)||!actions.length||actions.length>500)throw Error('Seleciona entre 1 e 500 ações');
  const known=await accounts([...new Set(actions.map(a=>a?.accountId))]),seen=new Set();
  for(const a of actions){if(!['reward','mission','pass','skill-preset'].includes(a?.kind)||!a.payload||typeof a.payload!=='object')throw Error('Ação de lote inválida');const key=JSON.stringify([a.accountId,a.kind,a.payload]);if(seen.has(key))throw Error('Ação duplicada');seen.add(key);}
  reviewing=true;
  try{const b={batchId:randomUUID(),phase:'review',createdAt:new Date(now()).toISOString(),expiresAt:now()+TTL,rows:[],stopped:false};
   for(const a of actions){const row={rowId:randomUUID(),accountId:a.accountId,accountLabel:known.find(k=>k.id===a.accountId)?.label||a.accountId,kind:a.kind,state:'ready'};
    try{const preview=await progression.prepare(a.accountId,a.kind,a.payload);Object.assign(row,{preview,title:preview.title,cost:preview.cost,refund:preview.refund,pointCost:preview.pointCost,loss:preview.loss});}
    catch(error){row.state=/expir/i.test(error.message)?'expired':'unavailable';row.message=String(error.message||error).slice(0,250);}b.rows.push(row);
   }batches.set(b.batchId,b);return publish(b);
  }finally{reviewing=false;}
 }
 function get(id){const b=batches.get(id);if(!b)throw Error('Lote não encontrado');return b;}
 function cancelReady(b){for(const r of b.rows)if(r.state==='ready')r.state='cancelled';}
 function applyResult(row,result){row.result=result;row.message=result.message;row.state=result.verified===true&&result.state==='completed'?'confirmed':result.state==='unconfirmed'?'unconfirmed':result.state==='stopped'?'cancelled':'failed';}
 async function execute(b){
  b.phase='running';await publish(b);
  for(const row of b.rows){
   if(b.stopped)break;if(row.state!=='ready')continue;if(now()>b.expiresAt){row.state='expired';cancelReady(b);break;}
   row.operationId=randomUUID();row.state='sending';await publish(b);
   if(b.stopped||now()>b.expiresAt){row.state=b.stopped?'cancelled':'expired';row.operationId=null;cancelReady(b);break;}
   try{const result=await progression.confirm(row.preview.previewId,{operationId:row.operationId});applyResult(row,result);}
   catch(error){const observed=progression.status(row.accountId);if(observed?.operationId===row.operationId)applyResult(row,observed);else{row.state='failed';row.message=String(error.message||error).slice(0,250);}}
   await publish(b);if(['unconfirmed','failed'].includes(row.state)){b.stopped=true;break;}
  }
  cancelReady(b);b.phase=b.rows.some(r=>r.state==='unconfirmed')?'blocked':b.stopped?'stopped':'completed';return publish(b);
 }
 async function confirm(id){const b=get(id);if(tasks.has(id))return tasks.get(id);if(b.phase!=='review')return view(b);if(now()>b.expiresAt)throw Error('A revisão do lote expirou');if(active())throw Error('Outro lote está em curso');const task=execute(b);tasks.set(id,task);try{return await task;}finally{tasks.delete(id);}}
 async function stop(id){const b=get(id);b.stopped=true;if(b.phase==='review'){cancelReady(b);b.phase='stopped';}else if(['running','stopping'].includes(b.phase)){b.phase='stopping';const row=b.rows.find(r=>r.state==='sending');if(row)progression.stop(row.accountId);}return publish(b);}
 async function verify(id){const b=get(id);if(tasks.has(id))throw Error('Aguarda o pedido atual');for(const row of b.rows)if(row.state==='unconfirmed'){try{applyResult(row,await progression.verify(row.operationId));}catch{row.message='Resultado continua por confirmar. Consulta a operação da conta.';}}cancelReady(b);b.phase=b.rows.some(r=>r.state==='unconfirmed')?'blocked':'stopped';return publish(b);}
 function active(){return [...batches.values()].some(b=>['running','stopping','blocked'].includes(b.phase));}
 return {ready,discover,prepare,confirm,stop,verify,active,status:id=>id?view(get(id)):view([...batches.values()].find(b=>['running','stopping','blocked'].includes(b.phase))||[...batches.values()].at(-1)||{phase:'idle',rows:[]}),list:()=>copy([...batches.values()].reverse())};
}
function registerProgressionBatchIpc({ipcMain,service,runMutation=fn=>fn(),assertSender=()=>{}}){for(const action of ['discover','prepare','status','list','stop'])ipcMain.handle('progression-batch:'+action,(event,value)=>{assertSender(event);return service[action](value);});for(const action of ['confirm','verify'])ipcMain.handle('progression-batch:'+action,(event,value)=>{assertSender(event);return runMutation(()=>service[action](value));});}
module.exports={createProgressionBatch,registerProgressionBatchIpc};
