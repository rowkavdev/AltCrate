const fs=require('node:fs/promises');const fsSync=require('node:fs');const path=require('node:path');const net=require('node:net');
const {createFarmOrchestrator}=require('./farmOrchestrator.cjs');const {createClickCoordinator}=require('./clickCoordinator.cjs');const {createAccountQueue}=require('./accountQueue.cjs');const {createAccountSnapshots}=require('./accountSnapshots.cjs');const {createCaseApi}=require('./api.cjs');const {createServerTransport}=require('./serverFarmTransport.cjs');const {createServerLedger}=require('./serverFarmLedger.cjs');
const {createServerRoutes,withRouteBudgets}=require('./serverFarmRoutes.cjs');const {isIP}=require('node:net');
const {checkGameRoutes,RECOVERABLE,recoveryDelay}=require('./serverFarmHealth.cjs');
const {createRequestCoordinator}=require('./requestCoordinator.cjs');
const FARM_WORKERS=8;
function createWorkerSnapshots(options){return createAccountSnapshots({...options,maxConcurrent:FARM_WORKERS});}
function validateAccounts(accounts){
 if(!Array.isArray(accounts)||accounts.length<1||accounts.length>51||new Set(accounts.map(a=>a.id)).size!==accounts.length)throw Error('Contas inválidas');
 for(const a of accounts)if(typeof a.id!=='string'||!/^[a-zA-Z0-9-]{1,128}$/.test(a.id)||typeof a.label!=='string'||(a.sourceAddress!==undefined&&!isIP(a.sourceAddress))||!Array.isArray(a.cookies)||!a.cookies.length||a.cookies.some(c=>!['case-clicker.com','.case-clicker.com'].includes(c.domain)||typeof c.value!=='string'))throw Error('Sessão de conta inválida');
}
async function createServerWorker({directory,apiFactory,now=Date.now,networkProbe}){
 await fs.mkdir(directory,{recursive:true,mode:0o700});const ledger=createServerLedger(directory,{now});await ledger.ready();
 const read=async(name,fallback)=>{try{return JSON.parse(await fs.readFile(path.join(directory,name),'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
 let saves=Promise.resolve();function save(name,value){const json=JSON.stringify(value);const job=saves.catch(()=>{}).then(async()=>{const file=path.join(directory,name),tmp=file+'.tmp';await fs.writeFile(tmp,json,{mode:0o600});await fs.rename(tmp,file);});saves=job;return job;}
 const store=name=>({load:()=>read(name,{}),save:value=>save(name,value)});
 const routes=await createServerRoutes({directory});
 let readPaused=false,readEpoch=0;const uiReads=new Map(),uiReadQueue=createRequestCoordinator({maxInFlight:4,maxPending:4,perConnection:4});
 let importPending=false,lastImport=await read('last-import.json',{});
 async function commitImport(bundle){
  importPending=true;
  for(const [name,value] of Object.entries(bundle.files))await save(name,value);
  if(bundle.ledger)ledger.restore(bundle.ledger);
  await save('desired.json',{active:false,selected:[]});
  lastImport={id:bundle.transferId};await save('last-import.json',lastImport);
  await fs.rm(path.join(directory,'pending-import.json'),{force:true});importPending=false;
 }
 const pendingImport=await read('pending-import.json',null);if(pendingImport)await commitImport(pendingImport);
 let accounts=routes.assign(await read('sessions.json',[])),desired=await read('desired.json',{active:false,selected:[]}),observations=await read('observations.json',{}),farm,runPromise,queue,coordinator,snapshots;let recoveryPromise=null,closed=false,lastNetworkCheck=null,networkCheckPromise=null;const recoveryAttempts=new Map();const transports=new Map(),apis=new Map(),networkRetries=new Map(Object.entries(await read('network-retries.json',{})));
 function apiFor(account){if(!apis.has(account.id)){if(apiFactory)apis.set(account.id,apiFactory(account));else{const transport=createServerTransport({account,saveCookies:()=>save('sessions.json',accounts)});transports.set(account.id,transport);apis.set(account.id,createCaseApi(transport.fetch));}}return apis.get(account.id);}
 function emit(event){if(event.snapshot)observations[event.accountId]=event.snapshot;if(event.type==='needs-login'&&observations[event.accountId])observations[event.accountId]={...observations[event.accountId],error:'Sessão expirada; inicia sessão de novo.'};if(['request','vault','account-error','needs-login','cooldown','farm-started','farm-finished'].includes(event.type))ledger.record(event);
  if(event.type==='account-error'&&event.paused&&event.errorCategory==='network'&&RECOVERABLE.has(event.errorCode)){networkRetries.set(event.accountId,now()+recoveryDelay(event.accountId,recoveryAttempts.get(event.accountId)||0));save('network-retries.json',Object.fromEntries(networkRetries)).catch(()=>{});}
  if(event.type==='needs-login'&&networkRetries.delete(event.accountId))save('network-retries.json',Object.fromEntries(networkRetries)).catch(()=>{});
  if(event.type==='request'&&event.httpStatus===200){recoveryAttempts.delete(event.accountId);if(networkRetries.delete(event.accountId))save('network-retries.json',Object.fromEntries(networkRetries)).catch(()=>{});}
 }
 async function initialize(){readEpoch++;for(const transport of transports.values())transport.close();transports.clear();apis.clear();queue=createAccountQueue();coordinator=withRouteBudgets({coordinator:createClickCoordinator({store:store('rate-state.json')}),routeCoordinator:createClickCoordinator({store:store('route-state.json')}),routeFor:id=>accounts.find(a=>a.id===id)?.routeId||'direct',accountIds:()=>accounts.map(a=>a.id)});
  const limitGroup=(until,id)=>coordinator.limitAccounts(until,[id]);snapshots=createWorkerSnapshots({apiForAccount:apiFor,coordinator,limitGroup});
  farm=createFarmOrchestrator({accounts,apiForAccount:apiFor,emit,coordinator,accountQueue:queue,snapshots,stateStore:store('farm-state.json'),maxInFlight:FARM_WORKERS,accountClickLimits:true,smoothClicks:true,alignCaseClicks:true,steadyCaseClicks:true,limitGroup});await farm.ready();
 }
 function checkNetwork(){if(!networkCheckPromise)networkCheckPromise=checkGameRoutes(routes.capabilities(),{accounts,probe:networkProbe}).then(value=>{lastNetworkCheck=value;return {networkCheck:value};}).finally(()=>{networkCheckPromise=null;});return networkCheckPromise;}
 function status(){const raw=farm.status();return {...raw,observations,accounts:raw.accounts.map(a=>({...a,results:ledger.results(a.id),performance:ledger.performance(a.id),networkRetryAt:networkRetries.get(a.id)||0})),server:{pid:process.pid,updatedAt:now(),selected:desired.selected,lastImportId:lastImport.id,importPending},network:{connections:routes.capabilities().length,lastCheck:lastNetworkCheck}};}
 function startRun(){if(runPromise)return;runPromise=farm.start(desired.selected);runPromise.catch(()=>{ledger.record({type:'account-error',at:new Date(now()).toISOString(),message:'Execução interrompida; verificação necessária.'});}).finally(()=>{runPromise=null;});}
 async function drain(){farm.stop();if(runPromise)await runPromise;await save('observations.json',observations);await saves;ledger.flush();}
 async function uiSnapshot(id){
  if(closed||readPaused||importPending)throw Error('Aguarda a transferência de contas antes de atualizar.');
  const account=accounts.find(a=>a.id===id);if(!account)throw Error('Conta não encontrada');
  if(uiReads.has(id))return uiReads.get(id);const epoch=readEpoch;
  const task=uiReadQueue.run({accountId:id,connectionId:account.routeId,priority:'user'},async()=>{
   if(closed||readPaused||epoch!==readEpoch)throw Error('A leitura foi cancelada para preservar a transferência.');
   const snapshot=await queue.run(id,()=>snapshots.read(account,{fresh:true}));
   if(epoch!==readEpoch)throw Error('As sessões mudaram durante a leitura. Atualiza novamente.');
   observations[id]=snapshot;return {snapshot};
  });
  uiReads.set(id,task);try{return await task;}finally{if(uiReads.get(id)===task)uiReads.delete(id);}
 }
 async function readBarrier(work){readPaused=true;try{await Promise.allSettled([...uiReads.values()]);return await work();}finally{if(!closed)readPaused=false;}}
 await initialize();if(desired.active&&desired.selected.length)startRun();
 let controlTail=Promise.resolve();async function handle(request){
  if(!request||typeof request.op!=='string')throw Error('Pedido inválido');
  if(request.op==='capabilities')return {protocolVersion:1,maxAccounts:51,workerVersion:'0.3.19',features:{networkCheck:true,performance:true,readIsolation:true},routes:routes.capabilities()};
  if(request.op==='network-check')return checkNetwork();
  if(request.op==='status')return {status:status(),events:ledger.events(Number(request.after)||0)};
  if(importPending)throw Error('Transferência incompleta; reinicia o serviço antes de continuar');
  if(request.op==='export-state'){
   if(desired.active||runPromise)throw Error('Para o farm antes de transferir o estado');await drain();
   return {accounts:structuredClone(accounts),farmState:await read('farm-state.json',{}),rateState:await read('rate-state.json',{}),routeState:await read('route-state.json',{}),networkRetries:Object.fromEntries(networkRetries),observations:structuredClone(observations),ledger:ledger.export(),selected:[...desired.selected]};
  }
  if(request.op==='snapshot')return uiSnapshot(request.id);
  if(request.op==='import'){
   if(desired.active||runPromise)throw Error('Para o farm do servidor antes de renovar as sessões');validateAccounts(request.payload?.accounts);const incoming=routes.assign(request.payload.accounts);
   const failures=[];let next=0;const validationApis=new Map();async function check(){while(next<incoming.length){const account=incoming[next++];let transport;
    try{const api=apiFactory?apiFactory(account):(transport=createServerTransport({account}),createCaseApi(transport.fetch));const snapshot=await api.snapshot();validationApis.set(account.id,snapshot);}catch{failures.push(account.label);}finally{transport?.close();}
   }}await Promise.all([check(),check()]);if(failures.length)throw Error(failures.length+' sessões não responderam no servidor. Não foi iniciado o farm.');
   const transferId=request.payload.transferId;if(transferId!==undefined&&(typeof transferId!=='string'||!/^[a-zA-Z0-9-]{1,128}$/.test(transferId)))throw Error('Identificador de transferência inválido');
   if(request.payload.ledger){const temporary=createServerLedger(path.join(directory,'import-validation'));await fs.mkdir(path.join(directory,'import-validation'),{recursive:true,mode:0o700});try{temporary.restore(request.payload.ledger);}finally{await fs.rm(path.join(directory,'import-validation'),{recursive:true,force:true});}}
   const bundle={transferId,ledger:request.payload.ledger,files:{'observations.json':Object.fromEntries(validationApis),'sessions.json':incoming,'rate-state.json':request.payload.rateState||{},'route-state.json':routes.inheritBudgets(incoming,request.payload.rateState,request.payload.routeState,request.payload.sourceRouteIds),'farm-state.json':request.payload.farmState||{},'network-retries.json':Object.fromEntries(Object.entries(request.payload.networkRetries||{}).filter(([id,until])=>incoming.some(a=>a.id===id)&&Number.isFinite(until)&&until>=0))}};
   await save('pending-import.json',bundle);await commitImport(bundle);accounts=incoming;observations=bundle.files['observations.json'];networkRetries.clear();for(const [id,until] of Object.entries(bundle.files['network-retries.json']))networkRetries.set(id,until);desired={active:false,selected:[]};await initialize();return {validated:validationApis.size,status:status()};
  }
  if(request.op==='start'){
   if(!Array.isArray(request.accountIds)||!request.accountIds.length||new Set(request.accountIds).size!==request.accountIds.length||request.accountIds.some(id=>!accounts.some(a=>a.id===id)))throw Error('Seleciona contas válidas');
   if(runPromise||desired.active)throw Error('A automação já está ativa no servidor');desired={active:true,selected:request.accountIds};await save('desired.json',desired);startRun();return {status:status()};
  }
  if(request.op==='stop'){desired.active=false;await save('desired.json',desired);await drain();return {status:status()};}
  if(['pause','resume','modes'].includes(request.op)){if(!accounts.some(a=>a.id===request.id))throw Error('Conta não encontrada');networkRetries.delete(request.id);recoveryAttempts.delete(request.id);await save('network-retries.json',Object.fromEntries(networkRetries));await (request.op==='modes'?farm.setModes(request.id,request.modes):farm[request.op](request.id));return {status:status()};}
  throw Error('Operação não suportada');
 }
 function serial(work){const next=controlTail.catch(()=>{}).then(work);controlTail=next;return next;}
 async function maintenanceWork(){
  if(closed||!desired.active)return;
  await save('observations.json',observations);
  const due=[...networkRetries].filter(([id,at])=>at<=now()&&desired.selected.includes(id)).slice(0,2);
  await Promise.all(due.map(async([id,at])=>{
   const account=accounts.find(a=>a.id===id),entry=farm.status().accounts.find(a=>a.id===id);
   if(!account||!entry?.paused||entry.needsLogin){networkRetries.delete(id);return;}
   const cooldown=await coordinator.cooldown(id);
   if(cooldown>now()){networkRetries.set(id,cooldown+recoveryDelay(id)%10000);return;}
   let snapshot,error;
   try{snapshot=await queue.run(id,()=>snapshots.read(account,{fresh:true}));}catch(e){error=e;}
   await serial(async()=>{
    // A stop, explicit pause/resume or mode change invalidates this recovery.
    if(closed||!desired.active||networkRetries.get(id)!==at)return;
    if(!error){observations[id]=snapshot;networkRetries.delete(id);await farm.resume(id);}
    else if(error.status===429||error.code==='FARM_COOLDOWN'){networkRetries.set(id,Math.max(now()+300000,await coordinator.cooldown(id)));}
    else if(RECOVERABLE.has(error.code)){const attempt=(recoveryAttempts.get(id)||0)+1;recoveryAttempts.set(id,attempt);networkRetries.set(id,now()+recoveryDelay(id,attempt));}
    else {networkRetries.delete(id);observations[id]={...observations[id],error:error.status===401||error.status===403?'Sessão expirada; inicia sessão de novo.':'A ligação precisa de verificação manual.'};}
    await save('network-retries.json',Object.fromEntries(networkRetries));
   });
  }));
  await serial(async()=>{await save('network-retries.json',Object.fromEntries(networkRetries));if(!closed&&desired.active&&!runPromise&&desired.selected.length&&farm.status().accounts.some(a=>a.selected&&!a.paused&&!a.needsLogin))startRun();});
 }
 function maintain(){if(closed||!desired.active)return Promise.resolve();if(recoveryPromise)return recoveryPromise;recoveryPromise=maintenanceWork().finally(()=>{recoveryPromise=null;});return recoveryPromise;}
 const maintenance=setInterval(()=>maintain().catch(()=>{}),5000);maintenance.unref();
 return {request(data){if(closed)return Promise.reject(Error('O worker está a parar'));if(data?.op==='snapshot')return uiSnapshot(data.id);if(['network-check','status','capabilities'].includes(data?.op))return handle(data);const work=()=>['import','export-state'].includes(data?.op)?readBarrier(()=>handle(data)):handle(data);const next=controlTail.catch(()=>{}).then(work);controlTail=next;return next;},status,maintain,async close(){closed=true;readPaused=true;clearInterval(maintenance);await Promise.allSettled([...uiReads.values()]);await recoveryPromise;await drain();for(const t of transports.values())t.close();}};
}
async function main(){const directory=process.env.CASEPILOT_SERVER_DATA||'/var/lib/casepilot-farm';const worker=await createServerWorker({directory});const socket=path.join(directory,'control.sock');await fs.rm(socket,{force:true});
 const server=net.createServer(client=>{let text='';client.setTimeout(90000,()=>client.destroy());client.on('data',chunk=>{text+=chunk;if(text.length>4*1024*1024){client.destroy();return;}if(text.includes('\n')){client.pause();let request;try{request=JSON.parse(text.split('\n')[0]);}catch{client.end('{"error":"Pedido inválido"}\n');return;}
  worker.request(request).then(reply=>client.end(JSON.stringify(reply)+'\n'),()=>client.end('{"error":"Pedido ao farm recusado ou sessão indisponível"}\n'));
 }});client.on('error',()=>{});});await new Promise(r=>server.listen(socket,r));await fs.chmod(socket,0o600);
 let shutting=false;for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{if(shutting)return;shutting=true;server.close();await worker.close();process.exit(0);});console.log('CasePilot server worker ready; private control only.');
}
if(require.main===module)main().catch(()=>{console.error('CasePilot server startup failed; inspect private state files.');process.exit(1);});
module.exports={createServerWorker,validateAccounts,createWorkerSnapshots};
