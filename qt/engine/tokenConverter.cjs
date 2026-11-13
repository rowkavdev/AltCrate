const {randomUUID}=require('node:crypto');
const {parseRetryAfter}=require('./scheduler.cjs');
const {normalizeTrade}=require('./tradeTransport.cjs');
const CAPSULE_ID='64d9ecad463b7ffa9697e2ea';
const ACTIONS=['full','sell','buy','open','trade'];
const publicFields=['operationId','accountId','sourceLabel','destinationAccountId','destinationLabel','state','stage','message','sold','bought','opened','converted','sentTokens','offerTokens','tradeId','verified','updatedAt'];

function createTokenConverter({listAccounts,apiForAccount,transport,accountQueue,coordinator,store,emit=()=>{},intervalMs=350,waitTimeoutMs=30000,canStart=async()=>{}}) {
  let run={phase:'idle',rows:[]},initialization,task,stopped=false,starting=false,chain=Promise.resolve();
  const listeners=new Set(),sessions=new Map(),reviews=new Map();
  const active=()=>starting||!!task||reviews.size>0||['preparing','running','stopping'].includes(run.phase);
  const uncertain=()=>run.rows.some(row=>row.state==='unconfirmed');
  const status=()=>({...Object.fromEntries(['phase','action','destinationAccountId','message'].map(k=>[k,run[k]])),
    sentTokens:run.rows.reduce((n,r)=>n+(r.state==='confirmed'?r.sentTokens:0),0),
    rows:run.rows.map(row=>({...Object.fromEntries(publicFields.filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]])),pendingStickers:row.remainingSkinIds?.length||0,canCancel:row.state==='unconfirmed'&&!!row.tradeId&&!row.transferConfirmed&&!row.cancelSent&&!row.confirmSent}))});
  function signal(){for(const done of [...listeners])done();}
  async function publish(row) {
    if(row)row.updatedAt=new Date().toISOString();
    const saved=structuredClone({version:1,...run});
    const write=chain.then(()=>store.save(saved));chain=write.catch(()=>{});await write;
    emit({type:'token-converter',at:new Date().toISOString(),status:status(),...(row?{accountId:row.accountId,destinationAccountId:row.destinationAccountId}:{})});
  }
  async function ready() {
    initialization||=(async()=>{
      const saved=await store.load();
      if(saved){if(saved.version!==1||!Array.isArray(saved.rows)||saved.rows.length>100)throw Error('Registo do conversor inválido');run=saved;
        for(const row of run.rows)if(row.state==='running'){row.state='unconfirmed';row.message='Execução interrompida. Verifica o resultado antes de continuar.';}
        run.phase=uncertain()?'blocked':'idle';await publish();
      }
    })();return initialization;
  }
  function check(){if(stopped)throw Object.assign(Error('Execução parada.'),{stopped:true,notSent:true});}
  async function gate(accountId){check();const until=await coordinator?.cooldown(accountId);check();if(until>Date.now())throw Object.assign(Error('Aguarda o limite do jogo antes de continuar.'),{notSent:true});}
  async function read(account,work){return accountQueue.run(account.id,async()=>{if(await coordinator?.cooldown(account.id)>Date.now())throw Error('Aguarda o limite do jogo antes de verificar.');try{return await work(apiForAccount(account));}catch(e){if(e.status===429)await coordinator?.limit(Date.now()+parseRetryAfter(e.retryAfter,Date.now()),account.id);throw e;}});}
  const quantity=(boxes,id)=>boxes.find(box=>box.id===id)?.amount||0;
  async function pause(){check();if(intervalMs>0)await new Promise(resolve=>{const done=()=>{clearTimeout(timer);listeners.delete(done);resolve();},timer=setTimeout(done,intervalMs);listeners.add(done);});check();}
  async function identify(row,source,destination) {
    if(await transport.identity(source)!==row.sourceIdentity||(destination&&await transport.identity(destination)!==row.destinationIdentity))throw Error('A identidade de uma das contas mudou.');
  }
  async function mutate(row,source,pending,work) {
    check();await identify(row,source);await gate(source.id);
    row.pending=pending;await publish(row);
    let result;
    try{result=await accountQueue.run(source.id,async()=>{await gate(source.id);check();return work(apiForAccount(source));});}
    catch(e){if(e.notSent){row.pending=null;await publish(row);}throw e;}
    if(!result.ok){row.pending=null;await publish(row);if(result.status===429)await coordinator?.limit(Date.now()+parseRetryAfter(result.retryAfter,Date.now()),source.id);throw Object.assign(Error(result.message||'HTTP '+result.status),{rejected:true});}
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
  }
  async function trade(row,source,destination) {
    row.stage='trade';row.message='A preparar a troca';await publish(row);
    const a=await read(source,api=>api.converterProfile()),b=await read(destination,api=>api.balance());
    if(a.membership!=='pro')throw Error('É necessário Pro na conta de origem para enviar tokens.');
    row.offerTokens=Math.floor(a.tokens);if(!Number.isSafeInteger(row.offerTokens)||row.offerTokens<0)throw Error('Saldo de tokens inválido.');
    if(!row.offerTokens){row.message='Não há tokens inteiros para enviar.';return;}
    row.sourceBefore=a.tokens;row.destinationBefore=b.tokens;
    await identify(row,source,destination);
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
  async function execute(sources,destination,capsule) {
    let next=0,tradeTail=Promise.resolve();
    async function processRow(row) {
      const source=sources.find(a=>a.id===row.accountId);row.state='running';
      try {
        check();await publish(row);
        if(['full','sell'].includes(run.action))await sell(row,source);
        if(['full','buy'].includes(run.action))await buy(row,source,capsule);
        if(['full','open'].includes(run.action))await open(row,source);
        if(['full','trade'].includes(run.action)) {
          check();row.stage='waiting_trade';row.message='A aguardar a vez de enviar os tokens';await publish(row);
          const send=tradeTail.then(async()=>{
            check();
            try{await trade(row,source,destination);}
            catch(e){if(row.pending||row.tradeId){stopped=true;signal();}throw e;}
            finally{close(row,source,destination);}
          });
          tradeTail=send.catch(()=>{});await send;
        }
        row.state='confirmed';row.verified=true;row.stage='result';if(!row.sentTokens&&!['trade','full'].includes(run.action))row.message='Etapa concluída.';
      }catch(e){row.state=row.pending||row.tradeId?'unconfirmed':e.stopped?'stopped':'failed';row.verified=false;row.message=String(e.message).slice(0,300);if(row.state==='unconfirmed'){stopped=true;run.phase='stopping';signal();}if(e.status===429)await coordinator?.limit(Date.now()+parseRetryAfter(e.retryAfter,Date.now()),source.id);}
      finally{close(row,source,destination);await publish(row);}
    }
    const results=await Promise.allSettled(Array.from({length:Math.min(50,sources.length)},async()=>{
      try{while(!stopped&&next<run.rows.length)await processRow(run.rows[next++]);}
      catch(e){stopped=true;signal();throw e;}
    }));
    for(const row of run.rows)if(row.state==='waiting'){row.state='skipped';row.message='Conta não processada.';}
    const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;
    run.phase=uncertain()?'blocked':'idle';run.message=uncertain()?'Verifica a operação pendente antes de iniciar outra execução.':stopped?'Execução parada.':'Execução concluída.';await publish();
  }
  async function start(config) {
    if(starting||task||reviews.size)throw Error('O conversor já está em execução.');starting=true;stopped=false;
    try {
      await ready();if(uncertain())throw Error('Existe uma operação por confirmar. Verifica-a primeiro.');
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
    }finally{starting=false;}
  }
  async function stop(){stopped=true;if(active()){run.phase='stopping';signal();await publish();}return status();}
  async function review(id,work) {
    await ready();if(reviews.has(id))return reviews.get(id);if(active())throw Error('Aguarda a paragem do conversor.');
    const row=run.rows.find(r=>r.operationId===id);if(!row||row.state!=='unconfirmed')throw Error('Operação pendente não encontrada.');
    const job=(async()=>{let source,destination;try{const accounts=await listAccounts();source=accounts.find(a=>a.id===row.accountId);destination=accounts.find(a=>a.id===row.destinationAccountId);
      if(!source||row.destinationAccountId&&!destination)throw Error('Conta não encontrada.');await identify(row,source,destination);await work(row,source,destination);
    }catch(e){row.message=String(e.message).slice(0,300);}finally{if(source)close(row,source,destination);run.phase=uncertain()?'blocked':'idle';await publish(row);}return status();})();reviews.set(id,job);try{return await job;}finally{reviews.delete(id);}
  }
  async function verifyCancellation(row,source) {
    const latest=await read(source,api=>api.tradingStatus()),balance=await read(source,api=>api.balance());
    if(!Array.isArray(latest.activeUserTrades)||!Array.isArray(latest.finishedUserTrades))throw Error('Cancelamento por confirmar.');
    const listed=[...latest.activeUserTrades,...latest.finishedUserTrades].find(t=>t._id===row.tradeId);
    if(listed&&(!['cancelled','deleted'].includes(listed.status)||listed.host?.user?.userId!==row.sourceIdentity)||balance.tokens<row.sourceBefore-0.00001)throw Error('Cancelamento e devolução dos tokens por confirmar.');
    row.state='cancelled';row.pending=null;row.message='Troca cancelada; tokens devolvidos à origem.';
  }
  async function verify(id){return review(id,async(row,source,destination)=>{
    if(row.cancelSent){await verifyCancellation(row,source);return;}
    if(row.tradeId){const s=await observe(row,source,destination),snapshot=await transport.refresh(source,row.tradeId);
      if(snapshot.status==='finished'){validateOffer(row,snapshot,row.offerTokens,true);await verifyArrival(row,source,destination);return;}
      throw Error('A troca ainda está pendente. Podes cancelá-la ou revê-la no jogo.');
    }
    const p=row.pending;if(!p||p.kind==='create')throw Error('Revê a conta no jogo; a resposta não identificou a operação.');
    if(p.kind==='convert'){if((await read(source,api=>api.balance())).tokens<=p.before)throw Error('Conversão por confirmar.');if(row.remainingSkinIds?.[0]===p.id)row.remainingSkinIds.shift();row.converted++;}
    else{const amount=quantity(await read(source,api=>api.converterCases()),p.id),expected=p.kind==='buy'?p.before+p.amount:p.before-p.amount;if(amount!==expected)throw Error('Alteração da quantidade por confirmar.');if(p.kind==='open'&&(!Array.isArray(p.skinIds)||p.skinIds.length!==p.amount||new Set(p.skinIds).size!==p.amount||p.skinIds.some(id=>typeof id!=='string'||!/^[a-f0-9]{24}$/i.test(id))))throw Error('Cápsulas abertas, mas os stickers ainda precisam de ser identificados no inventário.');row[p.kind==='sell'?'sold':p.kind==='buy'?'bought':'opened']+=p.amount;if(p.kind==='open')row.remainingSkinIds=[...p.skinIds];}
    row.pending=null;row.state='stopped';row.message='Etapa verificada. A sequência ficou interrompida; revê os itens no inventário.';
  });}
  async function cancel(id){return review(id,async(row,source,destination)=>{
    if(!row.tradeId||row.cancelSent||row.confirmSent)throw Error('Revê esta troca no jogo antes de cancelar.');
    const s=await observe(row,source,destination),snapshot=await transport.refresh(source,row.tradeId);
    if(snapshot.host?.userId!==row.sourceIdentity||snapshot.status==='finished')throw Error('O estado da troca mudou.');
    row.cancelSent=true;await publish(row);
    await transport.command(source,row.tradeId,'delete',undefined,{beforeSend:async()=>{if(await coordinator?.cooldown(source.id)>Date.now())throw Error('Aguarda o limite do jogo.');},guard:()=>{if(s.snapshots.get(source.id)?.status==='finished')throw Error('A troca terminou.');}});
    // Read after the deletion; a queued socket command alone proves nothing.
    await verifyCancellation(row,source);
  });}
  async function acknowledge(id){return review(id,async row=>{if(row.pending?.kind==='convert'&&row.remainingSkinIds?.length)throw Error('Usa Verificar resultado para confirmar esta conversão antes de retomar os stickers pendentes.');row.state='reviewed';row.pending=null;row.message='Revisto no jogo pelo utilizador. O envio não foi contado como confirmado.';});}
  return {ready,status,start,stop,verify,cancel,acknowledge,active,blocksAccount:id=>active()||run.rows.some(r=>r.state==='unconfirmed'&&[r.accountId,r.destinationAccountId].includes(id))};
}
module.exports={createTokenConverter};
