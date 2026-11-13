const {randomUUID}=require('node:crypto');
const {validId}=require('./inventoryItemLocator.cjs');
const {normalizeInventoryItem}=require('./inventoryView.cjs');

function protections(item){
 const flags=[];
 if(item.isFavorite)flags.push('favorite');
 if(item.hasPattern||item.patternId||item.patternName)flags.push('pattern');
 if(item.eventName)flags.push('event');
 if(item.stickers?.length||item.charm)flags.push('accessories');
 if(item.quality>0)flags.push('quality');
 if(Object.values(item.floatRanks||{}).some(n=>Number.isSafeInteger(n)&&n<=10))flags.push('rank');
 if(!Number.isFinite(item.price)||item.price<0||item.type==='terminal')flags.push('unpriced');
 return flags;
}
const clone=value=>structuredClone(value);
function createConverterReview({listAccounts,apiForAccount,readInventory,locator,read=(a,work)=>work(apiForAccount(a)),now=Date.now,check=()=>{}}){
 const previews=new Map();let preparing=false;
 function validate(config){
  if(!config||!Array.isArray(config.accountIds)||!config.accountIds.length||config.accountIds.length>100||config.accountIds.some(id=>typeof id!=='string'||!id||id.length>200)||new Set(config.accountIds).size!==config.accountIds.length)throw Error('Seleciona contas de origem diferentes');
  if(typeof config.destinationAccountId!=='string'||config.accountIds.includes(config.destinationAccountId))throw Error('Escolhe uma principal diferente das origens');
  if(config.includeInventory!==undefined&&typeof config.includeInventory!=='boolean')throw Error('Seleção do inventário inválida');
  if(config.protectedItemIds!==undefined&&(!Array.isArray(config.protectedItemIds)||config.protectedItemIds.length>100000||config.protectedItemIds.some(v=>typeof v!=='string'||v.length>240)))throw Error('Seleção dos itens protegidos inválida');
  return {accountIds:[...config.accountIds],destinationAccountId:config.destinationAccountId,includeInventory:config.includeInventory!==false,protectedItemIds:[...new Set(config.protectedItemIds||[])]};
 }
 async function profile(account){
  check();const [value,identity,status]=await Promise.all([read(account,api=>api.converterProfile()),locator.identity(account.id),read(account,api=>api.tradingStatus())]);check();
  if(!['pro','basic','free'].includes(value.membership))throw Error('Tipo de conta por verificar em '+account.label);
  if(!Number.isFinite(value.tokens)||value.tokens<0)throw Error('Saldo inválido em '+account.label);
  if(status?.isUnlocked!==true)throw Error('Trocas bloqueadas em '+account.label);
  if(value.dailyTradesLeft===0)throw Error('Limite diário de trocas atingido em '+account.label);
  return {...value,identity};
 }
 async function inventory(account,expectedCount,budget){
  const all=[],seen=new Set();let pages=null,count=null;
  for(let p=1;p<=(pages||1);p++){
   if(budget.error)throw budget.error;
   check();const body=await readInventory(account.id,p);check();
   if(!Array.isArray(body?.skins)||!Number.isSafeInteger(body.pages)||body.pages<1||body.pages>10000||!Number.isSafeInteger(body.count)||body.count<0)throw Error('Leitura incompleta do inventário de '+account.label);
   if(p===1){pages=body.pages;count=body.count;}else if(body.pages!==pages||body.count!==count)throw Error('O inventário mudou durante a revisão de '+account.label);
   for(const value of body.skins){
    const item=value?.id?clone(value):normalizeInventoryItem(value);
    if(!validId(item.id)||seen.has(item.id))throw Error('IDs repetidos ou inválidos no inventário de '+account.label);
    if(++budget.count>100000)throw Error('A revisão excede 100.000 itens. Revê menos contas de cada vez.');
    seen.add(item.id);all.push({...item,ref:{accountId:account.id,itemId:item.id,page:p,storageUnitId:null,name:item.name||''}});
   }
  }
  if(all.length!==count||Number.isSafeInteger(expectedCount)&&all.length!==expectedCount)throw Error('O inventário mudou ou está incompleto em '+account.label);
  return all;
 }
 function requireSpace(profile,label){if(!Number.isSafeInteger(profile.inventorySize)||!Number.isSafeInteger(profile.inventoryCount))throw Error('Espaço do inventário por verificar em '+label);if(profile.inventorySize<=profile.inventoryCount)throw Error('Inventário cheio: falta espaço em '+label);}
 async function build(config){
  const known=await listAccounts(),byId=new Map(known.map(a=>[a.id,a]));
  const sources=config.accountIds.map(id=>byId.get(id)),destination=byId.get(config.destinationAccountId);
  if(!destination||sources.some(a=>!a))throw Error('Conta de origem ou principal não encontrada');
  const target=await profile(destination),identities=new Set([target.identity]),rows=[],budget={count:0},selected=new Set(config.protectedItemIds);let next=0;
  const mapped=Array(sources.length);
  await Promise.allSettled(Array.from({length:Math.min(4,sources.length)},async()=>{
   try{while(!budget.error&&next<sources.length){const index=next++,source=sources[index],value=await profile(source);check();if(budget.error)return;
    if(identities.has(value.identity))throw Error('Duas sessões pertencem à mesma identidade');identities.add(value.identity);
    const route=value.membership==='pro'?'tokens':'skins';
    const all=config.includeInventory?await inventory(source,value.inventoryCount,budget):[],items=[],excludedItems=[];
    for(const item of all){const flags=protections(item),entry={...item,protection:flags};if(flags.includes('favorite')||flags.includes('unpriced')||flags.length&&!selected.has(source.id+':'+item.id))excludedItems.push(entry);else items.push(entry);}
    if(route==='skins'){requireSpace({...value,inventoryCount:value.inventoryCount-items.length},source.label);requireSpace(target,destination.label);}
    if(await locator.identity(source.id)!==value.identity)throw Error('A identidade mudou durante a revisão');
    const maxTokens=Math.floor(value.tokens+items.reduce((n,item)=>n+item.price*10,0)+1e-7);
    if(!Number.isSafeInteger(maxTokens)||maxTokens<0)throw Error('Montante da revisão inválido');
    mapped[index]={accountId:source.id,label:source.label,sourceIdentity:value.identity,membership:value.membership,route,tokens:value.tokens,inventoryCount:value.inventoryCount,inventorySize:value.inventorySize,dailyTradesLeft:value.dailyTradesLeft,items,excludedItems,maxTokens};
   }}catch(error){budget.error||=error;}
  }));
  if(budget.error)throw budget.error;
  rows.push(...mapped);if(await locator.identity(destination.id)!==target.identity)throw Error('A identidade da principal mudou durante a revisão');
  return {config,rows,destination:{accountId:destination.id,label:destination.label,identity:target.identity,membership:target.membership,tokens:target.tokens,inventoryCount:target.inventoryCount,inventorySize:target.inventorySize,dailyTradesLeft:target.dailyTradesLeft}};
 }
 const view=entry=>({...clone(entry.preview),rows:entry.rows.map(({sourceIdentity,...row})=>clone(row)),destination:Object.fromEntries(Object.entries(entry.destination).filter(([key])=>key!=='identity'))});
 async function prepare(input){
  if(preparing)throw Error('Já está a preparar uma revisão');preparing=true;
  try{const config=validate(input),entry=await build(config);check();entry.preview={previewId:randomUUID(),expiresAt:now()+300000,includeInventory:config.includeInventory};previews.clear();previews.set(entry.preview.previewId,entry);return view(entry);}finally{preparing=false;}
 }
 async function consume(id){
  const entry=previews.get(id);if(!entry||entry.preview.expiresAt<=now())throw Error('A revisão expirou. Revê novamente as contas.');
  const current=await build(entry.config);check();
  for(let i=0;i<entry.rows.length;i++){
   const before=entry.rows[i],after=current.rows[i];
   if(before.sourceIdentity!==after.sourceIdentity||before.membership!==after.membership||Math.floor(after.tokens)>Math.floor(before.tokens)||after.maxTokens>before.maxTokens)throw Error('A conta mudou. É necessária nova revisão.');
   const items=new Map(after.items.map(item=>[item.id,JSON.stringify(item)]));
   if(before.items.length!==after.items.length||before.items.some(item=>items.get(item.id)!==JSON.stringify(item)))throw Error('O inventário mudou. É necessária nova revisão.');
  }
  if(entry.destination.identity!==current.destination.identity||entry.preview.expiresAt<=now())throw Error('A principal mudou ou a revisão expirou');
  previews.delete(id);return clone({...current,preview:entry.preview});
 }
 return {prepare,consume,invalidate:()=>previews.clear()};
}
module.exports={createConverterReview,protections};
