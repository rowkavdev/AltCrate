const {normalizeSequenceSteps}=require('./converterSequenceSteps.cjs');
// Small read-only observations are shared across selection changes. Final review is always fresh.
function createConverterReadiness({listAccounts,read,readRun,active,now=Date.now}){
 const cache=new Map();
 async function observe(account,key,work,force){
  const id=account.id+':'+key,old=cache.get(id);
  if(old&&(old.pending||!force&&now()-old.at<30000))return old.value;
  const entry={at:now(),pending:true};
  entry.value=read(account,work).then(value=>{entry.pending=false;return value;},error=>{cache.delete(id);throw error;});cache.set(id,entry);
  if(cache.size>400)for(const [k,v] of cache)if(!v.pending&&now()-v.at>=30000)cache.delete(k);
  return entry.value;
 }
 const inspect=async function(input){
  if(!input||!Array.isArray(input.accountIds)||!input.accountIds.length||input.accountIds.length>100||input.accountIds.some(id=>typeof id!=='string'||!id||id.length>200)||new Set(input.accountIds).size!==input.accountIds.length)throw Error('Seleciona contas de origem diferentes');
  const steps=normalizeSequenceSteps(input.steps),run=readRun(),at=now();
  if(active())return {checkedAt:at,issues:[{code:'busy',actions:[],message:'Aguarda a operação atual.'}]};
  if(run.retryAt>at)return {checkedAt:at,issues:[{code:'rate-limit',retryAt:run.retryAt,actions:[],message:'O site limitou os pedidos. Aguarda antes de voltar a verificar.'}]};
  const accounts=new Map((await listAccounts()).map(a=>[a.id,a])),issues=Array(input.accountIds.length);let next=0;
  await Promise.all(Array.from({length:Math.min(4,input.accountIds.length)},async()=>{
   while(!input.signal?.aborted&&next<input.accountIds.length){const index=next++,accountId=input.accountIds[index],account=accounts.get(accountId),found=[];
    if(!account){issues[index]=[{code:'account-missing',accountId,message:'Conta não encontrada.',actions:['accounts']}];continue;}
    const issue=(code,message,actions)=>found.push({code,accountId,label:account.label,message,actions});
    try{
     const profile=steps.some(s=>['open','transfer','convert-received'].includes(s))?await observe(account,'profile',api=>api.converterProfile(),input.force):{};
     if(steps.some(s=>['transfer','convert-received'].includes(s))&&!['pro','basic','free'].includes(profile.membership))issue('membership','O tipo de conta ainda não foi verificado.',['refresh','accounts']);
     if(steps.includes('open')){
      const policy=await observe(account,'policy',api=>api.converterOpeningPolicy(),input.force);
      if(policy.autosellActivated&&policy.autosellAmount>0)issue('autosell','A venda automática do site pode retirar os resultados do inventário.',['preferences','remove-open']);
      const row=run.rows.find(r=>r.accountId===accountId),buffer=(row?.remainingSkinIds?.length||0)>0&&steps.includes('convert-stickers');
      if(Number.isSafeInteger(profile.inventorySize)&&Number.isSafeInteger(profile.inventoryCount)&&profile.inventoryCount>=profile.inventorySize&&!buffer){
       const boxes=await observe(account,'cases',api=>api.converterCases(),input.force);
       let openings=boxes.find(box=>box.id==='64d9ecad463b7ffa9697e2ea')?.amount||0;
       if(steps.includes('buy')){
        const capsule=await observe(account,'capsule',api=>api.converterCapsule(),input.force);let money=profile.money;
        if(steps.includes('sell')&&boxes.some(box=>box.type==='case'&&box.amount>0)){
         const prices=await observe(account,'prices',api=>api.converterCasePrices(),input.force),byId=new Map(prices.map(box=>[box.id,box.price]));
         money+=boxes.filter(box=>box.type==='case').reduce((n,box)=>n+box.amount*(byId.get(box.id)||0),0);
        }
        if(capsule.price>0)openings+=Math.floor(money/capsule.price);
       }
       if(openings>0)issue('inventory-full','O inventário está cheio. Converte os stickers guardados antes de abrir mais cápsulas.',['saved-stickers','remove-open']);
      }
     }
    }catch(error){if(!input.signal?.aborted)issue(error.status===429?'rate-limit':'read-failed',String(error.message||error).slice(0,300),error.status===429?[]:['refresh','accounts']);}
    issues[index]=found;
   }
  }));
  return {checkedAt:at,cancelled:input.signal?.aborted===true,issues:input.signal?.aborted?[]:issues.flat()};
 };
 inspect.invalidate=()=>cache.clear();
 return inspect;
}
module.exports={createConverterReadiness};
