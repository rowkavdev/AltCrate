const {randomUUID}=require('node:crypto');
const {normalizeSequenceSteps,availableSequenceSteps}=require('./converterSequenceSteps.cjs');
const {protections}=require('./converterReview.cjs');
const {validId}=require('./inventoryItemLocator.cjs');
const {protectedResultIds}=require('./converterUnresolved.cjs');
const {inventoryRoom}=require('./converterOpeningPolicy.cjs');
const {openingPreparation}=require('./converterPreparation.cjs');
const {inventoryPreparation,inventoryShortage}=require('./converterInventoryPreparation.cjs');
const clone=value=>structuredClone(value);
const capsuleId='64d9ecad463b7ffa9697e2ea';
const stamp=row=>JSON.stringify([row.operationId,row.state,row.pending,row.sourceIdentity,row.destinationAccountId,row.destinationIdentity,row.completedSteps,row.handoffs,row.remainingSkinIds]);
function createSequenceReview({listAccounts,readRun=()=>({rows:[]}),read,readInventory,locator,now=Date.now,check=()=>{},validateScope=()=>{},canRepeat=()=>false,onProgress=()=>{}}){
 const previews=new Map(),observations=new Map();let preparing=false,observationScope=null,generation=0;
 function invalidate(){generation++;previews.clear();observations.clear();observationScope=null;}
 function observationSession(config,prior){
  const scope=JSON.stringify([config,prior.map(row=>[stamp(row),row.originalDoneIds,row.destinationConvertedIds,row.preparationCompleted,row.remainingItems,row.resolution,row.sequencePlan?.effectiveSteps])]);
  if(scope!==observationScope){generation++;observations.clear();observationScope=scope;}
  return generation;
 }
 function checkSession(session){check();if(session!==generation)throw Error('A revisão mudou. Revê as etapas novamente.');}
 async function inventory(account,budget,profile,identity,session){
  const items=[],ids=new Set();let pages=1,count;
  const scope=JSON.stringify([identity,profile]),at=now();let observation=observations.get(account.id);
  if(!observation||observation.scope!==scope||at<observation.observedAt||at>=observation.expiresAt)observation=null;
  for(let p=1;p<=pages;p++){
   checkSession(session);if(budget.error)throw budget.error;
   // A fresh head binds cached tail pages to the reviewed count, ordering and
   // metadata. Item actions still locate and validate each item before mutation.
   const cached=p>1&&observation&&now()<observation.expiresAt?observation.pages.get(p):null;
   const body=cached||await readInventory(account.id,p);checkSession(session);
   if(!Array.isArray(body?.skins)||!Number.isSafeInteger(body.pages)||body.pages<1||body.pages>10000||!Number.isSafeInteger(body.count)||body.count<0)throw Error('Leitura incompleta do inventário de '+account.label);
   if(p===1){
    pages=body.pages;count=body.count;const head=JSON.stringify([pages,count,body.skins]);
    if(!observation||observation.head!==head){const observedAt=now();observation={scope,head,observedAt,expiresAt:observedAt+30000,pages:new Map()};}
   }else if(pages!==body.pages||count!==body.count)throw Error('O inventário mudou durante a revisão');
   for(const item of body.skins){if(!validId(item.id)||ids.has(item.id))throw Error('IDs inválidos no inventário');if(++budget.count>100000)throw Error('A revisão excede 100.000 itens');ids.add(item.id);items.push({...clone(item),ref:{accountId:account.id,itemId:item.id,page:p,storageUnitId:null,name:item.name||''}});}
   if(!cached)observation.pages.set(p,clone(body));observations.set(account.id,observation);
  }
  if(items.length!==count)throw Error('Inventário incompleto');return items;
 }
 function space(profile,label,freed=0){if(!Number.isSafeInteger(profile.inventorySize)||!Number.isSafeInteger(profile.inventoryCount)||profile.inventoryCount-freed>=profile.inventorySize)throw Error('Falta espaço no inventário de '+label);}
 async function trading(account,profile){if(profile.dailyTradesLeft===0||(await read(account,api=>api.tradingStatus()))?.isUnlocked!==true)throw Error('Trocas bloqueadas ou limite diário atingido em '+account.label);}
 function validate(input){
  if(!input||!Array.isArray(input.accountIds)||!input.accountIds.length||input.accountIds.length>100||input.accountIds.some(id=>typeof id!=='string'||!id||id.length>200)||new Set(input.accountIds).size!==input.accountIds.length)throw Error('Seleciona contas de origem diferentes');
  const steps=normalizeSequenceSteps(input.steps);
  if(input.independent!==undefined&&typeof input.independent!=='boolean')throw Error('Modo independente inválido');
  if(input.independent&&input.resumeOperationIds?.length)throw Error('Escolhe novas etapas ou continuação.');
  if(input.routing!==undefined&&!['auto','selected'].includes(input.routing))throw Error('Percurso inválido');
  if(input.destinationAccountId!==undefined&&input.destinationAccountId!==null&&(typeof input.destinationAccountId!=='string'||input.accountIds.includes(input.destinationAccountId)))throw Error('Escolhe uma principal diferente das origens');
  for(const [key,max,length] of [['protectedItemIds',100000,240],['resumeOperationIds',100,100],['repeatOperationIds',100,100]])if(input[key]!==undefined&&(!Array.isArray(input[key])||input[key].length>max||input[key].some(id=>typeof id!=='string'||!id||id.length>length)||new Set(input[key]).size!==input[key].length))throw Error('Seleção de continuação ou de itens inválida');
  if(input.resumeOperationIds?.length&&input.repeatOperationIds?.length)throw Error('Escolhe continuar ou repetir, sem misturar os modos.');
  return {action:'sequence',independent:input.independent===true,accountIds:[...input.accountIds],destinationAccountId:input.destinationAccountId||null,steps,routing:input.routing||'selected',protectedItemIds:input.protectedItemIds||[],resumeOperationIds:input.resumeOperationIds||[],repeatOperationIds:input.repeatOperationIds||[]};
 }
 async function build(config){
  const initialSession=generation;check();onProgress({completed:0,total:config.accountIds.length,label:''});
  const known=await listAccounts(),byId=new Map(known.map(a=>[a.id,a])),prior=(readRun().rows||[]),resuming=config.resumeOperationIds.length>0,repeating=config.independent||config.repeatOperationIds.length>0;
  checkSession(initialSession);
  const session=observationSession(config,prior);checkSession(session);
  const previous=[...config.resumeOperationIds,...config.repeatOperationIds].map(id=>prior.find(row=>row.operationId===id));
  if(previous.some(row=>!row||row.pending||['running','unconfirmed','waiting'].includes(row.state))||new Set(previous.map(r=>r.accountId)).size!==previous.length||(resuming||repeating)&&(!config.independent&&previous.length!==config.accountIds.length||previous.some(r=>!config.accountIds.includes(r.accountId))))throw Error('Verifica a execução anterior antes de continuar');
  if(config.independent){const latest=new Map();for(const row of prior)if(config.accountIds.includes(row.accountId)&&canRepeat(row))latest.set(row.accountId,row.operationId);if([...latest.values()].some(id=>!config.repeatOperationIds.includes(id)))throw Error('O registo desta conta mudou. Revê as etapas.');}
  if(repeating&&previous.some(row=>!canRepeat(row)))throw Error('Resolve os itens e resultados desta conta antes de repetir etapas.');
  const reservedIds=protectedResultIds(prior);
  const heldIds=new Set(prior.flatMap(row=>[...(row.pending?.skinIds||[]),...(row.remainingSkinIds||[]),...(row.handoffs||[]).map(i=>i.id),...(row.remainingItems||[]).map(i=>i.id)]));
  const needsMain=config.steps.some(s=>['transfer','convert-received'].includes(s));
  const targetId=config.destinationAccountId||(resuming?previous.find(r=>r.destinationAccountId)?.destinationAccountId:null),destination=needsMain?byId.get(targetId):null;
  if(needsMain&&(!destination||config.accountIds.includes(destination.id)))throw Error('Escolhe uma principal diferente das origens');
  const target=destination?{...(await read(destination,api=>api.converterProfile())),identity:await locator.identity(destination.id)}:null;
  const identities=new Set(target?[target.identity]:[]),selected=new Set(config.protectedItemIds),budget={count:0},mapped=Array(config.accountIds.length);let next=0,completed=0,targetTrading;
  const capsule=config.steps.includes('buy')?await read(byId.get(config.accountIds[0])||{id:config.accountIds[0]},api=>api.converterCapsule()):null;
  if(capsule&&(!Number.isFinite(capsule.price)||capsule.price<=0))throw Error('Preço da cápsula inválido');
  await Promise.allSettled(Array.from({length:Math.min(4,config.accountIds.length)},async()=>{
   try{while(!budget.error&&next<config.accountIds.length){const index=next++,source=byId.get(config.accountIds[index]);if(!source)throw Error('Conta de origem não encontrada');
    check();const profile=await read(source,api=>api.converterProfile()),identity=await locator.identity(source.id);check();
    if(identities.has(identity))throw Error('Duas sessões pertencem à mesma identidade');identities.add(identity);
    if(!Number.isFinite(profile.tokens)||profile.tokens<0||!Number.isFinite(profile.money)||profile.money<0)throw Error('Saldo por verificar em '+source.label);
    const priorRow=previous.find(row=>row.accountId===source.id),old=priorRow,handoffs=clone(old?.handoffs||[]);
    if(priorRow&&priorRow.sourceIdentity!==identity)throw Error('A identidade da origem mudou');
    if(old&&handoffs.some(i=>i.location==='destination')&&(config.destinationAccountId&&config.destinationAccountId!==old.destinationAccountId||needsMain&&(destination?.id!==old.destinationAccountId||target?.identity!==old.destinationIdentity)))throw Error('A principal dos itens recebidos não pode mudar');
    let effectiveSteps=[...config.steps];
    if(resuming&&old){if(['stopped','failed','cancelled'].includes(old.state))effectiveSteps=effectiveSteps.filter(s=>!old.completedSteps?.includes(s));const allowed=availableSequenceSteps(old);if(!effectiveSteps.length||effectiveSteps.some(s=>!allowed.includes(s)))throw Error('Estas etapas não correspondem aos itens identificados na execução anterior');}
    let route=effectiveSteps.includes('mint')||handoffs.some(i=>i.kind==='skin'&&i.location==='source')?'skins':profile.membership==='pro'?'tokens':'skins';
    if(config.routing==='auto'&&profile.membership==='pro'&&effectiveSteps.includes('transfer')&&!handoffs.some(i=>i.kind==='skin'&&i.location==='source')){effectiveSteps=effectiveSteps.filter(s=>!['mint','convert-received'].includes(s));route='tokens';}
    if(effectiveSteps.includes('transfer')&&!['pro','basic','free'].includes(profile.membership))throw Error('Tipo de conta por verificar');
    if(route==='skins'&&effectiveSteps.includes('convert-inventory')&&effectiveSteps.includes('transfer')&&!effectiveSteps.includes('mint'))throw Error('Seleciona Criar skins para enviar os tokens de uma conta Sem Pro');
    if(effectiveSteps.includes('convert-received')&&!effectiveSteps.includes('transfer')&&!handoffs.some(i=>i.location==='destination'))throw Error('Não há skins recebidas identificadas de uma execução anterior');
    if(effectiveSteps.includes('convert-stickers')&&!effectiveSteps.includes('open')&&!handoffs.some(i=>i.kind==='sticker'&&i.location==='source')&&!old?.remainingSkinIds?.length)throw Error('Não há stickers identificados de uma abertura anterior');
    const prerequisites=effectiveSteps.includes('open')?openingPreparation(await read(source,api=>api.converterOpeningConfiguration())):[];
    const needsRoom=effectiveSteps.some(s=>['open','mint'].includes(s)),room=needsRoom?inventoryRoom(profile):0;
    const carriedStickers=handoffs.some(i=>i.kind==='sticker'&&i.location==='source')||!!old?.remainingSkinIds?.length;
    const readStock=needsRoom&&room===0||effectiveSteps.includes('convert-inventory')||effectiveSteps.includes('transfer')&&route==='skins'&&(!effectiveSteps.includes('mint')||handoffs.some(i=>i.kind==='skin'&&i.location==='source'))||effectiveSteps.includes('convert-stickers')&&carriedStickers;
    let all=readStock?await inventory(source,budget,profile,identity,session):[];const items=[],excludedItems=[];
    if(!resuming)for(const item of all){const flags=[...protections(item),...(reservedIds.has(item.id)?['unresolved-result']:[])],entry={...item,protection:flags};if(reservedIds.has(item.id)||flags.includes('favorite')||flags.includes('unpriced')||flags.length&&!selected.has(source.id+':'+item.id))excludedItems.push(entry);else items.push(entry);}
    if([...handoffs,...(old?.remainingItems||[])].some(item=>reservedIds.has(item.id))||(old?.remainingSkinIds||[]).some(id=>reservedIds.has(id)))throw Error('Há resultados anteriores por rever entre os itens desta continuação.');
    const existing=handoffs.filter(i=>i.location==='source'),sourceMap=new Map(all.map(i=>[i.id,i]));
    const conversionItems=resuming?[...new Map([...(old.sequencePlan.items||[]),...(old.sequencePlan.prerequisites||[]).filter(p=>p.kind==='convert-existing').flatMap(p=>p.items||[])].filter(i=>!old.originalDoneIds?.includes(i.id)).map(item=>[item.id,item])).values()]:items;
    if(resuming&&effectiveSteps.includes('convert-inventory'))for(const item of conversionItems){const found=sourceMap.get(item.id);if(!found||JSON.stringify(itemMetadata(found))!==JSON.stringify(itemMetadata(item)))throw Error('Um item revisto mudou ou deixou a origem');items.push({...clone(item),ref:found.ref});}
    if(readStock)for(const item of existing.filter(i=>effectiveSteps.includes('convert-inventory')||i.kind==='sticker'&&effectiveSteps.includes('convert-stickers')||i.kind==='skin'&&effectiveSteps.includes('transfer'))){const found=sourceMap.get(item.id);if(!found||JSON.stringify(itemMetadata(found))!==JSON.stringify(itemMetadata(item)))throw Error('Uma skin identificada mudou ou deixou a origem');}
    const stickerItems=effectiveSteps.includes('convert-stickers')?existing.filter(i=>i.kind==='sticker'):[];
    if(effectiveSteps.includes('convert-stickers'))for(const id of old?.remainingSkinIds||[])if(!stickerItems.some(i=>i.id===id)){const found=sourceMap.get(id);if(!found)throw Error('Sticker identificado não encontrado');stickerItems.push({...found,kind:'sticker',location:'source'});}
    let receivedItems=handoffs.filter(i=>i.location==='destination');
    if(receivedItems.length&&effectiveSteps.includes('convert-received')){const received=await inventory(destination,budget,target,target.identity,session),map=new Map(received.map(i=>[i.id,i]));receivedItems=receivedItems.map(item=>{const found=map.get(item.id);if(!found||JSON.stringify(itemMetadata(found))!==JSON.stringify(itemMetadata(item)))throw Error('Uma skin recebida mudou na principal');return {...found,kind:item.kind,location:'destination'};});}else receivedItems=[];
    const knownSkins=existing.filter(i=>i.kind==='skin'),transferItems=effectiveSteps.includes('transfer')&&route==='skins'?(knownSkins.length?knownSkins:!effectiveSteps.includes('mint')?items.filter(i=>!stickerItems.some(s=>s.id===i.id)&&!existing.some(s=>s.kind==='sticker'&&s.id===i.id)):[]):[];
    if(effectiveSteps.includes('transfer')){await trading(source,profile);await (targetTrading||=trading(destination,target));if(route==='skins')space(target,destination.label);}
    if(capsule&&profile.rank<capsule.rankNeeded)throw Error('Nível insuficiente para comprar cápsulas em '+source.label);
    let cases=effectiveSteps.some(s=>['sell','buy','open'].includes(s))?await read(source,api=>api.converterCases()):[];
    if(cases.some(c=>!validId(c.id)||!Number.isSafeInteger(c.amount)||c.amount<0))throw Error('Stock de caixas inválido');
    if(effectiveSteps.includes('sell')&&cases.some(c=>c.type==='case'&&c.amount>0)){
     const prices=new Map((await read(source,api=>api.converterCasePrices())).map(c=>[c.id,c.price]));
     cases=cases.map(item=>{if(item.type!=='case'||!item.amount)return item;const unitPrice=prices.get(item.id);if(!Number.isFinite(unitPrice)||unitPrice<0||!Number.isFinite(unitPrice*item.amount))throw Error('Cotação por confirmar para uma caixa revista');return {...item,unitPrice};});
    }
    const observedScopes={tokens:profile.tokens,money:profile.money,cases:clone(cases),capsule:clone(capsule),capsuleCount:cases.find(c=>c.id===capsuleId)?.amount||0};
    const proceeds=effectiveSteps.includes('sell')?cases.filter(c=>c.type==='case').reduce((n,c)=>n+(c.amount?c.unitPrice*c.amount:0),0):0;
    const openings=observedScopes.capsuleCount+(effectiveSteps.includes('buy')?Math.floor((profile.money+proceeds)/capsule.price):0);
    if(needsRoom&&!readStock&&inventoryShortage({profile,steps:effectiveSteps,items:conversionItems,stickerItems,openings})>0)all=await inventory(source,budget,profile,identity,session);
    const free=needsRoom?inventoryPreparation({profile,steps:effectiveSteps,all,items:conversionItems,stickerItems,openings,heldIds,label:source.label}):null;
    if(free){prerequisites.push(free);const used=new Set(free.items.map(i=>i.id));items.splice(0,items.length,...items.filter(i=>!used.has(i.id)));}
    if(effectiveSteps.includes('open')){
     const preparedRoom=Math.max(0,profile.inventorySize-profile.inventoryCount+(free?.items.length||0));
     if(openings>0&&(preparedRoom===0&&!stickerItems.length||!effectiveSteps.includes('convert-stickers')&&openings>preparedRoom))throw Error('Falta espaço no inventário de '+source.label+'. Converte primeiro os itens guardados ou escolhe Abrir e converter stickers.');
    }
    mapped[index]={accountId:source.id,label:source.label,sourceIdentity:identity,membership:profile.membership,route,effectiveSteps,prerequisites,items:effectiveSteps.includes('convert-inventory')?items:[],transferItems,stickerItems,receivedItems,excludedItems,carriedHandoffs:handoffs,carriedStickerIds:clone(old?.remainingSkinIds||[]),carriedItems:clone(old?.remainingItems||[]),resumeOperationId:resuming?old?.operationId||null:null,resumeStamp:resuming&&old?stamp(old):null,repeatOperationId:repeating?priorRow?.operationId||null:null,repeatStamp:repeating&&priorRow?stamp(priorRow):null,observedScopes,scopes:resuming&&old?.sequencePlan?.scopes?clone(old.sequencePlan.scopes):observedScopes,maxTokens:Math.floor(profile.tokens+items.reduce((n,i)=>n+i.price*10,0)),inventoryCount:profile.inventoryCount};onProgress({completed:++completed,total:config.accountIds.length,label:source.label});
   }}catch(error){budget.error||=error;}
  }));
  if(budget.error)throw budget.error;checkSession(session);
  const targetView=destination?{accountId:destination.id,label:destination.label,identity:target.identity,membership:target.membership}:null;
  const plan={config,steps:config.steps,routing:config.routing,rows:mapped,destination:targetView};validateScope(plan);return plan;
 }
 const view=entry=>({...clone(entry),rows:entry.rows.map(({sourceIdentity,resumeStamp,...row})=>row),destination:entry.destination?Object.fromEntries(Object.entries(entry.destination).filter(([k])=>k!=='identity')):null});
 async function prepare(input){if(preparing)throw Error('Já está a preparar uma revisão');preparing=true;try{const config=validate(input),plan=await build(config),entry={...plan,previewId:randomUUID(),expiresAt:now()+300000};previews.clear();previews.set(entry.previewId,entry);return view(entry);}finally{preparing=false;}}
 async function consume(id){if(preparing)throw Error('Já está a preparar uma revisão');preparing=true;try{const entry=previews.get(id);if(!entry||entry.expiresAt<=now())throw Error('A revisão expirou');const current=await build(entry.config);check();if(JSON.stringify({...current,previewId:entry.previewId,expiresAt:entry.expiresAt})!==JSON.stringify(entry)||entry.expiresAt<=now())throw Error('O estado mudou. Revê as etapas novamente.');invalidate();return clone(entry);}finally{preparing=false;}}
 return {prepare,consume,invalidate,previewScope:id=>{const entry=previews.get(id);return entry&&entry.expiresAt>now()?clone(entry.config):null;}};
}
function itemMetadata(item){return ['id','name','type','price','float','exterior','isFavorite','statTrak','souvenir','hasPattern','patternId','patternName','eventName','quality','stickers','charm','floatRanks'].map(key=>item[key]??null);}
module.exports={createSequenceReview};
