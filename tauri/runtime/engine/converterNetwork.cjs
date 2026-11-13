const {createCaseApi}=require('./api.cjs');
const {createCoordinatedTransport}=require('./coordinatedTransport.cjs');

function createConverterApiFactory({requestWork,coordinator,network,publicFetcherForAccount,beforeMutation=()=>{},captureMutationGuard=()=>beforeMutation}){
 let retryAt=0;
 // A 429 pauses this converter across its source accounts before queued requests dispatch.
 const limits={
  cooldown:async id=>Math.max(retryAt,await coordinator.cooldown(id)||0),
  limit:async(until,id)=>{retryAt=Math.max(retryAt,until);await coordinator.limit?.(until,id);}
 };
 const fetchForAccount=createCoordinatedTransport({requestWork,coordinator:limits,
  fetchForAccount:account=>(endpoint,init)=>network.fetch(account,endpoint,init)});
 return (account,{beforeSend,priority='user'}={})=>{
  const fetcher=fetchForAccount(account,{priority}),mutationGuard=captureMutationGuard();
  return createCaseApi((endpoint,init={})=>fetcher(endpoint,{...init,...(!init.method||init.method==='GET'?{signal:mutationGuard.signal||init.signal}:{}),casepilotBeforeSend:()=>{if(init.method&&init.method!=='GET')mutationGuard();beforeSend?.();}}),
   publicFetcherForAccount?{publicFetcher:publicFetcherForAccount(account)}:undefined);
 };
}
function createConverterTradeTransport(transport,check,captureGuard=()=>check){
 return {...transport,command:(account,id,kind,item,controls={})=>{
  const guard=captureGuard();
  return transport.command(account,id,kind,item,{
   ...controls,
   beforeSend:async()=>{if(kind!=='delete')guard();await controls.beforeSend?.();},
   guard:()=>{if(kind!=='delete')guard();controls.guard?.();}
  });
 }};
}
module.exports={createConverterApiFactory,createConverterTradeTransport};
