const {AsyncLocalStorage}=require('node:async_hooks');
const {randomUUID}=require('node:crypto');
const {parseRetryAfter}=require('./scheduler.cjs');
const {normalizeTrade}=require('./tradeTransport.cjs');
const {createConverterReview}=require('./converterReview.cjs');
const {createTokenSkinRoute}=require('./tokenSkinRoute.cjs');
const {createConverterItemActions}=require('./converterItemActions.cjs');
const {createSequenceReview}=require('./converterSequenceReview.cjs');
const {createConverterSequence}=require('./converterSequence.cjs');
const {availableSequenceSteps}=require('./converterSequenceSteps.cjs');
const {createConverterReadiness}=require('./converterReadiness.cjs');
const {canCloseUnresolved,isClosedUnresolved,protectedResultOwners,unresolvedResolution,unresolvedResultCount,requiresUnknownScopeIsolation}=require('./converterUnresolved.cjs');
const CAPSULE_ID='64d9ecad463b7ffa9697e2ea';
const ACTIONS=['full','sell','buy','open','trade'];
function canClearRow(row){
  return ['confirmed','failed','stopped','cancelled','skipped','reviewed'].includes(row.state)&&
    !row.pending&&!row.remainingSkinIds?.length&&!row.remainingItems?.length&&!row.handoffs?.length&&
    !row.childOperations?.some(child=>['running','unconfirmed'].includes(child.state))&&
    (!row.tradeId||row.transferConfirmed===true||row.state==='reviewed'||row.state==='cancelled'&&row.verified===true)&&
    (row.state!=='confirmed'||row.verified===true);
}
const canRepeatRow=row=>['paused','confirmed','failed','stopped','cancelled','skipped','reviewed'].includes(row.state)&&
  !row.pending&&!row.childOperations?.some(child=>['running','unconfirmed'].includes(child.state))&&
  (!row.tradeId||row.transferConfirmed===true||row.state==='reviewed'||row.state==='cancelled'&&row.verified===true)&&
  (row.state!=='confirmed'||row.verified===true)&&Array.isArray(row.sequencePlan?.selectedSteps)&&row.sequencePlan.selectedSteps.length>0;
function lockedAccountIds(row){
 const p=row.pending,local=!row.tradeId&&['seq-preference','seq-sell','seq-buy','seq-open','mint','sell','buy','open','convert'].includes(p?.kind);
 return (local?[row.accountId]:!row.tradeId&&p?.kind==='inventory-child'&&p.childKind==='convert'&&p.accountId?[row.accountId,p.accountId]:[row.accountId,row.destinationAccountId]).filter(Boolean);
}
// A capsule opening cannot change case stock. Keep its journal intact while
// allowing a separately reviewed case sale; inventory/capsule actions still wait.
const allowedIndependentSteps=row=>(row.state==='unconfirmed'||requiresUnknownScopeIsolation(row))&&!row.tradeId&&row.pending?.kind==='seq-open'?['sell']:[];
function repeatableOperationIds(rows,accountIds=[]){
 const selected=new Set(accountIds),latest=new Map();
 for(const row of rows)if(selected.has(row.accountId)&&canRepeatRow(row))latest.set(row.accountId,row.operationId);
 return [...latest.values()];
}
const publicFields=['operationId','accountId','sourceLabel','destinationAccountId','destinationLabel','state','stage','message','retryAt','sold','bought','opened','converted','sentTokens','offerTokens','tradeId','verified','updatedAt','membership','route','originalConverted','mintedItems','receivedTokens','convertedToMoney','queuePosition','queueProgress','completedSteps','history','verification','resolution','preparationCompleted'];

function createTokenConverter({listAccounts,apiForAccount,transport,accountQueue,coordinator,store,emit=()=>{},intervalMs=350,waitTimeoutMs=30000,canStart=async()=>{},locator,readInventory,inventoryActions,operationStore,consolidationPollMs=200,queuePollMs=2000}) {
  let run={phase:'idle',rows:[]},initialization,task,stopped=false,starting=false,chain=Promise.resolve();
  let unresolvedOwners=null;
  let invalidateReadiness=()=>{},preparation=null,preparationController=null,inspectionController=null;
  const verificationEmittedAt=new Map();
  const rowContext=new AsyncLocalStorage(),inspectionContext=new AsyncLocalStorage(),stoppedOperations=new Set(),rowControllers=new Map(),preparingAccounts=new Set();
  const emitStatus=()=>emit({type:'token-converter',at:new Date().toISOString(),status:status()});
  const listeners=new Set(),sessions=new Map(),reviews=new Map();
  const active=()=>starting||!!task||reviews.size>0||['preparing','revalidating','running','stopping'].includes(run.phase);
  const uncertain=()=>run.rows.some(row=>row.state==='unconfirmed');
  function assertRepeatScope(config,plan){
    if(!config.repeatOperationIds?.length&&!config.independent)return;
    if(config.independent&&!config.steps?.includes('convert-inventory')&&!(config.steps?.includes('transfer')&&!config.steps?.includes('mint')))return;
    const replaced=new Set(config.repeatOperationIds),involved=new Set(config.accountIds||[]);
    if(config.steps?.some(step=>['transfer','convert-received'].includes(step))&&config.destinationAccountId)involved.add(config.destinationAccountId);
    const identities=new Set(plan?[...plan.rows.map(row=>row.sourceIdentity),plan.destination?.identity].filter(Boolean):[]);
    for(const row of run.rows){
      if(replaced.has(row.operationId))continue;
      const protectedAccounts=new Map();
      const source=()=>protectedAccounts.set(row.accountId,row.sourceIdentity),destination=()=>protectedAccounts.set(row.destinationAccountId,row.destinationIdentity);
      for(const item of row.handoffs||[]){if(item.location==='source')source();else if(item.location==='destination')destination();else {source();destination();}}
      if(row.remainingSkinIds?.length)source();
      if(row.remainingItems?.length){source();if(row.destinationAccountId)destination();}
      if([...protectedAccounts.keys()].some(id=>!id||involved.has(id))||plan&&[...protectedAccounts.values()].some(identity=>!identity||identities.has(identity)))throw Error('Há itens guardados de outra operação nesta conta ou identidade. Continua esses itens antes de repetir etapas.');
    }
  }
  function assertContinuationScope(config,plan){
    assertRepeatScope(config,plan);
    const isolated=run.rows.filter(row=>row.state==='unconfirmed'||requiresUnknownScopeIsolation(row));
    if(!isolated.length)return;
    if(!config.independent&&!config.resumeOperationIds?.length&&!config.repeatOperationIds?.length)throw Error('Existe uma operação pendente. Continua apenas as contas já revistas, sem substituir o registo anterior.');
    const involved=new Set(config.accountIds||[]);
    const identities=new Set(plan?[...plan.rows.map(r=>r.sourceIdentity),plan.destination?.identity].filter(Boolean):[]);
    if(config.steps?.some(s=>['transfer','convert-received'].includes(s))){
      if(config.destinationAccountId)involved.add(config.destinationAccountId);
      else {const priorById=new Map(run.rows.map(r=>[r.operationId,r]));for(const id of [...(config.resumeOperationIds||[]),...(config.repeatOperationIds||[])]){const prior=priorById.get(id);if(prior?.destinationAccountId)involved.add(prior.destinationAccountId);}}
    }
    for(const row of isolated){
      if(config.independent&&!config.resumeOperationIds?.length&&config.steps?.length&&config.steps.every(step=>allowedIndependentSteps(row).includes(step)))continue;
      const accounts=lockedAccountIds(row);
      if(accounts.some(id=>id&&involved.has(id)))throw Error('Uma conta desta continuação tem um resultado por confirmar. Mantém essa conta isolada e verifica a operação pendente.');
      if(plan&&accounts.filter(Boolean).some(id=>{
        const identity=id===row.accountId?row.sourceIdentity:id===row.destinationAccountId?row.destinationIdentity:null;
        return !identity||identities.has(identity);
      }))throw Error('Uma identidade desta continuação está por confirmar ou não pode ser separada da operação pendente. Mantém essa conta isolada.');
    }
  }
  const status=()=>({...Object.fromEntries(['phase','action','destinationAccountId','message','retryAt','lastSelection'].map(k=>[k,run[k]])),
    ...(preparation?{phase:preparation.kind==='revalidation'?'revalidating':'preparing',preparation:{...preparation}}:{}),
    clearableCount:run.rows.reduce((n,row)=>n+Number(canClearRow(row)),0),
    sentTokens:run.rows.reduce((n,r)=>n+(r.receivedTokens||0)+((r.transferConfirmed===true||r.state==='confirmed')&&!r.receivedTokens?r.sentTokens||0:0),0),
    rows:run.rows.map(row=>({...Object.fromEntries(publicFields.filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]])),lockedAccountIds:row.state==='unconfirmed'||requiresUnknownScopeIsolation(row)?lockedAccountIds(row):[],allowedIndependentSteps:allowedIndependentSteps(row),canCloseUnresolved:canCloseUnresolved(row),canVerify:['unconfirmed','unresolved'].includes(row.state),unconfirmedResults:unresolvedResultCount(row),selectedSteps:row.sequencePlan?.selectedSteps,steps:row.sequencePlan?.effectiveSteps,availableSteps:availableSequenceSteps(row),handoffCounts:{source:(row.handoffs||[]).filter(i=>i.location==='source').length,destination:(row.handoffs||[]).filter(i=>i.location==='destination').length},stopRequested:row.stopRequested===true,canStop:!row.stopRequested&&['running','waiting','paused','stopped','unconfirmed'].includes(row.state),canRepeat:canRepeatRow(row),canReviewNext:!row.pending&&!!(row.sequencePlan||row.remainingSkinIds?.length)&&['paused','stopped','failed','cancelled','confirmed'].includes(row.state)&&availableSequenceSteps(row).length>0,pendingStickers:row.remainingSkinIds?.length||0,pendingItems:row.remainingItems?.length||0,canResume:!!row.consolidationPlan&&!row.pending&&['stopped','failed','cancelled'].includes(row.state),canCancel:row.state==='unconfirmed'&&(row.pending?.kind==='inventory-child'?row.pending.canCancel===true:!!row.tradeId&&!row.transferConfirmed&&!row.cancelSent&&!row.confirmSent)}))});
  function signal(){for(const done of [...listeners])done();}
  async function publish(row) {
    if(!row||row.resolution?.kind==='unresolved-opening')unresolvedOwners=null;
    invalidateReadiness();
    if(row)row.updatedAt=new Date().toISOString();
    const saved=store.capture?store.capture({version:1,...run},{row}):structuredClone({version:1,...run});
    const write=chain.then(()=>store.save(saved));chain=write.catch(()=>{});await write;
    emit({type:'token-converter',at:new Date().toISOString(),status:status(),...(row?{operationId:row.operationId,accountId:row.accountId,destinationAccountId:row.destinationAccountId}:{})});
  }
  async function ready() {
    initialization||=(async()=>{
      const saved=await store.load();
      if(saved){if(saved.version!==1||!Array.isArray(saved.rows))throw Error('Registo do conversor inválido');run=saved;
        for(const row of run.rows){if(row.state==='unresolved'&&!isClosedUnresolved(row))row.state='unconfirmed';if(row.verification?.phase==='running'){row.verification={...row.verification,phase:'interrupted',outcome:'pending',message:'A verificação foi interrompida. Volta a verificar o resultado.'};}if(row.state==='running'){row.state='unconfirmed';row.message='Execução interrompida. Verifica o resultado antes de continuar.';}else if(row.sequencePlan&&row.state==='waiting'){row.state=row.pending?'unconfirmed':'stopped';row.message='Arranque interrompido. Revê as etapas antes de continuar.';}}
        run.phase=uncertain()?'blocked':'idle';if(run.phase==='idle'&&run.message==='Verifica a operação pendente antes de iniciar outra execução.')run.message='Resultados verificados. Revê as próximas etapas antes de continuar.';await publish();
      }
    })();return initialization;
  }
  function check(row=rowContext.getStore()){if(stopped||row&&stoppedOperations.has(row.operationId))throw Object.assign(Error('Execução parada.'),{stopped:true,notSent:true});}
  function cooldownError(retryAt){return Object.assign(Error('O site limitou os pedidos. Aguarda antes de continuar.'),{notSent:true,status:429,retryAt});}
  function checkCooldown(){if(run.retryAt>Date.now())throw cooldownError(run.retryAt);}
  async function recordLimit(error,accountId){
    if(error.status!==429)return;
    const retryAt=Number.isFinite(error.retryAt)?error.retryAt:Date.now()+parseRetryAfter(error.retryAfter,Date.now());
    const changed=retryAt>(run.retryAt||0);error.retryAt=retryAt;run.retryAt=Math.max(run.retryAt||0,retryAt);
    if(accountId)await coordinator?.limit?.(retryAt,accountId);
    if(changed)await publish();
  }
  async function gate(accountId){check();checkCooldown();const until=await coordinator?.cooldown(accountId);check();if(until>Date.now())throw cooldownError(until);}
  async function read(account,work,{priority='user'}={}){return accountQueue.run(account.id,async()=>{checkCooldown();const until=await coordinator?.cooldown(account.id);if(until>Date.now())throw cooldownError(until);try{return await work(apiForAccount(account,{priority}));}catch(e){await recordLimit(e,account.id);throw e;}});}
  async function delay(ms){await new Promise(resolve=>{const done=()=>{clearTimeout(timer);listeners.delete(done);resolve();},timer=setTimeout(done,ms);listeners.add(done);});}
  const inspectReadiness=createConverterReadiness({listAccounts,read,readRun:()=>run,active});
  invalidateReadiness=inspectReadiness.invalidate;
  async function inspect(config){await ready();if(!inspectionController||inspectionController.signal.aborted)inspectionController=new AbortController();const controller=inspectionController;return inspectionContext.run(controller,()=>inspectReadiness({...config,signal:controller.signal}));}
  const reviewService=locator&&readInventory?createConverterReview({listAccounts,apiForAccount,readInventory,locator,read,check}):null;
  const sequenceReview=locator&&readInventory?createSequenceReview({listAccounts,readInventory,locator,read,check,readRun:()=>run,onProgress:progress=>{if(preparation){const changed=preparation.completed!==progress.completed||preparation.total!==progress.total||(preparation.label||'')!==(progress.label||'');preparation={...preparation,...progress};if(changed)emitStatus();}},validateScope:plan=>assertContinuationScope(plan.config,plan),canRepeat:canRepeatRow}):null;
  function assertResultAvailable(id,row){
    const owners=(unresolvedOwners||=protectedResultOwners(run.rows)).get(id);
    if(owners&&[...owners].some(owner=>owner!==row?.operationId))throw Error('Este item pertence a um resultado anterior guardado para revisão.');
  }
  function claimResults(ids,row,{recoverClosed=false}={}){
    const owners=unresolvedOwners||=protectedResultOwners(run.rows);
    for(const id of ids){assertResultAvailable(id,row);if(owners.has(id)&&!(recoverClosed&&isClosedUnresolved(row)))throw Error('Este resultado já está identificado noutro lote.');}
    for(const id of ids){if(!owners.has(id))owners.set(id,new Set());owners.get(id).add(row.operationId);}
  }
  const skinRoute=createTokenSkinRoute();
  const itemActions=inventoryActions&&operationStore?createConverterItemActions({actions:inventoryActions,operationStore,read,publish,check,wait:delay,identify,gate,assertItem:assertResultAvailable,pollMs:consolidationPollMs}):null;
  function verificationProgress(row,patch){
    if(row.verification?.phase!=='running')return;
    row.verification={...row.verification,...patch};
    const now=Date.now(),last=verificationEmittedAt.get(row.operationId)||0;
    if(now-last>=250||(patch.inventory&&patch.inventory.page===patch.inventory.pages)){verificationEmittedAt.set(row.operationId,now);emitStatus();}
  }
  async function inventorySnapshot(account,{onProgress}={}){
    const items=[],ids=new Set();let pages=1,count;
    for(let p=1;p<=pages;p++){
      if(task)check();const value=await readInventory(account.id,p);
      if(!Array.isArray(value?.skins)||!Number.isSafeInteger(value.pages)||value.pages<1||value.pages>10000||!Number.isSafeInteger(value.count)||value.count<0)throw Error('Leitura incompleta do inventário');
      if(p===1){pages=value.pages;count=value.count;}else if(value.pages!==pages||value.count!==count)throw Error('O inventário mudou durante a leitura');
      for(const item of value.skins){if(typeof item.id!=='string'||ids.has(item.id))throw Error('IDs inválidos ou repetidos no inventário');ids.add(item.id);items.push({...item,ref:{accountId:account.id,itemId:item.id,page:p,storageUnitId:null,name:item.name||''}});}
      onProgress?.({page:p,pages,read:items.length,total:count});
    }
    if(items.length!==count)throw Error('Leitura incompleta do inventário');return items;
  }
  const routeContext=()=>({read,mutate,publish,check,claimResults,wait:delay,inventory:inventorySnapshot,pollMs:queuePollMs});
  const sequence=createConverterSequence({read,mutate,publish,check,identify,verificationProgress,assertResultAvailable,claimResults,inventory:inventorySnapshot,itemActions,skinRoute,routeContext,trade,assertSkinTrade,locator});
  const hasKnownItems=()=>run.rows.some(r=>r.remainingItems?.length||r.handoffs?.length||(r.consolidationPlan||r.sequencePlan)&&r.pending);
  const hasLegacyItems=()=>run.rows.some(r=>r.remainingSkinIds?.length);
  async function prepare(config){
    if(config?.action==='sequence'){
      if(active())throw Error('Para ou verifica a execução anterior antes de rever etapas');
      starting=true;stopped=false;preparationController=new AbortController();preparingAccounts.clear();for(const id of config.accountIds||[])preparingAccounts.add(id);preparation={completed:0,total:config.accountIds?.length||0};emitStatus();
      try{await ready();checkCooldown();if(config.independent===true&&!config.resumeOperationIds?.length){config={...config,repeatOperationIds:repeatableOperationIds(run.rows,config.accountIds)};}assertContinuationScope(config);if(!config.independent&&!config.resumeOperationIds?.length&&!config.repeatOperationIds?.length&&(hasKnownItems()||hasLegacyItems()))throw Error('Há itens identificados na execução anterior. Revê a próxima etapa.');if(!sequenceReview||!itemActions)throw Error('Sequências não disponíveis');await canStart([...(config.accountIds||[]),config.destinationAccountId].filter(Boolean));return await sequenceReview.prepare(config);}catch(error){await recordLimit(error);throw error;}finally{preparation=null;preparationController=null;preparingAccounts.clear();starting=false;emitStatus();}
    }
    if(active()||uncertain()||hasKnownItems()||hasLegacyItems())throw Error('Para ou recupera a execução anterior antes de rever outra');
    if(!reviewService||!itemActions)throw Error('Consolidação não disponível nesta versão');
    starting=true;stopped=false;
    try{await ready();checkCooldown();if(uncertain()||hasKnownItems()||hasLegacyItems())throw Error('Recupera a execução anterior');await canStart([...(config?.accountIds||[]),config?.destinationAccountId].filter(Boolean));return await reviewService.prepare(config);}catch(error){await recordLimit(error);throw error;}finally{starting=false;}
  }
  const quantity=(boxes,id)=>boxes.find(box=>box.id===id)?.amount||0;
  async function pause(){check();if(intervalMs>0)await new Promise(resolve=>{const done=()=>{clearTimeout(timer);listeners.delete(done);resolve();},timer=setTimeout(done,intervalMs);listeners.add(done);});check();}
  async function identify(row,source,destination) {
    if(await transport.identity(source)!==row.sourceIdentity||(destination&&await transport.identity(destination)!==row.destinationIdentity))throw Error('A identidade de uma das contas mudou.');
  }
  async function mutate(row,source,pending,work) {
    check();await identify(row,source);await gate(source.id);
    sequenceReview?.invalidate();
    const previousPending=row.pending;row.pending=pending;
    try{await publish(row);}catch(error){row.pending=previousPending;throw Object.assign(error,{notSent:true});}
    let result;
    try{result=await accountQueue.run(source.id,async()=>{await gate(source.id);check();return work(apiForAccount(source,{beforeSend:()=>check(row)}));});}
    catch(e){if(e.notSent){row.pending=null;await publish(row);}throw e;}
    if(!result.ok){row.pending=null;await publish(row);throw Object.assign(Error(result.message||'HTTP '+result.status),{rejected:true,status:result.status,retryAfter:result.retryAfter});}
    return result;
  }
  async function clearPending(row){row.pending=null;await publish(row);}
  async function sell(row,source) {
    row.stage='sell';row.message='A vender caixas';await publish(row);
    const boxes=await read(source,api=>api.converterCases());
    for(const box of boxes.filter(box=>box.type==='case'&&box.amount>0)) {
      await mutate(row,source,{kind:'sell',id:box.id,before:box.amount,amount:box.amount},api=>api.sellCase(box.id,box.amount));
      const after=await read(source,api=>api.converterCases());
      if(quantity(after,box.id)!==0)throw Error('Venda de caixas por confirmar.');
      row.sold+=box.amount;await clearPending(row);await pause();
    }
  }
  async function buy(row,source,capsule) {
    row.stage='buy';row.message='A comprar cápsulas';await publish(row);
    const profile=await read(source,api=>api.converterProfile()),before=quantity(await read(source,api=>api.converterCases()),CAPSULE_ID);
    const amount=Math.floor(profile.money/capsule.price);if(!Number.isSafeInteger(amount)||amount<0)throw Error('Saldo inválido.');
    if(!amount)return;
    await mutate(row,source,{kind:'buy',id:CAPSULE_ID,before,amount},api=>api.buyConverterCapsules(amount));
    if(quantity(await read(source,api=>api.converterCases()),CAPSULE_ID)!==before+amount)throw Error('Compra de cápsulas por confirmar.');
    row.bought+=amount;await clearPending(row);await pause();
  }
  async function convertRemaining(row,source) {
    while(row.remainingSkinIds?.length) {
      check();const id=row.remainingSkinIds[0],before=await read(source,api=>api.balance());
      await mutate(row,source,{kind:'convert',id,before:before.tokens},api=>api.convertSkin(id));
      const after=await read(source,api=>api.balance());if(after.tokens<=before.tokens)throw Error('Conversão do sticker em tokens por confirmar.');
      row.remainingSkinIds.shift();row.converted++;await clearPending(row);await pause();
    }
  }
  async function open(row,source) {
    row.stage='open';row.message='A abrir e converter cápsulas';await publish(row);
    await convertRemaining(row,source);
    let remaining=quantity(await read(source,api=>api.converterCases()),CAPSULE_ID);
    while(remaining>0) {
      check();const profile=await read(source,api=>api.converterProfile());
      if(!Number.isSafeInteger(profile.caseOpenCount)||profile.caseOpenCount<1||!Number.isSafeInteger(profile.maxCaseOpenMultiplier)||profile.maxCaseOpenMultiplier<1)throw Error('Configuração de abertura inválida.');
      const maximumMultiplier=Math.min(10,profile.maxCaseOpenMultiplier);
      const multiplier=remaining>=maximumMultiplier?maximumMultiplier:1;
      const count=Math.min(100,profile.caseOpenCount,Math.floor(remaining/multiplier)),amount=count*multiplier;
      const result=await mutate(row,source,{kind:'open',id:CAPSULE_ID,before:remaining,amount},api=>api.openConverterCapsules(count,multiplier));
      row.pending.skinIds=result.skinIds;await publish(row);
      const after=quantity(await read(source,api=>api.converterCases()),CAPSULE_ID);
      if(after!==remaining-amount||result.skinIds.length!==amount)throw Error('Abertura ou identificação dos stickers por confirmar.');
      row.opened+=amount;row.remainingSkinIds=[...result.skinIds];await clearPending(row);remaining=after;
      await convertRemaining(row,source);
    }
  }
  function validateOffer(row,snapshot,amount,finished=false) {
    if(!snapshot||snapshot.host?.userId!==row.sourceIdentity||snapshot.guest?.userId!==row.destinationIdentity)throw Error('Participantes inesperados na troca.');
    if(!snapshot.offerKnown||snapshot.host.skinIds.length||snapshot.guest.skinIds.length||snapshot.host.tokens!==amount||snapshot.guest.tokens!==0)throw Error('A oferta da troca mudou.');
    if(finished?snapshot.status!=='finished':['finished','cancelled','deleted'].includes(snapshot.status))throw Error('O estado da troca mudou.');
  }
  async function observe(row,source,destination) {
    if(sessions.has(row.operationId))return sessions.get(row.operationId);
    const s={snapshots:new Map(),handles:[],error:null};sessions.set(row.operationId,s);
    try{for(const account of [source,destination])s.handles.push(await transport.watch(account,row.tradeId,update=>{
      if(update.snapshot)s.snapshots.set(account.id,update.snapshot);
      if(['error','disconnected','exited'].includes(update.kind))s.error=update.message||'A ligação à troca mudou.';
      signal();
    }));}catch(e){close(row,source,destination);throw e;}return s;
  }
  function close(row,source,destination){const s=sessions.get(row.operationId);if(!s)return;for(const h of s.handles)h.close();sessions.delete(row.operationId);transport.dispose(source.id);if(destination)transport.dispose(destination.id);}
  async function wait(s,predicate) {
    const deadline=Date.now()+waitTimeoutMs;
    while(!predicate()){check();if(s.error)throw Error(s.error);const left=deadline-Date.now();if(left<=0)throw Error('Etapa da troca por confirmar.');
      await new Promise(resolve=>{const done=()=>{clearTimeout(timer);listeners.delete(done);resolve();},timer=setTimeout(done,left);listeners.add(done);});
    }
    check();if(s.error)throw Error(s.error);
  }
  async function tradeCommand(row,s,source,destination,account,kind,amount) {
    check();await identify(row,source,destination);
    const snapshot=await transport.refresh(account,row.tradeId);validateOffer(row,snapshot,amount);
    if(kind==='confirm'&&(!snapshot.host.hasAccepted||!snapshot.guest.hasAccepted))throw Error('Ambas as contas devem aceitar a oferta.');
    row.stage=kind==='tokens'?'deposit':kind;row.message={tokens:'A colocar todos os tokens na troca',accept:'A aceitar a troca nas duas contas',confirm:'A confirmar o envio'}[kind];
    row.pending={kind};if(kind==='confirm')row.confirmSent=true;await publish(row);
    await transport.command(account,row.tradeId,kind,kind==='tokens'?row.offerTokens:undefined,{beforeSend:()=>gate(account.id),guard:()=>{
      check();if(s.error)throw Error(s.error);
      for(const latest of s.snapshots.values()){validateOffer(row,latest,amount);if(kind==='confirm'&&(!latest.host.hasAccepted||!latest.guest.hasAccepted))throw Error('A oferta deixou de estar aceite.');}
    }});
  }
  async function verifyArrival(row,source,destination) {
    await identify(row,source,destination);
    const a=await read(source,api=>api.balance()),b=await read(destination,api=>api.balance());
    if(a.tokens>row.sourceBefore-row.offerTokens+0.00001||b.tokens<row.destinationBefore+row.offerTokens-0.00001)throw Error('Chegada dos tokens à conta de destino por confirmar.');
    row.transferConfirmed=true;row.sentTokens=row.offerTokens;row.pending=null;row.state='confirmed';row.verified=true;row.stage='result';row.message='Tokens recebidos na conta de destino.';
    if(row.sequencePlan&&!row.completedSteps.includes('transfer'))row.completedSteps.push('transfer');
  }
  async function trade(row,source,destination) {
    row.stage='trade';row.message='A preparar a troca';await publish(row);
    const a=await read(source,api=>api.converterProfile()),b=await read(destination,api=>api.balance());
    if(a.membership!=='pro')throw Error('É necessário Pro na conta de origem para enviar tokens.');
    row.offerTokens=Math.floor(Math.min(a.tokens,row.sequencePlan?Math.max(0,row.sequencePlan.tokenBudget-(row.sentTokens||0)):row.consolidationPlan?.maxTokens??Infinity));if(!Number.isSafeInteger(row.offerTokens)||row.offerTokens<0)throw Error('Saldo de tokens inválido.');
    if(!row.offerTokens){row.message='Não há tokens inteiros para enviar.';return;}
    row.sourceBefore=a.tokens;row.destinationBefore=b.tokens;
    await identify(row,source,destination);
    // These markers describe one trade, including a create whose reply is lost.
    // Clear the prior identity before journalling the next create intent.
    for(const key of ['tradeId','cancelSent','confirmSent','transferConfirmed'])delete row[key];
    row.verified=false;
    const created=await mutate(row,source,{kind:'create'},api=>api.createTrade());
    if(!created.tradeId)throw Error('Criação da troca por confirmar.');row.tradeId=created.tradeId;await clearPending(row);
    const s=await observe(row,source,destination);
    await wait(s,()=>s.snapshots.get(source.id)?.guest&&s.snapshots.get(destination.id)?.guest);
    await tradeCommand(row,s,source,destination,source,'tokens',0);
    await wait(s,()=>[source,destination].every(a=>s.snapshots.get(a.id)?.host.tokens===row.offerTokens));await clearPending(row);
    for(const account of [source,destination]) {
      await tradeCommand(row,s,source,destination,account,'accept',row.offerTokens);
      await wait(s,()=>[source,destination].every(a=>s.snapshots.get(a.id)?.[account.id===source.id?'host':'guest']?.hasAccepted));await clearPending(row);
    }
    for(const account of [source,destination])await tradeCommand(row,s,source,destination,account,'confirm',row.offerTokens);
    await wait(s,()=>[source,destination].every(a=>s.snapshots.get(a.id)?.status==='finished'));
    for(const snapshot of s.snapshots.values())validateOffer(row,snapshot,row.offerTokens,true);
    await verifyArrival(row,source,destination);
  }
  async function assertSkinTrade(source,destination){
    for(const account of [source,destination]){
      const profile=await read(account,api=>api.converterProfile());
      if(profile.dailyTradesLeft===0)throw Error('Limite diário de trocas atingido em '+account.label);
      if((await read(account,api=>api.tradingStatus()))?.isUnlocked!==true)throw Error('Trocas bloqueadas em '+account.label);
      if(account.id===destination.id&&(!Number.isSafeInteger(profile.inventorySize)||!Number.isSafeInteger(profile.inventoryCount)||profile.inventoryCount>=profile.inventorySize))throw Error('Falta espaço na principal para receber a skin');
    }
  }
  async function consolidate(row,source,destination,send){
    await identify(row,source,destination);
    const profile=await read(source,api=>api.converterProfile());
    if(profile.membership!==row.membership)throw Error('O tipo da conta mudou. Revê as contas.');
    for(const item of row.consolidationPlan.items){
      check();if(row.originalDoneIds.includes(item.id))continue;
      row.stage='inventory';row.message='A converter o inventário revisto em tokens';await publish(row);
      await itemActions.perform(row,source,destination,source,'convert',item);
    }
    check();
    if(row.route==='tokens'){await send(()=>trade(row,source,destination));return;}
    while(true){
      check();
      if(row.remainingItems.length){
        await send(async()=>{
          while(row.remainingItems.length){
            check();const item=row.remainingItems[0];
            if(!row.transferredIds.includes(item.id)){
              await assertSkinTrade(source,destination);row.stage='transfer';row.message='A enviar a skin para a principal';await publish(row);
              await itemActions.perform(row,source,destination,source,'transfer',item);
            }
            check();const found=await locator.locate({...item.ref,accountId:destination.id,storageUnitId:null});
            row.stage='destination-convert';row.message='A converter a skin recebida na principal';await publish(row);
            await itemActions.perform(row,source,destination,destination,'convert',{...item,ref:found.ref});
          }
        });
      }
      check();const available=Math.floor((await read(source,api=>api.converterProfile())).tokens),budget=row.consolidationPlan.maxTokens-(row.mintSpent||0),amount=Math.min(100000000,available,budget);
      if(amount<1)break;
      await identify(row,source,destination);await skinRoute.mint(row,source,destination,{...routeContext(),amount});
    }
    row.message='Consolidação concluída. Tokens confirmados na principal.';
  }
  async function execute(sources,destination,capsule,selectedRows=run.rows) {
    for(const row of selectedRows)rowControllers.set(row.operationId,new AbortController());
    let next=0,tradeTail=Promise.resolve();
    async function processRow(row) {
      const source=sources.find(a=>a.id===row.accountId);row.state='running';
      try {
        check();await publish(row);
        const send=async work=>{
          check();row.stage='waiting_trade';row.message='A aguardar a vez de enviar para a principal';await publish(row);
          const pending=tradeTail.then(async()=>{check();try{return await work();}catch(error){if(row.pending||row.tradeId){stopped=true;signal();}throw error;}finally{close(row,source,destination);}});tradeTail=pending.catch(()=>{});return pending;
        };
        if(row.sequencePlan)await sequence.execute(row,source,destination,send);
        if(row.consolidationPlan&&!row.sequencePlan)await consolidate(row,source,destination,send);
        if(!row.sequencePlan&&!row.consolidationPlan&&['full','sell'].includes(run.action))await sell(row,source);
        if(!row.sequencePlan&&!row.consolidationPlan&&['full','buy'].includes(run.action))await buy(row,source,capsule);
        if(!row.sequencePlan&&!row.consolidationPlan&&['full','open'].includes(run.action))await open(row,source);
        if(!row.sequencePlan&&!row.consolidationPlan&&['full','trade'].includes(run.action)) {
          check();row.stage='waiting_trade';row.message='A aguardar a vez de enviar os tokens';await publish(row);
          const send=tradeTail.then(async()=>{
            check();
            try{await trade(row,source,destination);}
            catch(e){if(row.pending||row.tradeId){stopped=true;signal();}throw e;}
            finally{close(row,source,destination);}
          });
          tradeTail=send.catch(()=>{});await send;
        }
        if(!row.sequencePlan){row.state='confirmed';row.verified=true;row.stage='result';if(!row.sentTokens&&!['trade','full'].includes(run.action))row.message='Etapa concluída.';}
      }catch(e){
        await recordLimit(e,source.id);
        const limited=e.status===429,wasStopped=e.stopped||stopped||stoppedOperations.has(row.operationId);
        row.state=row.pending||row.tradeId?'unconfirmed':wasStopped||limited?'stopped':'failed';row.verified=false;
        if(limited)row.retryAt=run.retryAt;
        row.message=limited?(row.state==='unconfirmed'?'O site limitou a leitura de confirmação. O resultado ficou guardado para verificar.':'O site limitou os pedidos. Revê as etapas após a espera.'):String(e.message).slice(0,300);
        if(limited||row.state==='unconfirmed'&&!(wasStopped&&stoppedOperations.has(row.operationId)&&!row.tradeId&&lockedAccountIds(row).every(id=>id===row.accountId))){stopped=true;run.phase='stopping';signal();}
      }
      finally{rowControllers.delete(row.operationId);close(row,source,destination);await publish(row);}
    }
    const results=await Promise.allSettled(Array.from({length:Math.min(50,sources.length)},async()=>{
      try{while(!stopped&&next<selectedRows.length)await rowContext.run(selectedRows[next++],()=>processRow(rowContext.getStore()));}
      catch(e){stopped=true;signal();throw e;}
    }));
    for(const row of selectedRows)if(row.state==='waiting'){row.state=row.sequencePlan&&run.retryAt>Date.now()?'stopped':'skipped';if(row.state==='stopped')row.retryAt=run.retryAt;row.message=row.state==='stopped'?'Não iniciada: aguarda o limite do site e revê as etapas.':'Conta não processada.';}
    const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;
    run.phase=uncertain()?'blocked':'idle';run.message=uncertain()?'Verifica a operação pendente antes de iniciar outra execução.':run.retryAt>Date.now()?'Execução pausada pelo limite do site. As etapas e os resultados estão guardados.':stopped?'Execução parada.':run.rows.some(r=>r.state==='paused')?'Etapas concluídas. Há itens guardados para continuar.':'Execução concluída.';await publish();
  }
  async function start(config) {
    if(starting||task||reviews.size)throw Error('O conversor já está em execução.');starting=true;stopped=false;
    try {
      await ready();checkCooldown();if(config?.action!=='sequence'&&uncertain())throw Error('Existe uma operação por confirmar. Verifica-a primeiro.');
      if(config?.action==='sequence'){
        if(!sequenceReview||!itemActions)throw Error('Sequências não disponíveis');
        const scope=sequenceReview.previewScope?.(config.previewId);
        preparationController=new AbortController();preparingAccounts.clear();for(const id of scope?.accountIds||[])preparingAccounts.add(id);
        preparation={kind:'revalidation',completed:0,total:scope?.accountIds?.length||0};emitStatus();
        let plan;
        try{plan=await sequenceReview.consume(config.previewId);check();}finally{preparation=null;preparationController=null;preparingAccounts.clear();emitStatus();}
        const continuing=plan.config.resumeOperationIds.length>0,repeating=plan.config.independent||plan.config.repeatOperationIds.length>0;
        assertContinuationScope({...plan.config,destinationAccountId:plan.destination?.accountId},plan);
        if(!continuing&&!repeating&&(hasKnownItems()||hasLegacyItems()))throw Error('Recupera a execução anterior');
        const known=await listAccounts(),byId=new Map(known.map(a=>[a.id,a])),sources=plan.rows.map(r=>byId.get(r.accountId)),destination=plan.destination?byId.get(plan.destination.accountId):null;
        if(sources.some(a=>!a)||plan.destination&&!destination)throw Error('Conta não encontrada');await canStart([...sources,...(destination?[destination]:[])].map(a=>a.id));check();
        if(repeating&&plan.config.repeatOperationIds.length){
          const repeated=plan.config.repeatOperationIds.map(id=>run.rows.find(row=>row.operationId===id));
          if(repeated.some(row=>!row||!canRepeatRow(row)))throw Error('Resolve os resultados antes de repetir.');
          if(typeof store.archive!=='function')throw Error('O arquivo local do conversor não está disponível.');
          await store.archive(structuredClone({...run,version:1,archiveId:randomUUID(),archivedAt:new Date().toISOString(),rows:repeated}));
          check();
        }
        const rollbackRun=structuredClone(run);
        const selectedRows=plan.rows.map(p=>{
          const prior=p.resumeOperationId?run.rows.find(row=>row.operationId===p.resumeOperationId):null;
          const rebased=p.repeatOperationId?run.rows.find(row=>row.operationId===p.repeatOperationId):null;
          const row=prior||{operationId:randomUUID(),accountId:p.accountId,sourceLabel:p.label,sourceIdentity:p.sourceIdentity,sold:0,bought:0,opened:0,converted:0,sentTokens:0,receivedTokens:0,originalConverted:0,mintedItems:0,convertedToMoney:0,originalDoneIds:[],transferredIds:[],destinationConvertedIds:[],remainingItems:[],remainingSkinIds:[],childOperations:[],handoffs:[],completedSteps:[],stepProgress:{}};
          row.sequencePlan={version:1,selectedSteps:plan.steps,effectiveSteps:p.effectiveSteps,prerequisites:p.prerequisites,scopes:p.scopes,items:p.items,stickerItems:p.stickerItems,tokenBudget:prior?.sequencePlan?.tokenBudget??Math.floor(p.scopes.tokens)};
          if(!prior){
            row.handoffs=structuredClone(p.carriedHandoffs||[]);row.remainingSkinIds=[...(p.carriedStickerIds||[])];row.remainingItems=structuredClone(p.carriedItems||[]);
            if(rebased){row.destinationAccountId=rebased.destinationAccountId;row.destinationLabel=rebased.destinationLabel;row.destinationIdentity=rebased.destinationIdentity;
              row.history=[...(rebased.history||[]),{operationId:rebased.operationId,steps:rebased.sequencePlan.selectedSteps,completedSteps:rebased.completedSteps||[],sold:rebased.sold||0,bought:rebased.bought||0,opened:rebased.opened||0,updatedAt:rebased.updatedAt}].slice(-20);}
            for(const item of p.transferItems)if(!row.handoffs.some(i=>i.id===item.id))row.handoffs.push({...item,kind:'skin',location:'source'});
          }
          for(const item of p.stickerItems)if(!row.handoffs.some(i=>i.id===item.id))row.handoffs.push({...item,kind:'sticker',location:'source'});
          if(!prior&&p.transferItems.length)row.remainingItems=[...new Map([...row.remainingItems,...p.transferItems].map(item=>[item.id,item])).values()];
          row.membership=p.membership;row.route=p.route;row.destinationAccountId=destination?.id||row.destinationAccountId;row.destinationLabel=destination?.label||row.destinationLabel;row.destinationIdentity=plan.destination?.identity||row.destinationIdentity;
          delete row.verification;delete row.stopRequested;stoppedOperations.delete(row.operationId);delete row.retryAt;row.state='waiting';row.stage='waiting';row.message='A aguardar as etapas escolhidas';row.verified=false;return row;
        });
        run={...run,lastSelection:{steps:[...plan.steps],routing:plan.routing,accountIds:plan.rows.map(r=>r.accountId),destinationAccountId:destination?.id||null},retryAt:0,phase:'running',action:'sequence',destinationAccountId:destination?.id,message:'A executar apenas as etapas revistas',rows:continuing?run.rows.map(row=>selectedRows.find(r=>r.operationId===row.operationId)||row):repeating?[...run.rows.filter(row=>!plan.config.repeatOperationIds.includes(row.operationId)),...selectedRows]:selectedRows};
        if(selectedRows.length>100){run=rollbackRun;throw Error('Seleciona até 100 contas nesta execução. Os resultados anteriores ficam guardados.');}
        try{await publish();}catch(error){run=rollbackRun;throw error;}task=execute(sources,destination,null,selectedRows).catch(async error=>{run.phase='blocked';run.message=String(error.message);await publish();}).finally(()=>{task=null;signal();});return status();
      }
      sequenceReview?.invalidate();
      if(hasKnownItems())throw Error('Há skins identificadas por tratar. Continua a execução anterior.');
      if(config?.action==='consolidate'){
        if(hasLegacyItems())throw Error('Há stickers pendentes na execução anterior. Usa Abrir e converter primeiro.');
        if(!reviewService||!itemActions)throw Error('Consolidação não disponível');
        const plan=await reviewService.consume(config.previewId),known=await listAccounts(),byId=new Map(known.map(a=>[a.id,a])),sources=plan.rows.map(r=>byId.get(r.accountId)),destination=byId.get(plan.destination.accountId);
        if(!destination||sources.some(a=>!a))throw Error('Conta não encontrada');
        await canStart([...sources,destination].map(a=>a.id));check();
        run={phase:'running',action:'consolidate',destinationAccountId:destination.id,message:'A consolidar as contas revistas',rows:plan.rows.map(r=>({operationId:randomUUID(),accountId:r.accountId,sourceLabel:r.label,sourceIdentity:r.sourceIdentity,destinationAccountId:destination.id,destinationLabel:destination.label,destinationIdentity:plan.destination.identity,membership:r.membership,route:r.route,consolidationPlan:{items:r.items,maxTokens:r.maxTokens},state:'waiting',stage:'waiting',message:'A aguardar',sold:0,bought:0,opened:0,converted:0,sentTokens:0,receivedTokens:0,originalConverted:0,mintedItems:0,convertedToMoney:0,originalDoneIds:[],transferredIds:[],destinationConvertedIds:[],remainingItems:[],childOperations:[],verified:false}))};
        await publish();task=execute(sources,destination).finally(()=>{task=null;signal();});task.catch(async e=>{run.phase='blocked';run.message=String(e.message);await publish();}).catch(()=>{});return status();
      }
      if(!config||!ACTIONS.includes(config.action)||!Array.isArray(config.accountIds)||!config.accountIds.length||config.accountIds.length>100||config.accountIds.some(id=>typeof id!=='string')||new Set(config.accountIds).size!==config.accountIds.length)throw Error('Seleciona contas válidas e diferentes.');
      const resumable=new Map(run.rows.filter(row=>row.remainingSkinIds?.length).map(row=>[row.accountId,row]));
      if(resumable.size&&(!['full','open'].includes(config.action)||[...resumable.keys()].some(id=>!config.accountIds.includes(id))))throw Error('Há stickers por converter. Seleciona as contas pendentes e usa Abrir e converter primeiro.');
      for(const row of resumable.values())if(!Array.isArray(row.remainingSkinIds)||row.remainingSkinIds.length>1000||new Set(row.remainingSkinIds).size!==row.remainingSkinIds.length||row.remainingSkinIds.some(id=>typeof id!=='string'||!/^[a-f0-9]{24}$/i.test(id)))throw Error('Registo dos stickers pendentes inválido.');
      const known=await listAccounts(),sources=config.accountIds.map(id=>known.find(a=>a.id===id)),needsTrade=['full','trade'].includes(config.action);
      const destination=needsTrade?known.find(a=>a.id===config.destinationAccountId):null;
      if(sources.some(a=>!a)||needsTrade&&(!destination||sources.some(a=>a.id===destination.id)))throw Error('Seleciona uma conta de destino diferente das origens.');
      await canStart([...sources,...(destination?[destination]:[])].map(a=>a.id));
      const identities=new Map();
      for(const account of [...sources,...(destination?[destination]:[])]){const identity=await transport.identity(account);if([...identities.values()].includes(identity))throw Error('Duas sessões pertencem à mesma conta.');identities.set(account.id,identity);}
      for(const [id,row] of resumable)if(identities.get(id)!==row.sourceIdentity)throw Error('A identidade da conta com stickers pendentes mudou.');
      let capsule;
      if(['full','buy'].includes(config.action))capsule=await read(sources[0],api=>api.converterCapsule());
      for(const source of sources) {
        const profile=await read(source,api=>api.converterProfile());
        if(needsTrade&&profile.membership!=='pro')throw Error('É necessário Pro em '+source.label+' para enviar tokens.');
        if(capsule&&profile.rank<capsule.rankNeeded)throw Error(source.label+' não tem o nível necessário para esta cápsula.');
        if(needsTrade&&(await read(source,api=>api.tradingStatus()))?.isUnlocked!==true)throw Error('Trocas bloqueadas em '+source.label+'.');
      }
      if(destination&&(await read(destination,api=>api.tradingStatus()))?.isUnlocked!==true)throw Error('Trocas bloqueadas na conta de destino.');
      check();run={phase:'running',action:config.action,destinationAccountId:destination?.id,message:'A converter até 50 contas em paralelo. Os envios são feitos um de cada vez.',rows:sources.map(source=>({operationId:randomUUID(),accountId:source.id,sourceLabel:source.label,sourceIdentity:identities.get(source.id),destinationAccountId:destination?.id,destinationLabel:destination?.label,destinationIdentity:identities.get(destination?.id),state:'waiting',stage:'waiting',message:'A aguardar',sold:0,bought:0,opened:resumable.get(source.id)?.opened||0,converted:resumable.get(source.id)?.converted||0,remainingSkinIds:[...(resumable.get(source.id)?.remainingSkinIds||[])],sentTokens:0,verified:false}))};
      await publish();task=execute(sources,destination,capsule).catch(async e=>{run.phase='blocked';run.message=String(e.message);for(const row of run.rows)if(row.state==='running')row.state='unconfirmed';await publish();}).finally(()=>{task=null;signal();});return status();
    }catch(error){await recordLimit(error);throw error;}finally{starting=false;}
  }
  async function stopAccount(id){
    if(typeof id!=='string'||!id||id.length>100)throw Error('Operação inválida');stoppedOperations.add(id);rowControllers.get(id)?.abort();inspectionController?.abort();invalidateReadiness();await ready();
    const row=run.rows.find(row=>row.operationId===id);if(!row)throw Error('Conta desta execução não encontrada');
    if(preparation&&preparingAccounts.has(row.accountId)){stopped=true;preparationController?.abort();sequenceReview?.invalidate();}
    row.stopRequested=true;
    if(['paused','stopped','waiting'].includes(row.state))row.state='stopped';
    row.message=row.pending?'Parada. O pedido já enviado fica guardado para verificar.':row.state==='running'?'A parar esta conta antes da próxima ação.':'Parada. Escolhe as etapas da próxima execução.';
    signal();await publish(row);return status();
  }
  async function stop(){
    stopped=true;preparationController?.abort();inspectionController?.abort();invalidateReadiness();for(const controller of rowControllers.values())controller.abort();await ready();sequenceReview?.invalidate();reviewService?.invalidate();
    for(const row of run.rows)if(['running','waiting','paused','stopped','unconfirmed'].includes(row.state)){stoppedOperations.add(row.operationId);row.stopRequested=true;if(['waiting','paused'].includes(row.state))row.state='stopped';}
    run.phase=task?'stopping':uncertain()?'blocked':'idle';run.message='Paragem pedida. Escolhe as etapas quando as ações em curso terminarem.';signal();await publish();return status();
  }
  async function clear(){
    await ready();if(active())throw Error('Aguarda o fim da execução antes de limpar.');starting=true;
    const previous=run;
    try{
      const archived=[],remaining=[];for(const row of run.rows)(canClearRow(row)?archived:remaining).push(row);
      if(!archived.length)throw Error('Não há resultados para limpar. As operações pendentes ficam protegidas.');
      if(typeof store.archive!=='function')throw Error('O arquivo local do conversor não está disponível.');
      await store.archive(structuredClone({...run,version:1,archiveId:randomUUID(),archivedAt:new Date().toISOString(),rows:archived}));
      run={...run,rows:remaining,phase:remaining.some(row=>row.state==='unconfirmed')?'blocked':'idle',message:remaining.length?'Resultados anteriores arquivados. As operações pendentes foram preservadas.':'Execução anterior arquivada. Podes preparar uma nova sequência.'};
      await publish();sequenceReview?.invalidate();reviewService?.invalidate();return status();
    }catch(error){run=previous;throw error;}finally{starting=false;}
  }
  async function closeUnresolved(id){
    await ready();if(active())throw Error('Aguarda a operação atual antes de encerrar.');
    const row=run.rows.find(value=>value.operationId===id);if(!row||!canCloseUnresolved(row))throw Error('Verifica os resultados com uma leitura completa antes de encerrar esta operação.');
    starting=true;const previous=structuredClone(run);
    try{
      if(row.pending?.kind==='inventory-child')await itemActions.closeUnresolved(row);
      row.resolution=unresolvedResolution(row);row.state='unresolved';row.verified=false;unresolvedOwners=null;
      row.message='Encerrada sem confirmação. A intenção e os resultados continuam guardados para revisão.';
      run.phase=uncertain()?'blocked':'idle';run.message=requiresUnknownScopeIsolation(row)?'Pendência encerrada sem identificação dos resultados. A conta continua isolada para ações de inventário.':'Pendência encerrada sem confirmar o resultado. Podes rever novas etapas com os dados atuais.';
      await publish(row);sequenceReview?.invalidate();reviewService?.invalidate();return status();
    }catch(error){run=previous;throw error;}finally{starting=false;}
  }
  async function resume(id){
    await ready();checkCooldown();if(active()||uncertain())throw Error('Verifica as operações pendentes antes de continuar');
    const row=run.rows.find(r=>r.operationId===id);if(row?.sequencePlan)throw Error('Revê as próximas etapas antes de continuar');if(!row?.consolidationPlan||row.pending||!['stopped','failed','cancelled'].includes(row.state))throw Error('Esta execução não pode continuar nesta etapa');
    const accounts=await listAccounts(),source=accounts.find(a=>a.id===row.accountId),destination=accounts.find(a=>a.id===row.destinationAccountId);if(!source||!destination)throw Error('Conta não encontrada');
    starting=true;stopped=false;stoppedOperations.delete(id);delete row.stopRequested;try{await canStart([source.id,destination.id]);await identify(row,source,destination);delete row.verification;row.state='waiting';run.phase='running';await publish(row);task=execute([source],destination,undefined,[row]).finally(()=>{task=null;signal();});task.catch(async e=>{run.phase='blocked';run.message=String(e.message);await publish();}).catch(()=>{});return status();}finally{starting=false;}
  }
  async function review(id,work,{verification=false}={}) {
    await ready();if(reviews.has(id))return reviews.get(id);if(active())throw Error('Aguarda a paragem do conversor.');
    const row=run.rows.find(r=>r.operationId===id);if(!row||row.state!=='unconfirmed'&&!(verification&&isClosedUnresolved(row)))throw Error('Operação pendente não encontrada.');
    const job=(async()=>{let source,destination,errorStatus,failed=false;try{
      if(verification){row.verification={phase:'running',stage:'account',attempt:(row.verification?.attempt||0)+1,startedAt:new Date().toISOString()};await publish(row);}else delete row.verification;
      const accounts=await listAccounts();source=accounts.find(a=>a.id===row.accountId);destination=accounts.find(a=>a.id===row.destinationAccountId);
      if(!source||row.destinationAccountId&&!destination)throw Error('Conta não encontrada.');checkCooldown();await identify(row,source,destination);await work(row,source,destination);delete row.retryAt;
    }catch(e){failed=true;errorStatus=Number(e.status)||0;await recordLimit(e,source?.id);if(e.status===429)row.retryAt=run.retryAt;row.message=String(e.message).slice(0,300);}finally{
      if(source)close(row,source,destination);run.phase=uncertain()?'blocked':'idle';if(run.phase==='idle')run.message=run.retryAt>Date.now()?'Aguarda o limite do site antes de rever as próximas etapas.':'Resultados verificados. Revê as próximas etapas antes de continuar.';
      if(verification){row.verification={...row.verification,phase:'complete',outcome:['unconfirmed','unresolved'].includes(row.state)?'pending':failed?'failed':'confirmed',finishedAt:new Date().toISOString(),message:row.message,errorStatus:errorStatus||0};verificationEmittedAt.delete(id);}
      await publish(row);
    }return status();})();reviews.set(id,job);try{return await job;}finally{reviews.delete(id);}
  }
  async function verifyCancellation(row,source) {
    const latest=await read(source,api=>api.tradingStatus()),balance=await read(source,api=>api.balance());
    if(!Array.isArray(latest.activeUserTrades)||!Array.isArray(latest.finishedUserTrades))throw Error('Cancelamento por confirmar.');
    const listed=[...latest.activeUserTrades,...latest.finishedUserTrades].find(t=>t._id===row.tradeId);
    if(listed&&(!['cancelled','deleted'].includes(listed.status)||listed.host?.user?.userId!==row.sourceIdentity)||balance.tokens<row.sourceBefore-0.00001)throw Error('Cancelamento e devolução dos tokens por confirmar.');
    row.state='cancelled';row.pending=null;row.verified=true;row.stage='result';row.message='Troca cancelada; tokens devolvidos à origem.';
  }
  async function verify(id){inspectionController?.abort();invalidateReadiness();return review(id,async(row,source,destination)=>{
    if(row.cancelSent&&(!row.pending||['tokens','accept','confirm'].includes(row.pending.kind))){await verifyCancellation(row,source);return;}
    if(row.sequencePlan){
      if(row.pending?.kind?.startsWith('seq-'))await sequence.verifyLocal(row,source);
      else if(row.pending?.kind==='mint'){if(!await skinRoute.verifyMint(row,source,routeContext()))throw Error('A conversão continua na fila do site');}
      else if(row.pending?.kind==='inventory-child')await itemActions.verify(row,source,destination);
      else if(row.tradeId){const snapshot=await transport.refresh(source,row.tradeId);validateOffer(row,snapshot,row.offerTokens,true);await verifyArrival(row,source,destination);return;}
      else if(row.pending)throw Error('A operação ainda precisa de ser identificada');
      row.state='stopped';row.message='Resultado verificado. Revê as próximas etapas.';return;
    }
    if(row.consolidationPlan&&(!row.tradeId||row.route!=='tokens')){
      if(row.pending?.kind==='mint'){if(!await skinRoute.verifyMint(row,source,routeContext()))throw Error('A conversão continua na fila do site');}
      else if(row.pending?.kind==='inventory-child')await itemActions.verify(row,source,destination);
      else if(row.tradeId){const snapshot=await transport.refresh(source,row.tradeId);validateOffer(row,snapshot,row.offerTokens,true);await verifyArrival(row,source,destination);return;}
      row.state='stopped';row.message='Resultado verificado. Podes continuar os passos restantes.';return;
    }
    if(row.tradeId){const s=await observe(row,source,destination),snapshot=await transport.refresh(source,row.tradeId);
      if(snapshot.status==='finished'){validateOffer(row,snapshot,row.offerTokens,true);await verifyArrival(row,source,destination);return;}
      throw Error('A troca ainda está pendente. Podes cancelá-la ou revê-la no jogo.');
    }
    const p=row.pending;if(!p||p.kind==='create')throw Error('Revê a conta no jogo; a resposta não identificou a operação.');
    if(p.kind==='convert'){if((await read(source,api=>api.balance())).tokens<=p.before)throw Error('Conversão por confirmar.');if(row.remainingSkinIds?.[0]===p.id)row.remainingSkinIds.shift();row.converted++;}
    else{const amount=quantity(await read(source,api=>api.converterCases()),p.id),expected=p.kind==='buy'?p.before+p.amount:p.before-p.amount;if(amount!==expected)throw Error('Alteração da quantidade por confirmar.');if(p.kind==='open'&&(!Array.isArray(p.skinIds)||p.skinIds.length!==p.amount||new Set(p.skinIds).size!==p.amount||p.skinIds.some(id=>typeof id!=='string'||!/^[a-f0-9]{24}$/i.test(id))))throw Error('Cápsulas abertas, mas os stickers ainda precisam de ser identificados no inventário.');row[p.kind==='sell'?'sold':p.kind==='buy'?'bought':'opened']+=p.amount;if(p.kind==='open')row.remainingSkinIds=[...p.skinIds];}
    row.pending=null;row.state='stopped';row.message='Etapa verificada. A sequência ficou interrompida; revê os itens no inventário.';
  },{verification:true});}
  async function cancel(id){return review(id,async(row,source,destination)=>{
    if((row.consolidationPlan||row.sequencePlan)&&row.pending?.kind==='inventory-child'){
      try{await itemActions.cancel(row,source,destination);}catch(e){if(row.pending)throw e;}
      row.state='stopped';row.message='Troca cancelada e itens localizados. Podes continuar quando quiseres.';return;
    }
    if(!row.tradeId||row.cancelSent||row.confirmSent)throw Error('Revê esta troca no jogo antes de cancelar.');
    const s=await observe(row,source,destination),snapshot=await transport.refresh(source,row.tradeId);
    if(snapshot.host?.userId!==row.sourceIdentity||snapshot.status==='finished')throw Error('O estado da troca mudou.');
    row.cancelSent=true;await publish(row);
    await transport.command(source,row.tradeId,'delete',undefined,{beforeSend:async()=>{if(await coordinator?.cooldown(source.id)>Date.now())throw Error('Aguarda o limite do jogo.');},guard:()=>{if(s.snapshots.get(source.id)?.status==='finished')throw Error('A troca terminou.');}});
    // Read after the deletion; a queued socket command alone proves nothing.
    await verifyCancellation(row,source);
  });}
  async function acknowledge(id){return review(id,async row=>{if(row.consolidationPlan||row.sequencePlan)throw Error('Usa Verificar estado para recuperar sem descartar itens identificados.');if(row.pending?.kind==='convert'&&row.remainingSkinIds?.length)throw Error('Usa Verificar resultado para confirmar esta conversão antes de retomar os stickers pendentes.');row.state='reviewed';row.pending=null;row.message='Revisto no jogo pelo utilizador. O envio não foi contado como confirmado.';});}
  return {ready,status,inspect,prepare,start,stop,stopAccount,clear,resume,verify,closeUnresolved,cancel,acknowledge,active,dispatchGuard(){const row=rowContext.getStore(),guard=()=>{check(row);checkCooldown();};guard.signal=(row?rowControllers.get(row.operationId):preparationController||inspectionContext.getStore())?.signal;return guard;},checkDispatch(){check(null);checkCooldown();},blocksAccount:id=>active()||run.rows.some(r=>(['unconfirmed','unresolved'].includes(r.state)||r.remainingItems?.length)&&[r.accountId,r.destinationAccountId].includes(id))};
}
module.exports={createTokenConverter};
