const {parseRetryAfter}=require('./scheduler.cjs');
function createCoordinatedTransport({requestWork,coordinator,fetchForAccount,now=Date.now}){
 return (account,defaults={})=>{
  const fetcher=async(endpoint,init={})=>{
   const {casepilotPriority=defaults.priority||'user',casepilotBeforeSend,...options}=init;
   const background=casepilotPriority==='background'&&(!options.method||options.method==='GET');
   let sent=false,response;
   try{response=await requestWork.run({accountId:account.id,connectionId:'browser-session',priority:casepilotPriority,...(background?{key:endpoint,expiresAt:now()+30000}:{})},async()=>{
    if(await coordinator.cooldown(account.id)>now())throw Object.assign(Error('Aguarda o limite da API'),{notSent:true});
    if(options.signal?.aborted)throw Object.assign(Error('Pedido cancelado antes do envio'),{notSent:true});
    casepilotBeforeSend?.();
    sent=true;const value=await fetchForAccount(account)(endpoint,options);
    if(value.status===429)await coordinator.limit(now()+parseRetryAfter(value.headers?.get?.('Retry-After'),now()),account.id);
    return value;
   });}catch(error){if(!sent)error.notSent=true;throw error;}return background?response.clone():response;
  };
  fetcher.supportsBeforeSend=true;return fetcher;
 };
}
module.exports={createCoordinatedTransport};
