const {validId}=require('./inventoryItemLocator.cjs');
const {isClosedUnresolved}=require('./converterUnresolved.cjs');
const {assertOpeningPolicy,inventoryRoom}=require('./converterOpeningPolicy.cjs');
const {sameConfiguration}=require('./converterPreparation.cjs');
const CAPSULE='64d9ecad463b7ffa9697e2ea';
const quantity=(boxes,id)=>boxes.find(box=>box.id===id)?.amount||0;
function createConverterSequence(ctx){
 const done=(row,step)=>{row.completedSteps||=[];if(!row.completedSteps.includes(step))row.completedSteps.push(step);};
 async function verifyLocal(row,source){
  const p=row.pending;if(!p?.kind?.startsWith('seq-'))throw Error('Etapa local por identificar');
  if(p.kind==='seq-preference'){
   const current=await ctx.read(source,api=>api.converterOpeningConfiguration(),{priority:'verification'});
   if(p.preparation!=='disable-autosell'||!p.after||p.after.config?.autosellActivated!==false||!sameConfiguration(current,p.after))throw Error('A preparação da conta continua por confirmar. Não foram iniciadas as etapas escolhidas.');
   row.preparationCompleted=[...new Set([...(row.preparationCompleted||[]),p.preparation])];row.pending=null;await ctx.publish(row);return;
  }
  let openedStock;
  if(p.kind==='seq-open'){
   if(p.skinIds==null){
    // Inventory changes cannot establish which drops belong to this request.
    // Observe the whole scope for explicit closure, without claiming any item.
    ctx.verificationProgress?.(row,{stage:'inventory',expected:p.amount,found:0,unknownResultScope:true});
    await ctx.inventory(source,{onProgress:inventory=>ctx.verificationProgress?.(row,{inventory})});
    await ctx.read(source,api=>api.converterProfile(),{priority:'verification'});
    const boxes=await ctx.read(source,api=>api.converterCases(),{priority:'verification'});
    await ctx.identify(row,source);
    ctx.verificationProgress?.(row,{unknownScopeDiagnosticComplete:true,observedCapsules:quantity(boxes,p.id),expectedCapsules:p.before-p.amount});
    throw Error('A resposta não identificou os resultados da abertura. Podes encerrar sem confirmar; o inventário desta conta continua protegido. O pedido não será repetido.');
   }
   if(!Array.isArray(p.skinIds)||p.skinIds.length!==p.amount||new Set(p.skinIds).size!==p.amount||p.skinIds.some(id=>!validId(id)))throw Error('A abertura não identificou todos os stickers. O pedido não será repetido.');
   for(const id of p.skinIds)ctx.assertResultAvailable?.(id,row);
   ctx.verificationProgress?.(row,{stage:'inventory',expected:p.amount});
   openedStock=new Map((await ctx.inventory(source,{onProgress:inventory=>ctx.verificationProgress?.(row,{inventory})})).map(item=>[item.id,item]));
   ctx.verificationProgress?.(row,{found:p.skinIds.reduce((n,id)=>n+Number(openedStock.has(id)),0)});
   if(p.skinIds.some(id=>!openedStock.has(id)))throw Error('A chegada dos stickers está por confirmar');
  }
  // Observe stock last: the confirmed state also validates the next case type.
  const profile=await ctx.read(source,api=>api.converterProfile(),{priority:'verification'}),boxes=await ctx.read(source,api=>api.converterCases(),{priority:'verification'});
  const expected=p.kind==='seq-buy'?p.before+p.amount:p.before-p.amount;
  if(quantity(boxes,p.id)!==expected&&!(p.kind==='seq-open'&&isClosedUnresolved(row)))throw Error('Alteração do stock por confirmar. O pedido não será repetido.');
  row.stepProgress||={};
  if(p.kind==='seq-sell'){
   if(profile.money<p.beforeMoney)throw Error('Receita da venda por confirmar');
   if(!Number.isFinite(p.maximumCredit)||p.maximumCredit<0)throw Error('A receita da venda não tem cotação revista. Revê o saldo antes de comprar.');
   row.sold+=p.amount;row.saleMoney=(row.saleMoney||0)+Math.min(profile.money-p.beforeMoney,p.maximumCredit);
   row.stepProgress.soldCases=[...(row.stepProgress.soldCases||[]),p.id];
  }else if(p.kind==='seq-buy'){
   if(Math.abs(profile.money-(p.beforeMoney-p.cost))>0.0001)throw Error('Débito da compra por confirmar');
   row.bought+=p.amount;row.stepProgress.buyDone=true;done(row,'buy');
  }else if(p.kind==='seq-open'){
   ctx.claimResults?.(p.skinIds,row,{recoverClosed:isClosedUnresolved(row)});
   row.opened+=p.amount;row.remainingSkinIds=[...(row.remainingSkinIds||[]),...p.skinIds];
   row.handoffs=[...(row.handoffs||[]),...p.skinIds.map(id=>({...openedStock.get(id),kind:'sticker',location:'source'}))];
  }else throw Error('Etapa local desconhecida');
  row.pending=null;await ctx.publish(row);return {boxes,profile,openedStock};
 }
 async function sell(row,source){
  const prior=new Set(row.stepProgress.soldCases||[]);let confirmed;
  for(const box of row.sequencePlan.scopes.cases.filter(b=>b.type==='case'&&b.amount>0)){
   if(prior.has(box.id))continue;ctx.check();
   let stock,profile;
   if(confirmed)({boxes:stock,profile}=confirmed);
   else [stock,profile]=await Promise.all([ctx.read(source,api=>api.converterCases()),ctx.read(source,api=>api.converterProfile())]);
   if(quantity(stock,box.id)!==box.amount)throw Error('O stock revisto mudou antes da venda');
   await ctx.mutate(row,source,{kind:'seq-sell',id:box.id,before:box.amount,amount:box.amount,beforeMoney:profile.money,maximumCredit:box.unitPrice*box.amount},api=>api.sellCase(box.id,box.amount));
   confirmed=await verifyLocal(row,source);
  }
 }
 async function buy(row,source){
  if(row.stepProgress.buyDone)return;
  const capsule=row.sequencePlan.scopes.capsule,profile=await ctx.read(source,api=>api.converterProfile()),budget=row.sequencePlan.scopes.money+(row.saleMoney||0);
  if(Math.abs(profile.money-budget)>0.0001)throw Error('O dinheiro disponível mudou desde a revisão');
  const amount=Math.floor(budget/capsule.price);if(!Number.isSafeInteger(amount)||amount<0)throw Error('Saldo de compra inválido');
  if(!amount){row.stepProgress.buyDone=true;return;}
  const before=quantity(await ctx.read(source,api=>api.converterCases()),CAPSULE);
  if(before!==row.sequencePlan.scopes.capsuleCount)throw Error('O stock de cápsulas mudou');
  await ctx.mutate(row,source,{kind:'seq-buy',id:CAPSULE,before,amount,beforeMoney:profile.money,cost:amount*capsule.price},api=>api.buyConverterCapsules(amount));
  await verifyLocal(row,source);
 }
 async function convertStickers(row,source,destination,stock){
  const converted=new Set(row.originalDoneIds||[]),allowed=[...new Set([...(row.remainingSkinIds||[]),...(row.sequencePlan.stickerItems||[]).map(i=>i.id)])].filter(id=>!converted.has(id));
  if(!allowed.length)return;
  ctx.check();row.stage='convert-stickers';row.message='A converter os stickers identificados do lote';await ctx.publish(row);
  stock||=new Map((await ctx.inventory(source)).map(i=>[i.id,i]));
  for(const id of allowed){ctx.check();const item=stock.get(id);if(!item)throw Error('Sticker identificado não encontrado');await ctx.itemActions.perform(row,source,destination,source,'convert',item);}
 }
 async function open(row,source,destination){
  let remaining=row.sequencePlan.scopes.capsuleCount+row.bought-row.opened,confirmed;
  const streaming=row.sequencePlan.effectiveSteps.includes('convert-stickers');
  if(streaming)await convertStickers(row,source,destination);
  while(remaining>0){
   ctx.check();const profile=confirmed?.profile||await ctx.read(source,api=>api.converterProfile());
   if(!Number.isSafeInteger(profile.caseOpenCount)||profile.caseOpenCount<1||!Number.isSafeInteger(profile.maxCaseOpenMultiplier)||profile.maxCaseOpenMultiplier<1)throw Error('Configuração de abertura inválida');
   if(quantity(confirmed?.boxes||await ctx.read(source,api=>api.converterCases()),CAPSULE)!==remaining)throw Error('O stock de cápsulas mudou');
   const room=inventoryRoom(profile);if(!room)throw Object.assign(Error('Falta espaço no inventário. Converte os itens guardados antes de continuar a abertura.'),{stopped:true,notSent:true});
   const available=Math.min(remaining,room),max=Math.min(10,profile.maxCaseOpenMultiplier),multiplier=available>=max?max:1,count=Math.min(100,profile.caseOpenCount,Math.floor(available/multiplier)),amount=count*multiplier;
   assertOpeningPolicy(await ctx.read(source,api=>api.converterOpeningPolicy()),source.label);
   row.stage='open';row.message='A abrir um lote de cápsulas com espaço no inventário';
   const result=await ctx.mutate(row,source,{kind:'seq-open',id:CAPSULE,before:remaining,amount},api=>api.openConverterCapsules(count,multiplier));
   row.pending.skinIds=result.skinIds;await ctx.publish(row);confirmed=await verifyLocal(row,source);remaining-=amount;
   if(streaming){await convertStickers(row,source,destination,confirmed.openedStock);confirmed=undefined;}
  }
 }
 async function execute(row,source,destination,send){
  row.stepProgress||={};row.handoffs||=[];row.completedSteps||=[];
  await ctx.identify(row,source,destination);
  const plan=row.sequencePlan;
  for(const prerequisite of plan.prerequisites||[]){
   ctx.check();
   if(['free-inventory','convert-existing'].includes(prerequisite.kind)){
    row.stage='prepare-inventory';row.message='A libertar espaço com os itens revistos';await ctx.publish(row);
    for(const item of prerequisite.items){ctx.check();if(!row.originalDoneIds?.includes(item.id))await ctx.itemActions.perform(row,source,destination,source,'convert',item);}
    if(prerequisite.kind==='convert-existing')done(row,'convert-inventory');
    row.preparationCompleted=[...new Set([...(row.preparationCompleted||[]),prerequisite.kind])];await ctx.publish(row);continue;
   }
   const current=await ctx.read(source,api=>api.converterOpeningConfiguration());
   if(!sameConfiguration(current,prerequisite.before))throw Error('As preferências mudaram. Revê a preparação desta conta.');
   row.stage='prepare-account';row.message='A preparar a conta: desligar venda automática';
   await ctx.mutate(row,source,{kind:'seq-preference',preparation:prerequisite.kind,before:prerequisite.before,after:prerequisite.after},api=>api.setConverterOpeningConfiguration(prerequisite.after));
   await verifyLocal(row,source);
  }
  for(const step of plan.effectiveSteps){
   ctx.check();if(row.completedSteps.includes(step))continue;row.stage=step;row.message='A executar a etapa escolhida: '+step;await ctx.publish(row);
   if(step==='sell')await sell(row,source);
   if(step==='buy')await buy(row,source);
   if(step==='open')await open(row,source,destination);
   if(step==='convert-stickers')await convertStickers(row,source,destination);
   if(step==='convert-inventory'){
    const converted=new Set(row.originalDoneIds||[]);
    for(const item of plan.items){if(converted.has(item.id))continue;await ctx.itemActions.perform(row,source,destination,source,'convert',item);}
   }
   if(step==='mint'){
    while(true){ctx.check();const available=(await ctx.read(source,api=>api.converterProfile())).tokens,amount=Math.floor(Math.min(100000000,available,plan.tokenBudget-(row.mintSpent||0)));
     if(amount<1)break;await ctx.identify(row,source,destination);await ctx.skinRoute.mint(row,source,plan.effectiveSteps.includes('transfer')?destination:null,{...ctx.routeContext(),amount});
    }
   }
   if(step==='transfer'){
    if(row.route==='tokens')await send(()=>ctx.trade(row,source,destination));
    else await send(async()=>{
     for(const item of [...row.handoffs].filter(i=>i.kind==='skin'&&i.location==='source')){ctx.check();await ctx.assertSkinTrade(source,destination);await ctx.itemActions.perform(row,source,destination,source,'transfer',item);}
    });
   }
   if(step==='convert-received')await send(async()=>{
    for(const item of [...row.handoffs].filter(i=>i.location==='destination')){ctx.check();const found=await ctx.locator.locate({...item.ref,accountId:destination.id,storageUnitId:null});await ctx.itemActions.perform(row,source,destination,destination,'convert',{...item,ref:found.ref});}
   });
   done(row,step);await ctx.publish(row);
  }
  row.state=row.handoffs.length||row.remainingSkinIds?.length?'paused':'confirmed';row.verified=true;row.stage='result';row.message=row.state==='paused'?'Etapas concluídas. Itens guardados para a próxima etapa.':'Etapas escolhidas concluídas.';
 }
 return {execute,verifyLocal};
}
module.exports={createConverterSequence};
