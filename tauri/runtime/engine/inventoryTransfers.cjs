const {operationView}=require('./inventoryActions.cjs');
const {parseRetryAfter}=require('./scheduler.cjs');
function createInventoryTransfers({listAccounts,apiForAccount,locator,transport,accountQueue,coordinator,store,storageDeposit,emit=()=>{},now=Date.now}){
 const records=new Map(),sessions=new Map(),tasks=new Map(),depositTasks=new Map();
 const pending=r=>['running','unconfirmed'].includes(r.state);
 async function gate(accountId){const retryAt=await coordinator?.cooldown(accountId);if(retryAt>now())throw Object.assign(Error('Aguarda o limite da API antes de continuar'),{notSent:true,status:429,retryAt});}
 function rememberLimit(r,error){if(error.status===429){r.httpStatus=429;r.retryAt=error.retryAt||now()+parseRetryAfter(error.retryAfter,now());}}
 async function mutate(account,work){return accountQueue.run(account.id,async()=>{await gate(account.id);const result=await work();if(result.status===429){result.retryAt=now()+parseRetryAfter(result.retryAfter,now());await coordinator?.limit?.(result.retryAt,account.id);}return result;});}
 async function accountsFor(r){const accounts=await listAccounts(),source=accounts.find(a=>a.id===(r.accountId||r.ref.accountId)),destination=accounts.find(a=>a.id===r.destinationAccountId);if(!source||!destination||source.id===destination.id)throw Error('Seleciona duas contas distintas');return {source,destination};}
 async function preflight(request){
  const {source,destination}=await accountsFor(request),sourceIdentity=await transport.identity(source),destinationIdentity=await transport.identity(destination);
  if(sourceIdentity===destinationIdentity)throw Error('As sessões pertencem à mesma conta. Seleciona contas distintas.');
  for(const account of [source,destination]){const status=await apiForAccount(account).tradingStatus();if(status?.isUnlocked!==true)throw Error('As trocas não estão desbloqueadas em '+account.label);}
  for(const r of await store.list())if(pending(r)&&['transfer','move-to-storage'].includes(r.kind)&&[r.accountId,r.destinationAccountId].some(id=>[source.id,destination.id].includes(id)))throw Error('Uma das contas já tem um envio pendente');
  return {source,destination,sourceIdentity,destinationIdentity};
 }
 async function publish(r){r.updatedAt=new Date(now()).toISOString();await store.put(r);records.set(r.operationId,r);emit({type:'inventory-action',at:r.updatedAt,...operationView(r)});return operationView(r);}
 async function get(id){if((tasks.has(id)||depositTasks.has(id))&&records.has(id))return records.get(id);const saved=await store.get(id);if(!saved||!['transfer','move-to-storage'].includes(saved.kind))throw Error('Envio não encontrado');const r=records.get(id)||saved;Object.assign(r,saved);records.set(id,r);return r;}
 function close(r){const session=sessions.get(r.operationId);if(session){for(const h of session.handles)h.close();sessions.delete(r.operationId);}transport.dispose(r.accountId);transport.dispose(r.destinationAccountId);}
 function signal(session){for(const done of session.waiters.splice(0))done();}
 async function observe(r){
  if(sessions.has(r.operationId))return sessions.get(r.operationId);const {source,destination}=await accountsFor(r),s={source,destination,snapshots:new Map(),waiters:[],handles:[],error:null};sessions.set(r.operationId,s);
  for(const account of [source,destination]){
   const handle=await transport.watch(account,r.tradeId,update=>{
    if(update.snapshot){s.snapshots.set(account.id,update.snapshot);r.lastTrade=update.snapshot;}
    if(update.kind==='confirmed'&&update.snapshot?.status==='finished'){r.transferConfirmed=true;}
    if(['error','disconnected','exited'].includes(update.kind)){s.error=update.message||'A troca mudou. Verifica o estado.';}
    signal(s);
   });s.handles.push(handle);
  }
  return s;
 }
 async function wait(r,s,predicate){const deadline=now()+30000;while(!predicate()){
  if(r.cancelSent)throw Error('Cancelamento em curso');if(s.error)throw Error(s.error);const left=deadline-now();if(left<=0)throw Error('Etapa da troca por confirmar');
  await new Promise(resolve=>{const done=()=>{clearTimeout(timer);s.waiters=s.waiters.filter(w=>w!==done);resolve();},timer=setTimeout(done,left);s.waiters.push(done);});
 }}
 function validateOffer(r,snapshot,withItem=true){
  if(!snapshot||snapshot.host?.userId!==r.sourceIdentity||snapshot.guest?.userId!==r.destinationIdentity)throw Error('Participantes inesperados na troca');
  if(!snapshot.offerKnown||snapshot.host.tokens!==0||snapshot.guest.tokens!==0||snapshot.guest.skinIds.length||snapshot.host.skinIds.length!==(withItem?1:0)||(withItem&&snapshot.host.skinIds[0]!==r.ref.itemId))throw Error('A oferta mudou. O envio ficou suspenso.');
  if(['finished','cancelled'].includes(snapshot.status))throw Error('A troca já terminou');
 }
 async function command(r,s,account,kind){
  if(r.cancelSent)throw Error('Cancelamento em curso');if(s.error)throw Error(s.error);
  const snapshot=await transport.refresh(account,r.tradeId);validateOffer(r,snapshot,kind!=='add');
  if(kind==='confirm'&&(!snapshot.host.hasAccepted||!snapshot.guest.hasAccepted))throw Error('A oferta deixou de estar aceite por ambas as contas');
  const tag=account.id+':'+kind;if(r.sentCommands?.includes(tag))throw Error('Este comando já foi enviado. Verifica o estado.');
  r.sentCommands=[...(r.sentCommands||[]),tag];r.intent=kind;r.stage=kind;r.message={add:'A adicionar o item',accept:'A aceitar a oferta',confirm:'A confirmar o envio'}[kind];await publish(r);
  await transport.command(account,r.tradeId,kind,kind==='add'?r.ref.itemId:undefined,{beforeSend:()=>gate(account.id),guard:()=>{
   if(r.cancelSent||s.error)throw Error(s.error||'Cancelamento em curso');
   for(const latest of s.snapshots.values()){validateOffer(r,latest,kind!=='add');if(kind==='confirm'&&(!latest.host.hasAccepted||!latest.guest.hasAccepted))throw Error('A oferta deixou de estar aceite');}
  }});
 }
 async function execute(r){
  try{
   const {source,destination}=await accountsFor(r);
   if(await transport.identity(source)!==r.sourceIdentity||await transport.identity(destination)!==r.destinationIdentity)throw Error('A identidade de uma das contas mudou');
   if(r.ref.storageUnitId){
    r.intent='withdraw';r.stage='withdrawing';await publish(r);const result=await mutate(source,()=>apiForAccount(source).withdrawStorageSkin(r.ref.itemId,r.ref.storageUnitId));if(!result.ok)throw Object.assign(Error(result.message||'Retirada recusada'),{rejected:true,status:result.status,retryAt:result.retryAt});r.withdrawAccepted=true;await publish(r);
    const [inside,outside]=await Promise.all([locator.scan(source.id,r.ref.itemId,null),locator.scan(source.id,r.ref.itemId,r.ref.storageUnitId)]);if(inside.outcome!=='found'||outside.outcome!=='absent')throw Error('Retirada por confirmar');r.ref=inside.ref;r.location='inventory';r.locationAccountId=source.id;r.locationStorageUnitId=null;await publish(r);
   }
   r.intent='create';r.stage='creating';r.message='A criar a troca';await publish(r);const created=await mutate(source,()=>apiForAccount(source).createTrade());r.httpStatus=created.status;
   if(!created.ok||!created.tradeId)throw Object.assign(Error(created.message||'Criação da troca por confirmar'),{rejected:!created.ok,status:created.status,retryAt:created.retryAt});r.tradeId=created.tradeId;r.stage='participants';await publish(r);
   const s=await observe(r);await wait(r,s,()=>s.snapshots.get(source.id)?.guest&&s.snapshots.get(destination.id)?.guest);
   await command(r,s,source,'add');await wait(r,s,()=>s.snapshots.get(source.id)?.host.skinIds.includes(r.ref.itemId)&&s.snapshots.get(destination.id)?.host.skinIds.includes(r.ref.itemId));
   for(const account of [source,destination]){await command(r,s,account,'accept');await wait(r,s,()=>s.snapshots.get(account.id)?.[account.id===source.id?'host':'guest']?.hasAccepted);}
   for(const account of [source,destination]){
    if(r.transferConfirmed)break;await command(r,s,account,'confirm');
   }
   await wait(r,s,()=>r.transferConfirmed===true);await publish(r);
   const arrival=await verify(r.operationId);
   return r.kind==='move-to-storage'&&arrival.stage==='arrived'?resumeDeposit(r.operationId):arrival;
  }catch(e){if(r.cancelSent)return operationView(r);rememberLimit(r,e);r.state=(e.notSent||e.rejected)&&!r.tradeId?'failed':'unconfirmed';r.message=(r.withdrawAccepted?'O item foi retirado do storage. ':'')+String(e.message);r.stage='result';return publish(r);}
 }
 async function start(r){
  // prepare already checked limits; bind identities again without excluding this journal entry.
  const {source,destination}=await accountsFor(r);if(await transport.identity(source)!==r.sourceIdentity||await transport.identity(destination)!==r.destinationIdentity)throw Error('A identidade de uma das contas mudou');if(r.sourceIdentity===r.destinationIdentity)throw Error('Seleciona contas distintas');
  records.set(r.operationId,r);r.sentCommands=[];await publish(r);const task=execute(r).catch(async e=>{r.state='unconfirmed';r.message=String(e.message);await publish(r);});tasks.set(r.operationId,task);task.finally(()=>tasks.delete(r.operationId)).catch(()=>{});return operationView(r);
 }
 async function verify(id){
  const r=await get(id);if(['confirmed','cancelled','failed'].includes(r.state))return operationView(r);
  try{
   const {source,destination}=await accountsFor(r);
   if(await transport.identity(source)!==r.sourceIdentity||await transport.identity(destination)!==r.destinationIdentity)throw Error('A identidade de uma das contas mudou');
   if(r.kind==='move-to-storage'&&r.intent==='deposit'){
    const placement=await storageDeposit.verifyComplete(r);r.location=placement.location;r.locationAccountId=placement.location==='unknown'?null:destination.id;r.locationStorageUnitId=placement.location==='storage'?r.destinationStorageUnitId:null;
    if(r.transferConfirmed&&placement.location==='storage'){r.state='confirmed';r.verified=true;r.stage='result';r.message='Item guardado no storage '+r.destinationStorageName;}
    else{r.state='unconfirmed';r.verified=false;r.message=placement.location==='inventory'?'Depósito por confirmar; o item está no inventário do destino.':'Localização do depósito por confirmar.';}
    const answer=await publish(r);if(!pending(r))close(r);return answer;
   }
   let cancellationProven=false;
   if(r.tradeId){
    const status=await apiForAccount(source).tradingStatus(),active=status?.activeUserTrades,finished=status?.finishedUserTrades;
    const listed=[...(Array.isArray(active)?active:[]),...(Array.isArray(finished)?finished:[])].find(t=>t?._id===r.tradeId);
    if(listed?.status==='finished'&&listed.host?.user?.userId===r.sourceIdentity&&listed.guest?.user?.userId===r.destinationIdentity)r.transferConfirmed=true;
    if(r.cancelSent&&Array.isArray(active)&&Array.isArray(finished))cancellationProven=listed?['cancelled','deleted'].includes(listed.status)&&listed.host?.user?.userId===r.sourceIdentity:!r.transferConfirmed;
    if(!cancellationProven&&!r.transferConfirmed){const s=await observe(r);s.error=null;const snapshot=await transport.refresh(source,r.tradeId);r.lastTrade=snapshot;if(snapshot.status==='finished'&&snapshot.host?.userId===r.sourceIdentity&&snapshot.guest?.userId===r.destinationIdentity)r.transferConfirmed=true;if(r.cancelSent&&['cancelled','deleted'].includes(snapshot.status)&&snapshot.host?.userId===r.sourceIdentity)cancellationProven=true;}
   }
   const [origin,dest]=await Promise.all([locator.scan(source.id,r.ref.itemId,null,r.cursor),locator.scan(destination.id,r.ref.itemId,null,r.destinationCursor)]);r.cursor=origin.cursor||null;r.destinationCursor=dest.cursor||null;
   if(await transport.identity(source)!==r.sourceIdentity||await transport.identity(destination)!==r.destinationIdentity)throw Error('A identidade mudou durante a leitura');
   if(r.transferConfirmed&&origin.outcome==='absent'&&dest.outcome==='found'){
    if(r.kind==='move-to-storage'){r.state='unconfirmed';r.verified=false;r.stage='arrived';r.location='inventory';r.locationAccountId=destination.id;r.locationStorageUnitId=null;r.message='Chegada confirmada no inventário do destino. A guardar no storage.';}
    else{r.state='confirmed';r.verified=true;r.stage='result';r.location='unknown';r.message='Enviado. Chegada confirmada na conta de destino.';}
   }
   else if(r.cancelSent&&cancellationProven&&!r.transferConfirmed&&origin.outcome==='found'&&dest.outcome==='absent'){r.state='cancelled';r.verified=true;r.location='inventory';r.locationAccountId=source.id;r.message='Item devolvido ao inventário da origem.';}
   else{r.state='unconfirmed';r.verified=false;r.message=r.transferConfirmed?'A confirmar chegada':'Por confirmar. Verifica o estado sem repetir o envio.';}
  }catch(e){rememberLimit(r,e);r.state='unconfirmed';r.message=String(e.message);}
  const result=await publish(r);if(!pending(r))close(r);return result;
 }
 async function performDeposit(id){
  const r=await get(id);if(r.kind!=='move-to-storage'||r.stage!=='arrived'||r.intent==='deposit'||!r.transferConfirmed)throw Error('Depósito indisponível nesta etapa');
  const placement=await storageDeposit.verifyComplete(r);if(placement.location!=='inventory')throw Error('Chegada ao inventário de destino por confirmar');
  r.intent='deposit';r.stage='deposit-sending';r.state='running';r.message='A guardar no storage de destino';await publish(r);
  try{
   const result=await storageDeposit.sendOnce(r);r.httpStatus=result.status;
   if(!result.ok){r.state='failed';r.location='inventory';r.locationAccountId=r.destinationAccountId;r.locationStorageUnitId=null;r.stage='result';r.message='Depósito recusado. O item ficou no inventário de '+r.destinationLabel+'.';const answer=await publish(r);close(r);return answer;}
   r.responseAccepted=true;await publish(r);return verify(id);
  }catch(error){r.state='unconfirmed';if(error.notSent){r.intent=null;r.stage='arrived';r.message='Depósito não enviado. '+String(error.message);}else r.message='Depósito por confirmar. '+String(error.message);await publish(r);return operationView(r);}
 }
 async function resumeDeposit(id){
  if(depositTasks.has(id))return depositTasks.get(id);
  const task=performDeposit(id);depositTasks.set(id,task);
  try{return await task;}finally{depositTasks.delete(id);}
 }
 async function cancel(id){
  const r=await get(id);if(r.state==='confirmed'||r.transferConfirmed)throw Error('O envio já foi concluído');if(r.cancelSent)return verify(id);if(!r.tradeId)throw Error('Criação da troca por confirmar. Não é possível cancelar sem o identificador.');
  const s=await observe(r),snapshot=await transport.refresh(s.source,r.tradeId);if(snapshot.status==='finished'){r.transferConfirmed=true;await verify(id);throw Error('O envio já foi concluído');}if(snapshot.host?.userId!==r.sourceIdentity)throw Error('A origem da troca mudou');
  await gate(s.source.id);r.cancelSent=true;r.intent='delete';r.stage='cancelling';await publish(r);signal(s);await transport.command(s.source,r.tradeId,'delete',undefined,{beforeSend:()=>gate(s.source.id),guard:()=>{if(s.snapshots.get(s.source.id)?.status==='finished')throw Error('O envio já foi concluído');}});return verify(id);
 }
 return {preflight,start,verify,cancel,resumeDeposit,blocksAccount(accountId){return [...records.values()].some(r=>pending(r)&&[r.accountId,r.destinationAccountId].includes(accountId));}};
}
module.exports={createInventoryTransfers};
