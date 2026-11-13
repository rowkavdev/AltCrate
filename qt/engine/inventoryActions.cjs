const {randomUUID}=require('node:crypto');
const {parseRetryAfter}=require('./scheduler.cjs');
const VIEW=['operationId','kind','accountId','destinationAccountId','destinationStorageUnitId','destinationStorageName','locationAccountId','locationStorageUnitId','item','state','stage','message','verified','httpStatus','observedMoney','observedTokens','location','updatedAt'];
function operationView(record){const out={};for(const key of VIEW)if(Object.hasOwn(record,key))out[key]=structuredClone(record[key]);if(record.kind==='move-to-storage')out.canResume=['withdrawn','arrived'].includes(record.stage)&&record.intent!=='deposit'&&record.state==='unconfirmed';out.canCancel=['transfer','move-to-storage'].includes(record.kind)&&record.accountId!==record.destinationAccountId&&['running','unconfirmed'].includes(record.state)&&!!record.tradeId&&!record.transferConfirmed&&!record.cancelSent;return out;}
function createInventoryActions({listAccounts,apiForAccount,locator,accountQueue,coordinator,store,emit=()=>{},now=Date.now,transferService,storageDeposit}){
 const previews=new Map(),confirmations=new Map(),resumeTasks=new Map(),reservations=new Map(),records=new Map();let initialization;
 const key=ref=>ref.accountId+':'+ref.itemId;
 const pending=r=>['running','unconfirmed'].includes(r.state);
 const reservationKeys=r=>[key(r.ref),...(r.kind==='move-to-storage'&&r.destinationAccountId!==r.accountId?[key({accountId:r.destinationAccountId,itemId:r.ref.itemId})]:[])];
 function reserve(r){for(const value of reservationKeys(r))reservations.set(value,r.operationId);}
 function release(r){for(const value of reservationKeys(r))if(reservations.get(value)===r.operationId)reservations.delete(value);}
 async function ready(){initialization||=(async()=>{await store.load();for(const r of await store.list()){if(r.state==='running'){r.state='unconfirmed';r.message='Operação interrompida. Verifica o estado.';await store.put(r);}records.set(r.operationId,r);if(pending(r))reserve(r);}})();return initialization;}
 async function sync(){await ready();for(const saved of await store.list()){const current=records.get(saved.operationId);if(current)Object.assign(current,saved);else records.set(saved.operationId,saved);if(pending(saved))reserve(saved);else release(saved);}}
 async function publish(r){r.updatedAt=new Date(now()).toISOString();await store.put(r);records.set(r.operationId,r);if(pending(r))reserve(r);else release(r);emit({type:'inventory-action',at:r.updatedAt,...operationView(r)});return operationView(r);}
 function validate(request){
  if(!request||!['sell','convert','favorite','withdraw','transfer','move-to-storage'].includes(request.kind)||!request.ref||typeof request.ref.accountId!=='string')throw Error('Ação inválida');
  if(request.kind==='favorite'&&typeof request.isFavorite!=='boolean')throw Error('Favorito inválido');
  if(request.kind==='transfer'&&(typeof request.destinationAccountId!=='string'||request.destinationAccountId===request.ref.accountId))throw Error('Seleciona outra conta');
  if(request.kind==='move-to-storage'&&(typeof request.destinationAccountId!=='string'||typeof request.destinationStorageUnitId!=='string'))throw Error('Seleciona um storage de destino');
  return {kind:request.kind,ref:{accountId:request.ref.accountId,itemId:request.ref.itemId,storageUnitId:request.ref.storageUnitId??null,page:request.ref.page,name:typeof request.ref.name==='string'?request.ref.name.slice(0,180):''},...(request.kind==='favorite'?{isFavorite:request.isFavorite}:{}),...(['transfer','move-to-storage'].includes(request.kind)?{destinationAccountId:request.destinationAccountId}:{}),...(request.kind==='move-to-storage'?{destinationStorageUnitId:request.destinationStorageUnitId}:{})};
 }
 async function prepare(input){
  await sync();const request=validate(input);if(reservations.has(key(request.ref)))throw Error('Este item já tem uma operação pendente');
  const found=await locator.locate(request.ref);if(['sell','convert'].includes(request.kind)&&found.item.isFavorite)throw Error('Item favorito. Remove o favorito primeiro.');
  if(request.kind==='withdraw'&&!found.ref.storageUnitId)throw Error('Este item já está no inventário');
  if(request.kind==='move-to-storage'&&request.ref.accountId===request.destinationAccountId&&found.ref.storageUnitId===request.destinationStorageUnitId)throw Error('O item já está no mesmo storage');
  const destination=['transfer','move-to-storage'].includes(request.kind)?(await listAccounts()).find(a=>a.id===request.destinationAccountId):null;
  if(['transfer','move-to-storage'].includes(request.kind)&&!destination)throw Error('Conta de destino não encontrada');
  if(request.kind==='move-to-storage'&&!storageDeposit)throw Error('Movimento para storage indisponível');
  const destinationStorage=request.kind==='move-to-storage'?await storageDeposit.preflight(destination.id,request.destinationStorageUnitId):null;
  let transferIdentities;
  if(request.kind==='transfer'||request.kind==='move-to-storage'&&destination.id!==found.account.id){if(!transferService)throw Error('Envio não disponível');transferIdentities=await transferService.preflight({...request,located:found});}
  const steps=[];if(found.ref.storageUnitId&&['sell','convert','withdraw','transfer','move-to-storage'].includes(request.kind))steps.push('Retirar do storage para o inventário');
  const titles={sell:'Vender por dinheiro virtual',convert:'Converter em tokens',favorite:request.isFavorite?'Adicionar favorito':'Remover favorito',transfer:'Enviar para '+destination?.label};if(titles[request.kind])steps.push(titles[request.kind]);
  if(request.kind==='move-to-storage'){if(destination.id!==found.account.id)steps.push('Enviar para '+destination.label);steps.push('Guardar no storage '+destinationStorage.storage.name);}
  const preview={previewId:randomUUID(),kind:request.kind,ref:found.ref,item:found.item,sourceLabel:found.account.label,...(destination?{destinationAccountId:destination.id,destinationLabel:destination.label}:{}),...(destinationStorage?{destinationStorageUnitId:destinationStorage.storage.id,destinationStorageName:destinationStorage.storage.name}:{}),steps,quoteTokens:null};
  previews.set(preview.previewId,{preview,request:{...request,ref:found.ref},identity:found.identity,destinationIdentity:transferIdentities?.destinationIdentity||destinationStorage?.identity,expires:now()+300000});return structuredClone(preview);
 }
 async function accountFor(r){const account=(await listAccounts()).find(a=>a.id===r.accountId);if(!account)throw Error('Conta não encontrada');return account;}
 async function requestMutation(r,intent,work){
  r.intent=intent;r.stage='sending';await publish(r);
  const send=async()=>{const cooldown=await coordinator?.cooldown();if(cooldown>now()){const e=Error('Aguarda o limite da API antes de confirmar');e.notSent=true;throw e;}return work();};
  const result=await (accountQueue?accountQueue.run(r.accountId,send):send());r.httpStatus=result.status;
  if(result.status===429&&coordinator)await coordinator.limit(now()+parseRetryAfter(result.retryAfter,now()));
  if(!result.ok){const e=Error(result.message||'HTTP '+result.status);e.rejected=true;throw e;}return result;
 }
 async function confirm(previewId){
  await sync();if(typeof previewId!=='string')throw Error('Revisão inválida');if(confirmations.has(previewId))return confirmations.get(previewId);
  const saved=[...records.values()].find(r=>r.previewId===previewId);if(saved)return {operation:operationView(saved)};
  const entry=previews.get(previewId);if(!entry||entry.expires<now())throw Error('A revisão expirou. Abre a ação novamente.');
  const task=(async()=>{
   if(reservations.has(key(entry.request.ref)))throw Error('Este item já tem uma operação pendente');const operationId=randomUUID();reservations.set(key(entry.request.ref),operationId);
   let record;
   try{
    const latest=await locator.locate(entry.request.ref);
    const move=entry.request.kind==='move-to-storage',otherAccount=move&&entry.request.destinationAccountId!==latest.ref.accountId;
    const destinationCheck=move?await storageDeposit.preflight(entry.request.destinationAccountId,entry.request.destinationStorageUnitId):null;
    const transferCheck=entry.request.kind==='transfer'||otherAccount?await transferService.preflight(entry.request):null;
    if(latest.identity!==entry.identity||(transferCheck&&transferCheck.destinationIdentity!==entry.destinationIdentity)||(destinationCheck&&destinationCheck.identity!==entry.destinationIdentity)||(destinationCheck&&destinationCheck.storage.name!==entry.preview.destinationStorageName)||JSON.stringify(latest.item)!==JSON.stringify(entry.preview.item)||latest.ref.storageUnitId!==entry.preview.ref.storageUnitId){reservations.delete(key(entry.request.ref));return {reviewRequired:await prepare(entry.request)};}
    record={operationId,previewId,kind:entry.request.kind,ref:latest.ref,item:latest.item,reviewedItem:latest.item,request:entry.request,accountId:latest.ref.accountId,destinationAccountId:entry.request.destinationAccountId,destinationStorageUnitId:entry.request.destinationStorageUnitId,destinationStorageName:entry.preview.destinationStorageName,destinationIdentity:transferCheck?.destinationIdentity||destinationCheck?.identity,sourceLabel:entry.preview.sourceLabel,destinationLabel:entry.preview.destinationLabel,state:'running',stage:'prepared',message:'A preparar operação…',verified:false,httpStatus:null,observedMoney:null,observedTokens:null,location:latest.ref.storageUnitId?'storage':'inventory',locationAccountId:latest.ref.accountId,locationStorageUnitId:latest.ref.storageUnitId||null,sourceIdentity:latest.identity,createdAt:new Date(now()).toISOString()};
    await publish(record);previews.delete(previewId);
    if(record.kind==='transfer'||record.kind==='move-to-storage'&&otherAccount)return {operation:await transferService.start(record)};
    const api=apiForAccount(latest.account);
    if(record.ref.storageUnitId&&['sell','convert','withdraw','move-to-storage'].includes(record.kind)){
     await requestMutation(record,'withdraw',()=>api.withdrawStorageSkin(record.ref.itemId,record.ref.storageUnitId));record.withdrawAccepted=true;await publish(record);
     const [inside,outside]=await Promise.all([locator.scan(record.accountId,record.ref.itemId,null),locator.scan(record.accountId,record.ref.itemId,record.ref.storageUnitId)]);
     record.cursor=inside.cursor||null;record.storageCursor=outside.cursor||null;await publish(record);
     if(inside.outcome!=='found'||outside.outcome!=='absent')throw Error('Retirada por confirmar. Verifica a localização do item.');
     record.location='inventory';record.locationStorageUnitId=null;record.ref={...inside.ref};record.stage='withdrawn';await publish(record);
    }
    if(record.kind==='move-to-storage'){
     record.stage='withdrawn';record.message='Item no inventário da conta de destino';await publish(record);
     record.intent='deposit';record.stage='deposit-sending';await publish(record);
     const result=await storageDeposit.sendOnce(record);record.httpStatus=result.status;
     if(!result.ok){const error=Error(result.message||'Depósito recusado');error.rejected=true;throw error;}
     record.responseAccepted=true;await publish(record);return {operation:await verify(record.operationId)};
    }
    if(record.kind==='withdraw')record.responseAccepted=true;
    else{await requestMutation(record,record.kind,()=>record.kind==='sell'?api.sellSkin(record.ref.itemId):record.kind==='convert'?api.convertSkin(record.ref.itemId):api.setSkinFavorite(record.ref.itemId,record.request.isFavorite,!!record.ref.storageUnitId));record.responseAccepted=true;await publish(record);}
    return {operation:await verify(record.operationId)};
   }catch(error){
    if(!record){reservations.delete(key(entry.request.ref));throw error;}
    record.state=error.rejected||error.notSent?'failed':'unconfirmed';record.message=record.location==='inventory'&&record.withdrawAccepted?'O item ficou no inventário. '+String(error.message):String(error.message);if(record.kind!=='move-to-storage'||record.state==='failed')record.stage='result';return {operation:await publish(record)};
   }
  })();confirmations.set(previewId,task);try{return await task;}catch(e){confirmations.delete(previewId);throw e;}
 }
 async function verify(operationId){
  await sync();const r=records.get(operationId);if(!r)throw Error('Operação não encontrada');if(r.kind==='transfer'||r.kind==='move-to-storage'&&r.accountId!==r.destinationAccountId){const value=await transferService.verify(operationId);await sync();return value;}
  if(!pending(r))return operationView(r);
  try{
   if(r.kind==='move-to-storage'){
    if(r.intent==='withdraw'){
     if(await locator.identity(r.accountId)!==r.sourceIdentity)throw Error('A identidade da sessão mudou durante a retirada');
     const [inside,outside]=await Promise.all([locator.scan(r.accountId,r.ref.itemId,null,r.cursor),locator.scan(r.accountId,r.ref.itemId,r.ref.storageUnitId,r.storageCursor)]);
     r.cursor=inside.cursor||null;r.storageCursor=outside.cursor||null;
     if(inside.outcome==='found'&&outside.outcome==='absent'){r.ref=inside.ref;r.location='inventory';r.locationAccountId=r.accountId;r.locationStorageUnitId=null;r.stage='withdrawn';r.state='unconfirmed';r.message='Item no inventário da conta de origem. Continua o armazenamento quando estiveres pronto.';}
     else{r.state='unconfirmed';r.message='Retirada por confirmar. Verifica a localização do item.';}
     return publish(r);
    }
    const location=await storageDeposit.verifyComplete(r);r.location=location.location;r.locationAccountId=location.location==='unknown'?null:r.destinationAccountId;r.locationStorageUnitId=location.location==='storage'?r.destinationStorageUnitId:null;r.verified=location.location==='storage';r.state=r.verified?'confirmed':'unconfirmed';r.stage=r.verified?'result':r.stage;r.message=r.verified?'Item guardado no storage '+r.destinationStorageName:location.location==='inventory'?'Item no inventário da conta de destino. Verifica ou continua a operação.':'Localização por confirmar. Verifica o estado sem repetir a ação.';return publish(r);
   }
   if(await locator.identity(r.accountId)!==r.sourceIdentity)throw Error('A identidade da sessão mudou. Volta a ligar a conta original antes de verificar.');
   const account=await accountFor(r),api=apiForAccount(account);let proven=false;
   if(r.kind==='favorite'){const item=await locator.locate(r.ref);proven=r.responseAccepted===true&&item.item.isFavorite===r.request.isFavorite;}
   else if(r.kind==='withdraw'){const [inside,outside]=await Promise.all([locator.scan(r.accountId,r.ref.itemId,null,r.cursor),locator.scan(r.accountId,r.ref.itemId,r.request.ref.storageUnitId,r.storageCursor)]);r.cursor=inside.cursor||null;r.storageCursor=outside.cursor||null;proven=r.withdrawAccepted===true&&inside.outcome==='found'&&outside.outcome==='absent';if(inside.outcome==='found')r.location='inventory';}
   else{const found=await locator.scan(r.accountId,r.ref.itemId,null,r.cursor);r.cursor=found.cursor||null;proven=r.responseAccepted===true&&found.outcome==='absent';if(found.outcome==='found')r.location='inventory';}
   const balance=await (accountQueue?accountQueue.run(r.accountId,()=>api.balance()):api.balance());if(await locator.identity(r.accountId)!==r.sourceIdentity)throw Error('A identidade da sessão mudou durante a leitura.');r.observedMoney=balance.money;r.observedTokens=balance.tokens;
   r.verified=proven;r.state=proven?'confirmed':'unconfirmed';r.stage='result';r.message=proven?({sell:'Venda confirmada',convert:'Conversão confirmada',favorite:'Favorito atualizado',withdraw:'Item retirado para o inventário'}[r.kind]):'Por confirmar. Verificar estado consulta o servidor sem repetir a ação.';
  }catch(e){r.state='unconfirmed';r.message=String(e.message);}
  return publish(r);
 }
 async function performResume(operationId){
  await sync();const r=records.get(operationId);if(!r||r.kind!=='move-to-storage')throw Error('Movimento não encontrado');
  if(!pending(r)||r.intent==='deposit'||!['withdrawn','arrived'].includes(r.stage))throw Error('Esta etapa não pode ser repetida');
  if(r.accountId!==r.destinationAccountId){const value=await transferService.resumeDeposit(operationId);await sync();return value;}
  const location=await storageDeposit.verifyComplete(r);if(location.location!=='inventory')throw Error('A localização do item não está confirmada no inventário de destino');
  r.intent='deposit';r.stage='deposit-sending';r.state='running';await publish(r);
  try{const result=await storageDeposit.sendOnce(r);r.httpStatus=result.status;if(!result.ok){r.state='failed';r.message=result.message||'Depósito recusado';return publish(r);}r.responseAccepted=true;return verify(operationId);}catch(e){r.state='unconfirmed';if(e.notSent){r.intent='withdraw';r.stage='withdrawn';}r.message=String(e.message);return publish(r);}
 }
 async function resume(operationId){if(resumeTasks.has(operationId))return resumeTasks.get(operationId);const task=performResume(operationId);resumeTasks.set(operationId,task);try{return await task;}finally{resumeTasks.delete(operationId);}}
 return {prepare,confirm,verify,resume,async list(){await sync();return [...records.values()].map(operationView);},async cancel(id){await sync();const r=records.get(id);if(!r)throw Error('Operação não encontrada');if(r.kind==='transfer'||r.kind==='move-to-storage'&&r.accountId!==r.destinationAccountId){const value=await transferService.cancel(id);await sync();return value;}throw Error('Esta ação já foi enviada. Usa Verificar estado.');},blocksAccount(accountId){return [...records.values()].some(r=>pending(r)&&(r.accountId===accountId||r.destinationAccountId===accountId));},isItemReserved(accountId,itemId){const k=accountId+':'+itemId,id=reservations.get(k);if(id&&records.get(id)&&!pending(records.get(id)))reservations.delete(k);return reservations.has(k);}};
}
module.exports={createInventoryActions,operationView};
