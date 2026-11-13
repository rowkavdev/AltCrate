const {randomUUID}=require('node:crypto');
const {identityFromToken}=require('./sessionIdentity.cjs');
const {createAccountQueue}=require('./accountQueue.cjs');
const {parseRetryAfter}=require('./scheduler.cjs');
const data=require('./progressionData.cjs');
const PRESETS=require('./skillPresets.json');
const {summarizePresets}=require('./skillPresetSummary.cjs');
const {missionStep,passStep,missionObserved,passObserved,claimRequest}=require('./missionPassClaims.cjs');
const {MAP_NAMES,CONFIG_FIELDS,object,number,skillId}=data;
const PREVIEW_TTL=300000;
function createProgressionService({listAccounts,fetchForAccount,accountQueue,coordinator,emit=()=>{},now=Date.now,mutationGuard,requestTimeoutMs=15000,store,siteOpeningEnabled=()=>true}={}){
 if(typeof listAccounts!=='function'||typeof fetchForAccount!=='function')throw TypeError('Contas e transporte obrigatórios');
 if(!Number.isSafeInteger(requestTimeoutMs)||requestTimeoutMs<1||requestTimeoutMs>60000)throw TypeError('Prazo de transporte inválido');accountQueue||=createAccountQueue();
 const previews=new Map(),confirmations=new Map(),operations=new Map(),accountOperations=new Map(),observations=new Map(),confirmingAccounts=new Map(),stopRequests=new Set();
 let saveTail=Promise.resolve();
 async function checkpoint(){
  if(!store)return;
  const value={version:1,operations:structuredClone([...operations.values()].filter(r=>['running','unconfirmed'].includes(r.state)).concat([...operations.values()].filter(r=>!['running','unconfirmed'].includes(r.state)).slice(-1000)))};
  const task=saveTail.catch(()=>{}).then(()=>store.save(value));saveTail=task;await task;
 }
 async function ready(){
  const saved=await store?.load();if(!saved)return;
  if(saved.version!==1||!Array.isArray(saved.operations))throw Error('Registo de progressão inválido');
  for(const row of saved.operations){
   if(!row||typeof row.operationId!=='string'||typeof row.accountId!=='string'||!Array.isArray(row.steps))throw Error('Operação de progressão inválida');
   const r=structuredClone(row);
   if(r.state==='running'){r.state=r.pendingStep?'unconfirmed':'stopped';r.verified=false;r.stopped=true;r.message=r.pendingStep?'Pedido interrompido. Verifica o resultado antes de continuar.':'Sequência interrompida antes do próximo envio.';}
   operations.set(r.operationId,r);const current=operations.get(accountOperations.get(r.accountId));if(!current||['running','unconfirmed'].includes(r.state)||!['running','unconfirmed'].includes(current.state))accountOperations.set(r.accountId,r.operationId);
  }
 }
 const presetReads=new Map();
 const readAt=()=>new Date(now()).toISOString();
 const copy=value=>structuredClone(value);
 function requireSiteOpening(){if(siteOpeningEnabled()!==true)throw Object.assign(Error('Ativa Preferências de abertura nas Definições para usar esta página.'),{notSent:true});}
 function publish(r){r.updatedAt=readAt();emit({type:'progression',at:r.updatedAt,...view(r)});return view(r);}
 function view(r){return {operationId:r.operationId,accountId:r.accountId,kind:r.kind,state:r.state,completed:r.completed,total:r.total,verified:r.verified,message:r.message,updatedAt:r.updatedAt,...(r.httpStatus?{httpStatus:r.httpStatus}:{})};}
 function pending(accountId){return [...operations.values()].find(op=>op.accountId===accountId&&['running','unconfirmed'].includes(op.state))||null;}
 async function context(accountId){
  if(typeof accountId!=='string'||!accountId||accountId.length>128)throw Error('Conta inválida');const account=(await listAccounts()).find(a=>a.id===accountId);if(!account)throw Error('Conta não encontrada');
  const fetcher=await fetchForAccount(account);if(typeof fetcher!=='function')throw Error('Sessão indisponível');return {accountId,account,fetcher};
 }
 async function request(ctx,path,{method='GET',body,html=false,beforeSend}={}){
  if((await coordinator?.cooldown(ctx.accountId)||0)>now())throw Object.assign(Error('Aguarda o limite da API'),{notSent:true});
  if(beforeSend)beforeSend();
  const controller=new AbortController();let timer,sent=!ctx.fetcher.supportsBeforeSend;
  const timeout=new Promise((resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Object.assign(Error('Prazo de resposta da progressão excedido'),{notSent:!sent}));},requestTimeoutMs);});
  const work=(async()=>{
   const response=await ctx.fetcher(path,{casepilotBeforeSend:()=>{if(beforeSend)beforeSend();sent=true;},...(ctx.priority?{casepilotPriority:ctx.priority}:{}),method,credentials:'include',cache:'no-store',signal:controller.signal,...(body===undefined?{}:{headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body)})});
   if(response.status===429)await coordinator?.limit(now()+parseRetryAfter(response.headers?.get?.('Retry-After'),now()),ctx.accountId);
   if(!response.ok)throw Object.assign(Error('Progressão: HTTP '+response.status),{status:response.status,rejected:response.status>=400&&response.status<500});
   if(html)return response.text();
   if(method!=='GET')return {status:response.status}; // State read-back, rather than a response body, proves a mutation.
   try{return typeof response.json==='function'?await response.json():JSON.parse(await response.text());}catch{throw Error('Resposta inválida da progressão');}
  })();
  try{return await Promise.race([work,timeout]);}finally{clearTimeout(timer);}
 }
 async function identity(ctx){return identityFromToken(await request(ctx,'/api/auth/token'));}
 async function me(ctx){const value=await request(ctx,'/api/me');if(!object(value))throw Error('Resposta inválida da conta');return value;}
 async function readRewards(ctx){return {accountId:ctx.accountId,tracks:data.normalizeRewards(await request(ctx,'/api/rewards')),readAt:readAt()};}
 async function readMissions(ctx){return data.normalizeMissions(await request(ctx,'/api/missions'),{}).missions;}
 async function readPass(ctx){return data.normalizeMissions([],await request(ctx,'/api/monthlyPass')).pass;}
 async function readSkill(ctx,mapName){
  if(!MAP_NAMES.includes(mapName))throw Error('Mapa inválido');const path='/skillmaps/'+(mapName==='Dust II'?'de_dust_2':encodeURIComponent(mapName));
  const props=data.parsePage(await request(ctx,path,{html:true})),profile=await me(ctx);return {accountId:ctx.accountId,...data.normalizeMap(props,mapName,profile),readAt:readAt()};
 }
 async function presetCatalog(accountId){
  if(presetReads.has(accountId))return presetReads.get(accountId);
  const task=(async()=>{const ctx=await context(accountId),sourceIdentity=await identity(ctx),states=[];for(const name of MAP_NAMES)states.push(await readSkill(ctx,name));const profile=await me(ctx);await assertIdentity(ctx,sourceIdentity);return {accountId,presets:summarizePresets(PRESETS,states,profile),readAt:readAt()};})();
  presetReads.set(accountId,task);try{return await task;}finally{if(presetReads.get(accountId)===task)presetReads.delete(accountId);}
 }
 async function readAuto(ctx){return {accountId:ctx.accountId,...data.normalizeAutoOpen(await request(ctx,'/api/user/autoOpen/config'),await request(ctx,'/api/user/autoOpen/presets')),readAt:readAt()};}
 function validate(kind,payload){
  const allowed={reward:['id'],mission:['id'],pass:['tier','track'],'skill-buy':['mapName','skillId'],'skill-sell':['mapName','skillId'],'skill-preset':['presetId','reset'],autoopen:['config','activePresetId']};
  if(!allowed[kind]||!object(payload)||Object.keys(payload).some(key=>!allowed[kind].includes(key)))throw Error('Ação ou campo não permitido');
  if(kind==='reward'){if(number(payload.id)===null||payload.id<0)throw Error('ID de recompensa inválido');return {id:payload.id};}
  if(kind==='mission'){if(typeof payload.id!=='string'||! /^[A-Za-z0-9_-]{1,120}$/.test(payload.id))throw Error('ID de missão inválido');return {id:payload.id};}
  if(kind==='pass'){if(!Number.isSafeInteger(payload.tier)||payload.tier<1||payload.tier>500||!['free','premium'].includes(payload.track))throw Error('Escalão ou faixa do passe inválidos');return {tier:payload.tier,track:payload.track};}
  if(kind==='skill-buy'||kind==='skill-sell'){if(!MAP_NAMES.includes(payload.mapName)||!skillId(payload.skillId))throw Error('Mapa ou skill inválida');return {mapName:payload.mapName,skillId:payload.skillId};}
  if(kind==='skill-preset'){if(!PRESETS.some(p=>p.id===payload.presetId)||payload.reset!==undefined&&typeof payload.reset!=='boolean')throw Error('Preset inválido');if(payload.presetId==='sellMap'&&payload.reset!==true)throw Error('A reposição exige confirmação explícita');return {presetId:payload.presetId,reset:payload.reset===true};}
  const config=data.normalizeConfig(payload.config,{strict:true});if(payload.activePresetId!==undefined&&payload.activePresetId!==null&&(typeof payload.activePresetId!=='string'||payload.activePresetId.length>100))throw Error('Preset ativo inválido');return {config,...(payload.activePresetId===undefined?{}:{activePresetId:payload.activePresetId})};
 }
 function resources(state){if(number(state.money)===null||state.money<0||!Number.isSafeInteger(state.skillPoints)||state.skillPoints<0||state.rank===null)throw Error('Saldo, pontos ou nível indisponíveis');}
 function rankCheck(state){if(!state.map.rankRequirementOptional&&(state.map.requiredRankId===null||state.rank<state.map.requiredRankId))throw Error('Requisito de nível não satisfeito ou indisponível');if(state.map.requiredPremierId!==null&&state.map.requiredPremierId!==undefined&&(state.premierRank===null||state.premierRank<state.map.requiredPremierId))throw Error('Requisito de Premier não satisfeito ou indisponível');}
 function skillStep(kind,state,node){return {kind,mapName:state.map.name,skillId:node.id,name:node.name,cost:kind==='skill-buy'?node.cost:0,refund:kind==='skill-sell'?node.cost/2:0,pointCost:kind==='skill-buy'?1:-1,rewards:copy(node.rewards),requiredPrevSkillId:node.requiredPrevSkillId,nextSkillIds:copy(node.nextSkillIds),liveCost:node.cost};}
 function dependencyCheck(kind,state,node){
  const owned=new Set(state.ownedIds);
  if(kind==='skill-buy'){if(owned.has(node.id))throw Error('Skill já possuída');if(node.requiredPrevSkillId&&!owned.has(node.requiredPrevSkillId))throw Error('Dependência em falta');rankCheck(state);if(state.skillPoints<1)throw Error('Pontos insuficientes');if(state.money<node.cost)throw Error('Saldo insuficiente');}
  else{if(!owned.has(node.id))throw Error('Skill já não possuída');if(state.map.skills.some(s=>s.requiredPrevSkillId===node.id&&owned.has(s.id))||node.nextSkillIds.some(id=>owned.has(id)))throw Error('Dependências possuídas: vende as skills filhas primeiro');}
 }
 async function plan(ctx,kind,payload){
  const result={accountId:ctx.accountId,kind,title:'',steps:[],cost:0,refund:0,pointCost:0,changes:[],warnings:[]};let baseline;
  if(kind==='reward'){
   const rewards=await readRewards(ctx),track=rewards.tracks.find(t=>t.id===payload.id);if(!track||!track.eligible)throw Error('Recompensa não elegível nesta conta');
   result.title='Receber recompensa: '+track.title;result.steps=[{kind,id:track.id,key:track.key}];result.changes=[{field:track.title,label:'Recompensa',before:null,after:track.description}];baseline=track;
  }else if(kind==='mission'){
   const step=missionStep(await readMissions(ctx),payload.id,now());
   result.title='Recolher missão: '+step.name;result.steps=[step];result.changes=[{field:'passPoints',label:'Pontos no passe mensal',before:null,after:step.passPoints}];baseline=step;
  }else if(kind==='pass'){
   const step=passStep(await readPass(ctx),payload.tier,payload.track,now());
   result.title='Recolher passe: '+step.name;result.steps=[step];result.changes=[{field:'reward',label:'Recompensa',before:null,after:step.description}];baseline=step;
  }else if(kind==='autoopen'){
   requireSiteOpening();
   const current=await readAuto(ctx),activePresetId=Object.hasOwn(payload,'activePresetId')?payload.activePresetId:current.activePresetId;
   if(activePresetId!==null&&activePresetId!==current.activePresetId&&!current.presets.some(p=>p.id===activePresetId))throw Error('Preset indisponível nesta conta');
   result.title='Guardar preferências de abertura';result.changes=data.differences(current.config,payload.config);if(activePresetId!==current.activePresetId)result.changes.push({field:'activePresetId',before:current.activePresetId,after:activePresetId});
   result.steps=result.changes.length?[{kind,config:copy(payload.config),activePresetId}]:[];result.warnings=['Estas definições pertencem ao site. As regras locais de abertura são independentes.'];baseline={config:current.config,activePresetId:current.activePresetId};
  }else if(kind==='skill-buy'||kind==='skill-sell'){
   const state=await readSkill(ctx,payload.mapName);resources(state);const node=state.map.skills.find(s=>s.id===payload.skillId);if(!node)throw Error('Skill indisponível no mapa atual');dependencyCheck(kind,state,node);
   result.title=(kind==='skill-buy'?'Comprar skill: ':'Vender skill: ')+node.name;result.steps=[skillStep(kind,state,node)];baseline={map:state.map,ownedIds:state.ownedIds};
  }else{
   const preset=PRESETS.find(p=>p.id===payload.presetId),states=[];for(const name of MAP_NAMES)states.push(await readSkill(ctx,name));
   for(const state of states)resources(state);
   // All pages must refer to one coherent live ownership list and resource observation.
   const reference=states[0];if(states.some(s=>JSON.stringify([...s.ownedIds].sort())!==JSON.stringify([...reference.ownedIds].sort())))throw Error('Skills alteradas durante a leitura. Atualiza e revê novamente.');
   const catalog=new Map();for(const state of states)for(const node of state.map.skills){if(catalog.has(node.id))throw Error('Resposta inválida: ID duplicado entre mapas');catalog.set(node.id,{state,node});}
   const owned=new Set(reference.ownedIds),desired=new Set(preset.skillIds);for(const id of [...owned,...desired])if(!catalog.has(id))throw Error('Skill indisponível nos mapas atuais: '+id);
   const depth=(id,path=new Set())=>{if(path.has(id))throw Error('Dependência cíclica');const entry=catalog.get(id);if(!entry)throw Error('Dependência em falta: '+id);if(!entry.node.requiredPrevSkillId)return 0;return 1+depth(entry.node.requiredPrevSkillId,new Set([...path,id]));};
   if(payload.reset){for(const id of [...owned].sort((a,b)=>depth(b)-depth(a))){const {state,node}=catalog.get(id);result.steps.push(skillStep('skill-sell',state,node));}}
   const retained=payload.reset?new Set():new Set(owned),buyIds=[...desired].filter(id=>!retained.has(id)).sort((a,b)=>depth(a)-depth(b));
   for(const id of buyIds){const {state,node}=catalog.get(id);rankCheck(state);if(node.requiredPrevSkillId&&!retained.has(node.requiredPrevSkillId))throw Error('Dependência em falta no preset: '+node.requiredPrevSkillId);retained.add(id);result.steps.push(skillStep('skill-buy',state,node));}
   let money=reference.money,points=reference.skillPoints;for(const step of result.steps){money+=step.refund-step.cost;points-=step.pointCost;if(money<0)throw Error('Saldo insuficiente para o preset');if(points<0)throw Error('Pontos insuficientes para o preset');}
   result.title=payload.reset?'Repor mapas e aplicar: '+preset.name:'Adicionar skills: '+preset.name;result.warnings=['Os presets usam IDs do script; custos e efeitos vêm dos mapas atuais.'];if(payload.reset)result.warnings.push('Reposição explícita: cada venda recupera metade do custo e perde a outra metade.');
   const profile=await me(ctx),summary=summarizePresets([preset],states,profile)[0].summary;
   if(summary?.available){const projected=summary.projection[payload.reset?'reset':'add'],labels={casesPerClick:'Percentagem de caixas por clique',moneyPerClick:'Dinheiro por clique',vaultCapacity:'Capacidade do cofre',vaultMoneyPerMinute:'Geração do cofre por minuto',caseOpenCount:'Máximo de aberturas',maxCaseOpenMultiplier:'Multiplicador de abertura'};result.changes=Object.entries(projected).filter(([field,after])=>Number.isFinite(after)&&Number.isFinite(profile[field])&&Math.abs(after-profile[field])>0.000001).map(([field,after])=>({field,label:'Estimativa: '+labels[field],before:profile[field],after}));result.warnings.push('Os efeitos apresentados são estimativas a partir dos mapas atuais; a sequência confirma as habilidades adquiridas.');}
   baseline=states.map(state=>({map:state.map,ownedIds:state.ownedIds}));
  }
  result.cost=result.steps.reduce((sum,s)=>sum+(s.cost||0),0);result.refund=result.steps.reduce((sum,s)=>sum+(s.refund||0),0);result.pointCost=result.steps.reduce((sum,s)=>sum+(s.pointCost||0),0);result.loss=result.refund;
  return {preview:result,baseline};
 }
 async function prepare(accountId,kind,rawPayload){
  if(pending(accountId))throw Error('Existe uma operação pendente nesta conta. Verifica primeiro.');const payload=validate(kind,rawPayload),ctx=await context(accountId),sourceIdentity=await identity(ctx),planned=await plan(ctx,kind,payload);
  if(await identity(ctx)!==sourceIdentity)throw Error('A sessão mudou durante a revisão');const preview={previewId:randomUUID(),...planned.preview};
  previews.set(preview.previewId,{preview:copy(preview),payload,baseline:copy(planned.baseline),sourceIdentity,expires:now()+PREVIEW_TTL});return copy(preview);
 }
 async function assertIdentity(ctx,expected){if(await identity(ctx)!==expected)throw Error('A identidade da sessão mudou. Abre uma revisão nova.');}
 function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
 async function preflightStep(ctx,r,step){
  await assertIdentity(ctx,r.sourceIdentity);
  if(step.kind==='skill-buy'||step.kind==='skill-sell'){
   const state=await readSkill(ctx,step.mapName);resources(state);const node=state.map.skills.find(s=>s.id===step.skillId);if(!node||!same(skillStep(step.kind,state,node),step))throw Error('A skill foi alterada. Abre uma revisão nova.');dependencyCheck(step.kind,state,node);return state;
  }
  if(step.kind==='reward'){const rewards=await readRewards(ctx),track=rewards.tracks.find(t=>t.key===step.key);if(!track||track.id!==step.id||!track.eligible)throw Error('Recompensa já não elegível');return rewards;}
  if(step.kind==='mission'){const current=missionStep(await readMissions(ctx),step.id,now());if(!same(current,step))throw Error('A missão foi alterada. Abre uma revisão nova.');return current;}
  if(step.kind==='pass'){const current=passStep(await readPass(ctx),step.tier,step.track,now());if(!same(current,step))throw Error('O passe foi alterado. Abre uma revisão nova.');return current;}
  requireSiteOpening();
  const current=await readAuto(ctx);if(!same({config:current.config,activePresetId:current.activePresetId},r.baseline))throw Error('Configuração alterada. Abre uma revisão nova.');return current;
 }
 async function observedStep(ctx,r,step){
  ctx={...ctx,priority:'verification'};
  await assertIdentity(ctx,r.sourceIdentity);
  if(step.kind==='skill-buy'||step.kind==='skill-sell'){const state=await readSkill(ctx,step.mapName);return step.kind==='skill-buy'?state.ownedIds.includes(step.skillId):!state.ownedIds.includes(step.skillId);}
  if(step.kind==='reward'){const rewards=await readRewards(ctx),track=rewards.tracks.find(t=>t.key===step.key);return !!track&&(track.id===null||track.id!==step.id);}
  if(step.kind==='mission')return missionObserved(await readMissions(ctx),step);
  if(step.kind==='pass')return passObserved(await readPass(ctx),step);
  const current=await readAuto(ctx);return same(current.config,step.config)&&current.activePresetId===step.activePresetId;
 }
 async function perform(ctx,r,step){
  await preflightStep(ctx,r,step);if(r.stopped)throw Object.assign(Error('Operação parada antes do envio'),{notSent:true,stopped:true});
  if(typeof mutationGuard==='function'&&await mutationGuard(ctx.accountId,step.kind)===false)throw Object.assign(Error('Outra operação está ativa nesta conta'),{notSent:true});
  await assertIdentity(ctx,r.sourceIdentity);if(r.stopped)throw Object.assign(Error('Operação parada antes do envio'),{notSent:true,stopped:true});
  if((await coordinator?.cooldown(ctx.accountId)||0)>now())throw Object.assign(Error('Aguarda o limite da API'),{notSent:true});
  r.pendingStep=copy(step);r.verified=false;r.message='A enviar a ação revista…';await checkpoint();publish(r);
  let result;
  const target=claimRequest(step)||{path:step.kind==='reward'?'/api/rewards':step.kind==='autoopen'?'/api/user/autoOpen/config':'/api/skill',method:step.kind==='skill-sell'?'DELETE':step.kind==='autoopen'?'PUT':'POST',body:step.kind==='reward'?{id:step.id}:step.kind==='autoopen'?{config:step.config,activePresetId:step.activePresetId}:{mapName:step.mapName,skillId:step.skillId}};
  try{result=await request(ctx,target.path,{method:target.method,body:target.body,beforeSend:()=>{if(step.kind==='autoopen')requireSiteOpening();if((step.kind==='mission'&&Date.parse(step.validTill)<=now())||(step.kind==='pass'&&Date.parse(step.endsAt)<=now()))throw Object.assign(Error('A recompensa expirou. Atualiza e revê novamente.'),{notSent:true});if(r.completed===0&&r.previewExpires<now())throw Object.assign(Error('A revisão expirou. Abre novamente.'),{notSent:true});if(r.stopped)throw Object.assign(Error('Operação parada antes do envio'),{notSent:true,stopped:true});}});}catch(error){if(error.notSent||error.rejected)r.pendingStep=null;throw error;}
  r.httpStatus=result.status;
  if(!await observedStep(ctx,r,step))throw Error('Estado da ação por confirmar');r.pendingStep=null;r.completed++;r.verified=true;r.message='Ação confirmada pelo estado atual';await checkpoint();publish(r);
 }
 async function confirm(previewId,{operationId}={}){
  if(typeof previewId!=='string')throw Error('Revisão inválida');if(confirmations.has(previewId))return confirmations.get(previewId);
  const entry=previews.get(previewId);if(!entry||entry.expires<now())throw Error('A revisão expirou. Abre novamente.');
  const accountId=entry.preview.accountId;confirmingAccounts.set(accountId,(confirmingAccounts.get(accountId)||0)+1);
  const task=(async()=>{
   const work=async()=>{
    if(entry.expires<now())throw Error('A revisão expirou. Abre novamente.');
    if(pending(entry.preview.accountId))throw Error('Existe uma operação pendente nesta conta');const ctx=await context(entry.preview.accountId);await assertIdentity(ctx,entry.sourceIdentity);
    const fresh=await plan(ctx,entry.preview.kind,entry.payload);if(!same(fresh.baseline,entry.baseline)||!same(fresh.preview.steps,entry.preview.steps))throw Error('O estado foi alterado. Abre uma revisão nova.');
    const r={operationId:operationId||randomUUID(),accountId:ctx.accountId,kind:entry.preview.kind,sourceIdentity:entry.sourceIdentity,baseline:entry.baseline,previewExpires:entry.expires,steps:copy(entry.preview.steps),state:'running',completed:0,total:entry.preview.steps.length,verified:false,message:'A iniciar operação revista',stopped:stopRequests.has(ctx.accountId),pendingStep:null};
    operations.set(r.operationId,r);accountOperations.set(ctx.accountId,r.operationId);previews.delete(previewId);await checkpoint();publish(r);
    try{
     for(const step of r.steps){if(r.stopped)break;await perform(ctx,r,step);}
     r.state=r.stopped&&r.completed<r.total?'stopped':'completed';r.verified=true;r.message=r.state==='stopped'?'Parado. As ações concluídas foram verificadas.':'Operação concluída e verificada';
    }catch(error){r.httpStatus=error.status||r.httpStatus;r.state=r.pendingStep?'unconfirmed':error.stopped?'stopped':'failed';r.verified=false;r.message=r.state==='unconfirmed'?'Resultado por confirmar. A conta está bloqueada para novas ações até verificares.':error.message;}
    await checkpoint();return publish(r);
   };return accountQueue?accountQueue.run(entry.preview.accountId,work):work();
  })();confirmations.set(previewId,task);try{return await task;}catch(error){confirmations.delete(previewId);throw error;}finally{const remaining=(confirmingAccounts.get(accountId)||1)-1;if(remaining)confirmingAccounts.set(accountId,remaining);else{confirmingAccounts.delete(accountId);stopRequests.delete(accountId);}}
 }
 async function verify(operationId){
  const r=operations.get(operationId);if(!r)throw Error('Operação não encontrada');if(r.state!=='unconfirmed')return view(r);
  const work=async()=>{
   if(r.state!=='unconfirmed')return view(r);
   try{const ctx=await context(r.accountId);if(await observedStep(ctx,r,r.pendingStep)){r.completed++;r.pendingStep=null;r.verified=true;r.state=r.completed===r.total?'completed':'stopped';r.message=r.state==='completed'?'Operação verificada no estado atual':'Ação verificada. O restante preset foi parado; abre uma revisão nova para continuar.';}}
   catch{r.message='Verificação indisponível. O resultado continua por confirmar.';}await checkpoint();return publish(r);
  };return accountQueue?accountQueue.run(r.accountId,work):work();
 }
 return {
  ready,
  rewards:async accountId=>readRewards(await context(accountId)),
  missions:async accountId=>{const ctx=await context(accountId);return {accountId,missions:await readMissions(ctx),pass:await readPass(ctx),readAt:readAt()};},
  skills:async(accountId,mapName)=>readSkill(await context(accountId),mapName),
  presets:()=>copy(PRESETS),presetCatalog,autoOpen:async accountId=>{requireSiteOpening();return readAuto(await context(accountId));},prepare,confirm,verify,
  hasPending(){return [...operations.values()].some(r=>['running','unconfirmed'].includes(r.state));},
  status(accountId){const r=pending(accountId)||operations.get(accountOperations.get(accountId));return r?view(r):{state:'idle',completed:0,total:0,message:'Sem operação ativa'};},
  stop(accountId){if(confirmingAccounts.has(accountId))stopRequests.add(accountId);const r=operations.get(accountOperations.get(accountId));if(r?.state==='running'){r.stopped=true;r.message='Paragem pedida. A ação em curso será verificada.';publish(r);}return r?view(r):{state:confirmingAccounts.has(accountId)?'stopping':'idle',completed:0,total:0,message:confirmingAccounts.has(accountId)?'Paragem pedida antes da primeira ação':'Sem operação ativa'};},
  async diagnostics(accountId){const ctx=await context(accountId),sourceIdentity=await identity(ctx),profile=await me(ctx),cases=await request(ctx,'/api/cases');await assertIdentity(ctx,sourceIdentity);const after=data.diagnosticFields(profile,cases,readAt()),previous=observations.get(accountId),before=previous?.identity===sourceIdentity?previous.after:null;observations.set(accountId,{identity:sourceIdentity,after:copy(after)});return {accountId,before:copy(before),after,changes:before?data.differences(before,after):[],readAt:after.observedAt};},
 };
}
module.exports={createProgressionService,MAP_NAMES,CONFIG_FIELDS,PREVIEW_TTL};
