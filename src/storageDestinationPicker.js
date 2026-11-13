export async function loadStorageDestinations(accounts,listStorageUnits,{onUpdate=()=>{},signal,now=Date.now,concurrency=4,cooldown}={}){
 const rows=Array.from({length:accounts.length},()=>[]),errors=[],completedAccountIds=[];
 let next=0,loaded=0,retryAt=null,halted=false;
 const snapshot=()=>({entries:rows.flat(),errors:[...errors],completedAccountIds:[...completedAccountIds],loaded,total:accounts.length,retryAt,loading:!halted&&loaded<accounts.length,cancelled:signal?.aborted===true});
 const shared=await cooldown?.();if(shared>now()){halted=true;retryAt=shared;return snapshot();}
 async function worker(){
  while(!halted&&!signal?.aborted){
   const index=next++;if(index>=accounts.length)return;
   const account=accounts[index];
   try{
    const units=await listStorageUnits(account.id);
    if(signal?.aborted)return;
    if(!Array.isArray(units))throw Error('Resposta inválida dos storages');
    rows[index]=units.filter(unit=>typeof unit?.id==='string'&&unit.id).map(unit=>({accountId:account.id,accountLabel:account.label,storageId:unit.id,storageName:String(unit.name||'Storage sem nome'),count:unit.count??0}));
    completedAccountIds.push(account.id);
   }catch(error){
    if(signal?.aborted)return;
    const message=String(error?.message||error).replace(/^Error invoking remote method '[^']+': Error: /,'');
    errors.push({accountId:account.id,accountLabel:account.label,message});
    if(/HTTP\s*429\b/.test(message)){halted=true;retryAt=now()+300000;}
   }
   loaded++;if(!signal?.aborted)onUpdate(snapshot());
  }
 }
 await Promise.all(Array.from({length:Math.min(Math.max(1,concurrency),accounts.length)},()=>worker()));
 if(retryAt&&cooldown){const latest=await cooldown();if(latest>now())retryAt=latest;}
 return snapshot();
}
export function reviewRequestForFailedDeposit(operation){
 if(operation?.kind!=='move-to-storage'||operation.state!=='failed'||operation.location!=='inventory'||operation.locationAccountId!==operation.destinationAccountId||!operation.item?.id||!operation.destinationStorageUnitId)return null;
 return {kind:'move-to-storage',ref:{accountId:operation.destinationAccountId,itemId:operation.item.id,storageUnitId:null,page:1,name:operation.item.name},destinationAccountId:operation.destinationAccountId,destinationStorageUnitId:operation.destinationStorageUnitId};
}
