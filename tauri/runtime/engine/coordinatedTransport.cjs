const {responseRateLimit}=require('./rateLimitHeaders.cjs');
function createCoordinatedTransport({requestWork,coordinator,fetchForAccount,now=Date.now}){
 return (account,defaults={})=>{
  const fetcher=async(endpoint,init={})=>{
   const {casepilotPriority=defaults.priority||'user',casepilotBeforeSend,...options}=init;
   const background=casepilotPriority==='background'&&(!options.method||options.method==='GET');
   let sent=false,response;
   try{response=await requestWork.run({accountId:account.id,connectionId:'browser-session',priority:casepilotPriority,...(background?{key:endpoint,expiresAt:now()+30000}:{})},async()=>{
    const retryAt=await coordinator.cooldown(account.id);
    if(retryAt>now())throw Object.assign(Error('Aguarda o limite da API'),{notSent:true,status:429,retryAt});
    if(options.signal?.aborted)throw Object.assign(Error('Pedido cancelado antes do envio'),{notSent:true});
    casepilotBeforeSend?.();
    sent=true;const value=await fetchForAccount(account)(endpoint,options);
    if(value.status===429){const at=now();await coordinator.limit(at+responseRateLimit(value,at).waitMs,account.id);}
    return value;
   });}catch(error){if(!sent)error.notSent=true;throw error;}return background?response.clone():response;
  };
  fetcher.supportsBeforeSend=true;return fetcher;
 };
}
module.exports={createCoordinatedTransport};
