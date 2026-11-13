export async function applyModesToAccounts(bridge,ids,modes){
 const appliedIds=[],failures=[];
 const config={case:modes.case===true,money:modes.money===true,vault:modes.vault===true};
 for(const accountId of [...new Set(ids)]){
   try{await bridge.farmSetModes(accountId,config);appliedIds.push(accountId);}
   catch(error){failures.push({accountId,message:String(error.message||error)});}
 }
 return {appliedIds,failures};
}
