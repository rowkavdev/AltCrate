function createProgressionGuard({converterGuard,getService,getBusy}) {
 return function guard(){
  converterGuard();
  if(getBusy()>0||getService()?.hasPending())throw Error('Há uma alteração de progressão em curso ou por confirmar. Para a sequência ou verifica o resultado antes de iniciar outra operação.');
 };
}
function createProgressionEntryGuard({converterGuard,hasOtherWork}) {
 return function guard(){converterGuard();if(hasOtherWork())throw Error('Aguarda o fim da outra operação ou do login antes de confirmar a alteração.');};
}
function createProgressionAccountGuard({getBusy}) {
 return function guard(){if(getBusy()>0)throw Error('Aguarda o fim da alteração de progressão antes de alterar contas ou iniciar sessão.');};
}
module.exports={createProgressionGuard,createProgressionEntryGuard,createProgressionAccountGuard};
