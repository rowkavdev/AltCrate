const {validId}=require('./inventoryItemLocator.cjs');
const active=job=>['queued','running'].includes(job?.state);
const stamp=job=>job?JSON.stringify(job):null;
const jobId=job=>typeof job?.jobId==='string'?job.jobId:typeof job?.id==='string'?job.id:null;
function createTokenSkinRoute(){
 async function verifyMint(row,source,ctx){
  const pending=row.pending;
  if(pending?.kind!=='mint')throw Error('Não existe conversão para skins por verificar');
  let job,items;
  if(pending.inlineSkins?.length){items=pending.inlineSkins;job={state:'done',tokens:pending.amount,created:items.length,convertedToMoney:0};}
  else{
   job=(await ctx.read(source,api=>api.converterQueueStatus())).jobs['tokens-to-skins'];
   if(!job)throw Error('A fila já não identifica esta conversão. Revê o resultado no site.');
   const identity=jobId(job);
   if(pending.queueJobId&&identity!==pending.queueJobId||identity&&identity===pending.previousJobId)throw Error('O trabalho da fila mudou. Não é possível associar estas skins à conversão revista.');
   if(identity&&!pending.queueJobId){pending.queueJobId=identity;await ctx.publish(row);}
   if(active(job)){
    pending.seenActive=true;row.queuePosition=job.position??null;row.queueProgress=job.progress||null;
    row.stage='mint';row.message=job.state==='queued'?'Conversão na fila do site':'O site está a criar as skins';await ctx.publish(row);return false;
   }
   if(job.state==='failed')throw Error(job.error||'A conversão falhou no site. Verifica o saldo antes de continuar.');
   if(job.state!=='done'||job.tokens!==pending.amount||!Number.isSafeInteger(job.created)||job.created<1||(!pending.seenActive&&stamp(job)===pending.previousJob))throw Error('O resultado da fila não corresponde à conversão atual');
   if(!Number.isFinite(job.convertedToMoney)||job.convertedToMoney<0)throw Error('O resultado não confirmou o valor pago em dinheiro');
   if(job.convertedToMoney>0){
    if(!pending.payoutRecorded){row.convertedToMoney=(row.convertedToMoney||0)+job.convertedToMoney;pending.payoutRecorded=true;await ctx.publish(row);}
    throw Error('O site pagou parte em dinheiro por falta de espaço. A rota foi suspensa para revisão.');
   }
   items=await ctx.read(source,api=>api.convertedTokenSkins());
  }
  const previous=new Set([...(pending.beforeInventoryIds||[]),...(pending.previousResultIds||[])]),seen=new Set();
  if(!Array.isArray(items)||items.length!==job.created||items.some(item=>!validId(item?.id)||previous.has(item.id)||seen.has(item.id)||!seen.add(item.id)))throw Error('As skins criadas não estão identificadas de forma única nesta conversão');
  const balance=await ctx.read(source,api=>api.converterProfile());
  if(Math.abs(balance.tokens-(pending.beforeTokens-pending.amount))>0.00001)throw Error('O débito dos tokens não corresponde ao pedido revisto');
  const inventory=await ctx.inventory(source),current=new Map(inventory.map(item=>[item.id,item]));
  if(items.some(item=>!current.has(item.id)))throw Error('A chegada das skins ao inventário da origem está por confirmar');
  const existing=new Set((row.remainingItems||[]).map(item=>item.id));
  if(items.some(item=>existing.has(item.id)))throw Error('Uma skin já pertence a outro lote desta execução');
  ctx.claimResults?.(items.map(item=>item.id),row);
  const entries=items.map(item=>({...item,ref:current.get(item.id).ref||{accountId:source.id,itemId:item.id,page:1,storageUnitId:null,name:item.name||''}}));
  row.remainingItems=[...(row.remainingItems||[]),...entries];row.mintedItems=(row.mintedItems||0)+entries.length;
  if(row.sequencePlan)row.handoffs=[...(row.handoffs||[]),...entries.map(item=>({...item,kind:'skin',location:'source'}))];
  row.mintBatches=[...(row.mintBatches||[]),{amount:pending.amount,skinIds:entries.map(i=>i.id),value:job.value??null,created:entries.length}];
  row.mintSpent=(row.mintSpent||0)+pending.amount;row.pending=null;row.queuePosition=null;row.queueProgress=null;
  row.message=entries.length+' skins criadas e identificadas';await ctx.publish(row);return true;
 }
 async function mint(row,source,destination,ctx){
  const amount=ctx.amount;
  if(!Number.isSafeInteger(amount)||amount<1||amount>100000000)throw Error('Montante de conversão inválido');
  if(row.pending)throw Error('Verifica a operação pendente antes de criar novas skins');
  ctx.check();
  const [profile,target,queue,previous,inventory]=await Promise.all([
   ctx.read(source,api=>api.converterProfile()),destination?ctx.read(destination,api=>api.converterProfile()):Promise.resolve(null),ctx.read(source,api=>api.converterQueueStatus()),ctx.read(source,api=>api.convertedTokenSkins()),ctx.inventory(source)
  ]);ctx.check();
  if(active(queue.jobs['tokens-to-skins'])||active(queue.jobs['bulk-sell']))throw Error('Esta conta já tem uma conversão na fila ou em curso');
  for(const value of [profile,target].filter(Boolean))if(!Number.isSafeInteger(value.inventoryCount)||!Number.isSafeInteger(value.inventorySize)||value.inventoryCount>=value.inventorySize)throw Error('Falta espaço no inventário para receber as skins');
  if(profile.tokens<amount)throw Error('O saldo de tokens mudou');
  const pending={kind:'mint',amount,beforeTokens:profile.tokens,beforeInventoryIds:inventory.map(i=>i.id),previousResultIds:previous.map(i=>i.id),previousJob:stamp(queue.jobs['tokens-to-skins']),previousJobId:jobId(queue.jobs['tokens-to-skins']),queueJobId:null,seenActive:false};
  row.stage='mint';row.message='A pedir a conversão de tokens para skins';
  const result=await ctx.mutate(row,source,pending,api=>api.convertTokensToSkins(amount));
  pending.accepted=true;if(result.skins?.length)pending.inlineSkins=result.skins;await ctx.publish(row);
  const deadline=Date.now()+(ctx.timeoutMs??300000);
  while(true){ctx.check();if(await verifyMint(row,source,ctx))return;ctx.check();if(Date.now()>=deadline)throw Error('A conversão continua pendente no site. Usa Verificar estado.');await ctx.wait(ctx.pollMs??2000);}
 }
 return {mint,verifyMint};
}
module.exports={createTokenSkinRoute};
