function assertOpeningPolicy(policy,label,accountId){
 if(policy.autosellActivated&&policy.autosellAmount>0){
  const message='A venda automática do site está ativa em '+label+'. Revê e desativa essa preferência no jogo antes de abrir para o inventário.';
  throw Object.assign(Error(message),accountId?{converterIssue:{code:'autosell',accountId,label,message}}:{});
 }
}
function inventoryRoom(profile){
 if(!Number.isSafeInteger(profile.inventorySize)||profile.inventorySize<0||!Number.isSafeInteger(profile.inventoryCount)||profile.inventoryCount<0)throw Error('Capacidade do inventário por confirmar antes de abrir cápsulas');
 return Math.max(0,profile.inventorySize-profile.inventoryCount);
}
module.exports={assertOpeningPolicy,inventoryRoom};
