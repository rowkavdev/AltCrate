const itemStamp=item=>JSON.stringify(['id','name','type','price','float','exterior','isFavorite','statTrak','souvenir','hasPattern','patternId','patternName','eventName','quality','stickers','charm','floatRanks'].map(key=>item[key]??null));
function createConverterItemActions({actions,operationStore,read,publish,check,wait,identify,gate,assertItem=()=>{},pollMs=200}){
 const add=(row,key,id)=>{row[key]||=[];if(!row[key].includes(id))row[key].push(id);};
 async function finish(row,account,op){
  const pending=row.pending;
  if(!pending||pending.kind!=='inventory-child')throw Error('Operação individual por identificar');
  if(!op||op.kind!==pending.childKind||op.accountId!==pending.accountId||op.item?.id!==pending.itemId||(op.kind==='transfer'&&op.destinationAccountId!==row.destinationAccountId))throw Error('A operação individual não corresponde ao item revisto');
  pending.operationId=op.operationId;pending.canCancel=op.canCancel===true;await publish(row);
  if(['failed','cancelled'].includes(op.state)){
   row.childOperations.push({...pending,state:op.state});row.pending=null;row.state='stopped';await publish(row);check();
   throw Object.assign(Error(op.message||'A operação não foi concluída'),{notSent:true,...(op.httpStatus===429?{status:429,retryAt:op.retryAt}:{})});
  }
  if(op.state!=='confirmed'||op.verified!==true)throw Object.assign(Error(op.message||'O resultado individual está por confirmar'),op.httpStatus===429?{status:429,retryAt:op.retryAt}:{});
  if(op.kind==='convert'){
   // The child already verified item absence, balance and session identity.
   // Older journals without that snapshot still need a fresh balance read.
   const balance=Number.isFinite(op.observedTokens)?{tokens:op.observedTokens}:await read(account,api=>api.balance());
   if(balance.tokens<=pending.beforeTokens)throw Error('O aumento de tokens desta conversão está por confirmar');
   if(account.id===row.accountId){
    const fresh=!row.originalDoneIds?.includes(pending.itemId);
    add(row,'originalDoneIds',pending.itemId);row.originalConverted=row.originalDoneIds.length;
    if(row.sequencePlan&&fresh){if(!Number.isFinite(pending.maximumCredit)||pending.maximumCredit<0)throw Error('Crédito da conversão sem valor revisto');row.sequencePlan.tokenBudget+=Math.min(balance.tokens-pending.beforeTokens,pending.maximumCredit);row.handoffs=(row.handoffs||[]).filter(i=>i.id!==pending.itemId);row.remainingSkinIds=(row.remainingSkinIds||[]).filter(id=>id!==pending.itemId);row.remainingItems=(row.remainingItems||[]).filter(item=>item.id!==pending.itemId);}
   }
   else if(!row.destinationConvertedIds?.includes(pending.itemId)){
    const maximumCredit=Number.isFinite(pending.maximumCredit)?pending.maximumCredit:Number.isFinite(op.item?.price)?op.item.price*10:NaN;
    if(!Number.isFinite(maximumCredit)||maximumCredit<0)throw Error('Crédito recebido sem valor revisto');
    add(row,'destinationConvertedIds',pending.itemId);row.receivedTokens=(row.receivedTokens||0)+Math.min(balance.tokens-pending.beforeTokens,maximumCredit);row.sentTokens=row.receivedTokens;
    row.remainingItems=row.remainingItems.filter(item=>item.id!==pending.itemId);
    if(row.sequencePlan)row.handoffs=(row.handoffs||[]).filter(item=>item.id!==pending.itemId);
   }
   row.converted=(row.originalDoneIds?.length||0)+(row.destinationConvertedIds?.length||0);
  }else{
   add(row,'transferredIds',pending.itemId);
   if(row.sequencePlan)row.handoffs=(row.handoffs||[]).map(item=>item.id===pending.itemId?{...item,location:'destination',ref:{...item.ref,accountId:row.destinationAccountId,storageUnitId:null}}:item);
  }
  row.childOperations.push({...pending,state:'confirmed'});row.pending=null;await publish(row);
 }
 async function perform(row,source,destination,account,kind,item){
  assertItem(item.id,row);
  check();await identify(row,source,destination);await gate(account.id);
  const before=kind==='convert'?await read(account,api=>api.balance()):null;
  const ref={...item.ref,accountId:account.id,storageUnitId:null};
  const preview=await actions.prepare({kind,ref,...(kind==='transfer'?{destinationAccountId:destination.id}:{})});
  if(itemStamp(preview.item)!==itemStamp(item))throw Object.assign(Error('O item mudou desde a revisão. Revê o inventário antes de continuar.'),{notSent:true});
  if(kind==='convert'&&(!Number.isFinite(item.price)||item.price<0))throw Error('A skin não tem valor revisto para atribuir o crédito');
  check();row.childOperations||=[];row.pending={kind:'inventory-child',childKind:kind,previewId:preview.previewId,accountId:account.id,itemId:item.id,beforeTokens:before?.tokens??null,...(kind==='convert'?{maximumCredit:item.price*10}:{})};await publish(row);
  let result;
  try{check();result=await actions.confirm(preview.previewId);}
  catch(error){
   // confirm journals the individual operation before any external request.
   // A rejected confirmation with no such record has not sent a mutation.
   const record=(await operationStore.list()).find(value=>value.previewId===preview.previewId);
   if(!record){row.childOperations.push({...row.pending,state:'not-sent'});row.pending=null;await publish(row);error.notSent=true;}
   throw error;
  }
  if(result?.reviewRequired){row.pending=null;await publish(row);throw Object.assign(Error('O item mudou durante a confirmação'),{notSent:true});}
  let operation=result?.operation;
  if(!operation)throw Error('A resposta não identificou a operação individual');
  row.pending.operationId=operation.operationId;row.pending.canCancel=operation.canCancel===true;await publish(row);
  const deadline=Date.now()+60000;
  while(operation.state==='running'){
   check();if(Date.now()>deadline)throw Error('A operação individual continua em curso. Usa Verificar estado.');
   await wait(pollMs);operation=(await actions.list()).find(value=>value.operationId===operation.operationId)||operation;
  }
  await identify(row,source,destination);await finish(row,account,operation);
 }
 async function verify(row,source,destination){
  const pending=row.pending;if(pending?.kind!=='inventory-child')throw Error('Operação individual não encontrada');
  const raw=(await operationStore.list()).find(value=>value.operationId===pending.operationId||value.previewId===pending.previewId);
  if(!raw){
   if(pending.operationId)throw Error('Sem correlação no registo individual. A ação não será repetida.');
   // After restart, the same journal-before-request invariant proves the
   // interruption happened before the inner operation was submitted.
   row.childOperations||=[];row.childOperations.push({...pending,state:'not-sent'});row.pending=null;await publish(row);return;
  }
  pending.operationId=raw.operationId;
  let op=(await actions.list()).find(value=>value.operationId===raw.operationId);
  if(op?.state==='running')throw Error('A operação individual ainda está em curso. Aguarda e verifica novamente.');
  if(['unconfirmed','unresolved'].includes(op?.state))op=await actions.verify(raw.operationId);
  await identify(row,source,destination);
  if(row.verification?.phase==='running')row.verification={...row.verification,childOperationId:raw.operationId,child:{operationId:raw.operationId,accountId:raw.accountId,itemId:raw.item?.id,complete:op?.verification?.complete===true,canCloseUnresolved:op?.canCloseUnresolved===true||op?.state==='unresolved'&&op.resolution?.kind==='unresolved-conversion',verification:op?.verification}};
  await finish(row,pending.accountId===source.id?source:destination,op);
 }
 async function closeUnresolved(row){
  const p=row.pending;if(p?.kind!=='inventory-child'||p.childKind!=='convert')throw Error('Conversão individual por identificar');
  const record=(await operationStore.list()).find(value=>value.operationId===p.operationId&&value.previewId===p.previewId);
  if(!record||record.kind!=='convert'||record.accountId!==p.accountId||record.item?.id!==p.itemId||record.ref?.itemId!==p.itemId)throw Error('Sem correlação no registo individual. A ação não será repetida.');
  if(typeof actions.closeUnresolved!=='function')throw Error('Encerramento individual indisponível');
  await actions.closeUnresolved(record.operationId);
 }
 async function cancel(row,source,destination){
  const p=row.pending;if(p?.kind!=='inventory-child')throw Error('Não existe troca individual pendente');
  const record=(await operationStore.list()).find(value=>value.operationId===p.operationId||value.previewId===p.previewId);
  if(!record||record.kind!=='transfer')throw Error('Esta operação não é uma troca cancelável');
  await identify(row,source,destination);await actions.cancel(record.operationId);return verify(row,source,destination);
 }
 return {perform,verify,cancel,closeUnresolved};
}
module.exports={createConverterItemActions};
