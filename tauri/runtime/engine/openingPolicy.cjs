const ID=/^[a-f0-9]{24}$/i;
const WEAR=/\s*\((?:Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/i;

function canonicalSkinName(value){
 return String(value||'').trim().replace(/^★\s*/,'').replace(/^(?:StatTrak™\s*|Souvenir\s*)+/i,'').replace(WEAR,'').trim().replace(/\s+'[^\r\n]+'$/,'').trim().toLocaleLowerCase('en-US');
}

const CONDITION_KEYS=['floatMin','floatMax','patterns','statTrak','souvenir','eventName','topN'];
function normalizeOpeningRule(rule){
 const name=typeof rule?.name==='string'?rule.name.trim():'';
 if(/\s+'[^\r\n]+'$/.test(name.replace(WEAR,'').trim())&&!rule?.conditions?.patterns?.length)throw Error('Escolhe a variante no catálogo para preservar o padrão da regra');
 if(!name||name.length>130||/[\x00-\x1f]/.test(name)||!['sell','keep','storage'].includes(rule?.action))throw Error('Regra de item inválida');
 const result={name,action:rule.action};
 if(rule.id!==undefined){if(typeof rule.id!=='string'||!rule.id||rule.id.length>80)throw Error('Identificador de regra inválido');result.id=rule.id;}
 if(rule.conditions!==undefined){
  const c=rule.conditions;if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(key=>!CONDITION_KEYS.includes(key)))throw Error('Atributos de regra inválidos');
  const conditions={};
  for(const key of ['floatMin','floatMax'])if(c[key]!==undefined){if(!Number.isFinite(c[key])||c[key]<0||c[key]>1)throw Error('Limite de float inválido');conditions[key]=c[key];}
  if(conditions.floatMin!==undefined&&conditions.floatMax!==undefined&&conditions.floatMin>conditions.floatMax)throw Error('Intervalo de float inválido');
  if(c.patterns!==undefined){if(!Array.isArray(c.patterns)||!c.patterns.length||c.patterns.length>100||c.patterns.some(value=>typeof value!=='string'||!value.trim()||value.length>40||/[\x00-\x1f]/.test(value)))throw Error('Padrões inválidos');conditions.patterns=[...new Set(c.patterns.map(value=>value.trim()))].sort();}
  for(const key of ['statTrak','souvenir'])if(c[key]!==undefined){if(typeof c[key]!=='boolean')throw Error('Variante inválida');conditions[key]=c[key];}
  if(c.eventName!==undefined){if(typeof c.eventName!=='string'||!c.eventName.trim()||c.eventName.length>130||/[\x00-\x1f]/.test(c.eventName))throw Error('Evento inválido');conditions.eventName=c.eventName.trim();}
  if(c.topN!==undefined){if(!Number.isSafeInteger(c.topN)||c.topN<1||c.topN>10000000)throw Error('Top N inválido');conditions.topN=c.topN;}
  if(Object.keys(conditions).length)result.conditions=conditions;
 }
 if(rule.action==='storage'){
  if(typeof rule.destinationAccountId!=='string'||!rule.destinationAccountId||rule.destinationAccountId.length>180||!ID.test(rule.storageUnitId))throw Error('Seleciona um storage válido');
  result.destinationAccountId=rule.destinationAccountId;result.storageUnitId=rule.storageUnitId;
 }
 return result;
}
function validateOpeningRules(input,catalog){
 if(!Array.isArray(input)||input.length>500)throw Error('Regras de abertura inválidas');
 const names=new Set((catalog?.items||[]).flatMap(item=>Array.isArray(item.specialItems)&&item.specialItems.length?item.specialItems.map(special=>canonicalSkinName(special.name)):[canonicalSkinName(item.name)]).filter(Boolean));
 const seen=new Set(),ids=new Set();
 return input.map(value=>{
  const rule=normalizeOpeningRule(value),key=canonicalSkinName(rule.name),signature=key+JSON.stringify(rule.conditions||{});
  if(seen.has(signature)||rule.id&&ids.has(rule.id))throw Error('Regra duplicada para a mesma skin e atributos');seen.add(signature);if(rule.id)ids.add(rule.id);
  if(!names.has(key))throw Error('A skin não consta do catálogo da caixa');return rule;
 });
}
function attributes(item){return {float:Number.isFinite(item?.float)?item.float:null,patternId:typeof item?.patternId==='string'||Number.isSafeInteger(item?.patternId)?String(item.patternId)||null:null,statTrak:typeof item?.statTrak==='boolean'?item.statTrak:null,souvenir:typeof item?.souvenir==='boolean'?item.souvenir:null,eventName:typeof item?.eventName==='string'?item.eventName||null:typeof item?.event?.name==='string'?item.event.name||null:null};}
function itemRankingIdentity(item){return JSON.stringify([String(item?.name||''),attributes(item)]);}
function decideOpeningItem(item,rules,{accountId,ranking}={}){
 const kept=(reasonCode,reason,rule=null,ruleIndex=null)=>({action:'keep',reasonCode,reason,rule,ruleIndex,ruleId:rule?.id||null});
 if(item?.isFavorite===true)return kept('favorite-protected','Favorito protegido; fica no inventário.');
 const values=attributes(item);
 for(let index=0;index<rules.length;index++){
  const rule=rules[index];if(canonicalSkinName(rule.name)!==canonicalSkinName(item?.name))continue;
  const c=rule.conditions||{},checks=[];
  if(c.floatMin!==undefined||c.floatMax!==undefined)checks.push(['float',values.float,number=>number>= (c.floatMin??0)&&number<= (c.floatMax??1)]);
  if(c.patterns)checks.push(['padrão',values.patternId,value=>c.patterns.includes(value)]);
  for(const key of ['statTrak','souvenir'])if(c[key]!==undefined)checks.push([key,values[key],value=>value===c[key]]);
  if(c.eventName!==undefined)checks.push(['evento',values.eventName,value=>value===c.eventName]);
  // A known mismatch makes this rule irrelevant. Missing data cannot fall through to a broader sale.
  if(checks.some(([,value,predicate])=>value!==null&&value!==''&&!predicate(value)))continue;
  const missing=checks.find(([,value])=>value===null||value==='');if(missing)return kept('attribute-missing','Atributo ausente: '+missing[0]+'. Item conservado pela regra '+(index+1)+'.',rule,index);
  if(c.topN!==undefined){
   if(ranking?.state!=='fresh'||ranking.scope!=='lowestFloatBySkingroupRank'||ranking.accountId!==accountId||ranking.itemId!==(item?._id||item?.id)||!Number.isSafeInteger(ranking.rank)||ranking.rank<1)return kept('ranking-unavailable',ranking?.reason||'Ranking individual ausente, obsoleto ou de outro item/conta; item conservado.',rule,index);
   if(ranking.rank>c.topN)continue;
  }
  return {action:rule.action,reasonCode:'rule-matched',reason:'Regra '+(index+1)+' aplicada.',rule,ruleIndex:index,ruleId:rule.id||null};
 }
 return kept('no-rule','Sem regra aplicável; fica no inventário.');
}

function createOpeningPolicy({apiForAccount,inventoryActions,emit=()=>{},itemRanking=null,now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 async function locateOpened(account,ids){
  const wanted=new Set(ids),found=new Map(),api=apiForAccount(account);
  for(let page=1;page<=100&&wanted.size;page++){
   const result=await api.inventoryPage(page);
   if(!Array.isArray(result?.skins)||!Number.isSafeInteger(result.pages))throw Error('Leitura do inventário incompleta');
   for(const item of result.skins){if(wanted.delete(item?._id))found.set(item._id,{item,page});}
   if(page>=result.pages)break;
  }
  if(wanted.size)throw Error('Itens abertos não encontrados no inventário; a conta foi parada');
  return found;
 }
 async function waitForOperation(operation){
  if(operation?.state==='confirmed'&&operation.verified===true)return operation;
  if(!operation?.operationId||!inventoryActions.list||operation.state==='failed')return operation;
  for(let attempt=0;attempt<30;attempt++){
   await sleep(1000);
   const current=(await inventoryActions.list()).find(item=>item.operationId===operation.operationId);
   if(current?.state==='confirmed'||current?.state==='failed')return current;
  }
  return operation;
 }
 async function apply(account,ids,rules,{isStopped=()=>false}={}){
  if(!Array.isArray(ids)||!ids.length||ids.some(value=>!ID.test(value)))throw Error('Abertura sem itens identificáveis; a conta foi parada');
  const found=await locateOpened(account,ids);
  const orderedRules=rules.map(normalizeOpeningRule);
  let handled=0;
  for(const id of new Set(ids)){
   if(isStopped())break;
   const {item,page}=found.get(id);
   const context={accountId:account.id,ranking:itemRanking?await itemRanking.read({accountId:account.id,itemId:id,identity:itemRankingIdentity(item)}):null};
   let decision=decideOpeningItem(item,orderedRules,context),rankingFailure=null;
   if(decision.reasonCode==='ranking-unavailable'&&itemRanking?.refresh&&!isStopped()){
    try{context.ranking=await itemRanking.refresh({accountId:account.id,itemId:id,identity:itemRankingIdentity(item)});}
    catch(error){rankingFailure=error;context.ranking={state:'unavailable',reason:'Consulta do ranking falhou; item conservado. '+String(error.message||'Falha de leitura').slice(0,300)};}
    decision=decideOpeningItem(item,orderedRules,context);
   }
   const rule=decision.rule;
   const report=(value,extra={})=>emit({type:'opening-item',accountId:account.id,skinId:id,skinName:String(item.name||'').slice(0,130),action:value.action,reasonCode:value.reasonCode,reason:value.reason,ruleIndex:value.ruleIndex,ruleId:value.ruleId,verified:false,at:new Date(now()).toISOString(),...extra});
   if(decision.action==='keep'){report(decision);if((rankingFailure?.status||rankingFailure?.statusCode)===429)throw rankingFailure;continue;}
   if(isStopped()){report({...decision,action:'keep',reasonCode:'stopped',reason:'Abertura parada antes de preparar a ação.'});break;}
   const kind=rule.action==='storage'?'move-to-storage':'sell';
   const request={kind,ref:{accountId:account.id,itemId:id,storageUnitId:null,page,name:item.name},...(kind==='move-to-storage'?{destinationAccountId:rule.destinationAccountId,destinationStorageUnitId:rule.storageUnitId}:{})};
   const preview=await inventoryActions.prepare(request);
   if(preview?.item?.id!==id||preview.item.name!==item.name)throw Error('O item mudou durante a preparação; a conta foi parada');
   const freshContext={accountId:account.id,ranking:itemRanking?await itemRanking.read({accountId:account.id,itemId:id,identity:itemRankingIdentity(preview.item)}):null};
   const reviewed=decideOpeningItem(preview.item,orderedRules,freshContext);
   const requiredChanged=Object.keys(rule.conditions||{}).some(key=>key==='topN'?false:key==='patterns'?attributes(item).patternId!==attributes(preview.item).patternId:key==='eventName'?attributes(item).eventName!==attributes(preview.item).eventName:key==='floatMin'||key==='floatMax'?attributes(item).float!==attributes(preview.item).float:attributes(item)[key]!==attributes(preview.item)[key]);
   if(requiredChanged||reviewed.action!==decision.action||reviewed.ruleIndex!==decision.ruleIndex){report({...decision,action:'keep',reasonCode:'preview-changed',reason:'O favorito ou os atributos mudaram durante a revisão; item conservado.'});continue;}
   if(isStopped()){report({...decision,action:'keep',reasonCode:'stopped',reason:'Abertura parada antes de confirmar a ação.'});break;}
   const result=await inventoryActions.confirm(preview.previewId);
   if(result.reviewRequired)throw Error('O item mudou antes da confirmação; a conta foi parada');
   const operation=await waitForOperation(result.operation);
   if(operation?.state!=='confirmed'||operation.verified!==true)throw Error(operation?.message||'A ação do item ficou por confirmar; a conta foi parada');
   handled++;report(decision,{destinationAccountId:rule.destinationAccountId||null,destinationStorageName:operation.destinationStorageName||'',verified:true});
  }
  return {handled};
 }
 return {apply};
}

module.exports={canonicalSkinName,normalizeOpeningRule,validateOpeningRules,decideOpeningItem,itemRankingIdentity,createOpeningPolicy};
