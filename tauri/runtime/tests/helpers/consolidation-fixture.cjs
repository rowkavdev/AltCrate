const {EventEmitter}=require('node:events');
const {createCaseApi}=require('../../engine/api.cjs'),{createItemLocator}=require('../../engine/inventoryItemLocator.cjs'),{createInventoryReader}=require('../../engine/inventoryView.cjs'),{createAccountQueue}=require('../../engine/accountQueue.cjs'),{createTradeTransport}=require('../../engine/tradeTransport.cjs'),{createInventoryActions}=require('../../engine/inventoryActions.cjs'),{createInventoryTransfers}=require('../../engine/inventoryTransfers.cjs'),{createTokenConverter}=require('../../engine/tokenConverter.cjs');
const originalId='a'.repeat(24),mainId='b'.repeat(24);
async function consolidationFixture(t,options={}){
 const accounts=[{id:'source',label:'Origem'},{id:'destination',label:'Principal'}],stock={source:options.noItems?[]:[{_id:originalId,name:'Skin original',price:10,isFavorite:false}],destination:[{_id:mainId,name:'Coleção da principal',price:500,isFavorite:true}]};
 const me={source:{tokens:options.tokens??200,money:options.money??0,membership:options.pro?'pro':'free'},destination:{tokens:50,money:0,membership:'free'}};
 const defaults={favoriteLowFloats:true,favoriteHighFloats:true,favoriteCustomFloats:false,favoritePatterns:true,customLowFloat:0.01,customHighFloat:0.99,customSelectedFloats:[0.2],patternBlacklist:['Keep'],futureSiteSetting:{keep:true}};
 const openingPolicies={source:{...structuredClone(defaults),autosellActivated:options.autosell===true,autosellAmount:options.autosellAmount??500,autosellVariant:'money'},destination:{...structuredClone(defaults),autosellActivated:false,autosellAmount:0,autosellVariant:'money'}};
 const capsuleId='64d9ecad463b7ffa9697e2ea',caseId='635346787db930593e69cd6d',caseStock={source:[{_id:caseId,type:'case',amount:options.cases??0},{_id:capsuleId,type:'capsule',amount:options.capsules??0}],destination:[]};
 const requests=[],commands=[],sockets=[],records=new Map(),jobs={},results={};let serial=0,saved=null,trade=null,offered=[];
 const response=(body,status=200)=>new Response(JSON.stringify(body),{status});
 const broadcast=(event='tradeInfo')=>sockets.filter(s=>s.connected).forEach(s=>queueMicrotask(()=>s.deliver(event,structuredClone(trade),structuredClone(offered))));
 const fetchForAccount=a=>async(path,init={})=>{
  const method=init.method||'GET',body=init.body?JSON.parse(init.body):null;requests.push({accountId:a.id,path,method,body});
  if(path==='/api/auth/token')return response({token:'h.'+Buffer.from(JSON.stringify({id:a.id+'-identity'})).toString('base64url')+'.s'});
  const intercepted=await options.beforeRequest?.({accountId:a.id,path,method,body,me,stock,caseStock});if(intercepted instanceof Response)return intercepted;
  if(path==='/api/me')return response({...me[a.id],rank:{id:18},caseOpenCount:2,maxCaseOpenMultiplier:3,inventoryCount:stock[a.id].length,inventorySize:options.inventorySize??100,dailyTradesLeft:100,tradeItems:6});
  if(path==='/api/user/autoOpen/config'){if(method==='PUT'){openingPolicies[a.id]=structuredClone(body.config);return response({});}return response({config:openingPolicies[a.id],activePresetId:'preset-'+a.id});}
  if(path==='/api/cases/cases')return response([{_id:caseId,price:70}]);
  if(path==='/cases/capsules/atlanta-2017-legends-holo-foil')return new Response('<script id="__NEXT_DATA__">'+JSON.stringify({props:{pageProps:{caseProp:JSON.stringify({_id:capsuleId,type:'capsule',price:100,rankNeeded:11})}}})+'</script>');
  if(path==='/api/cases'){
   if(method==='GET')return response(caseStock[a.id]);
   const item=caseStock[a.id].find(i=>i._id===body.id);
   if(method==='DELETE'){item.amount-=body.amount;me[a.id].money+=body.amount*70;}
   else {item.amount+=body.amount;me[a.id].money-=body.amount*100;}
   if(options.lostBuy&&method==='POST')throw Error('Resposta da compra perdida');
   return response({});
  }
  if(path==='/api/open/capsule'){
   const amount=body.count*body.caseOpenMultiplier;caseStock[a.id].find(i=>i._id===capsuleId).amount-=amount;
   const drops=Array.from({length:amount},()=>({_id:(++serial).toString(16).padStart(24,'0'),name:'Sticker obtido',price:10,isFavorite:false}));
   const kept=options.enforceCapacity?drops.slice(0,Math.max(0,(options.inventorySize??100)-stock[a.id].length)):drops;
   stock[a.id].push(...kept);me[a.id].money+=(drops.length-kept.length)*10;
   return response(drops);
  }
  if(path.startsWith('/api/inventory?')){const page=Number(new URL(path,'https://fixture.invalid').searchParams.get('page'))||1;return response({skins:stock[a.id].slice((page-1)*100,page*100),pages:Math.max(1,Math.ceil(stock[a.id].length/100)),count:stock[a.id].length});}
  if(path==='/api/queues/status')return response({jobs:jobs[a.id]?{'tokens-to-skins':jobs[a.id]}:{}});
  if(path==='/api/casino/tokensToSkins'){
   if(method==='GET')return response({skins:results[a.id]||[]});
   me[a.id].tokens-=body.tokens;const item={_id:(++serial).toString(16).padStart(24,'0'),name:'Skin consolidada',price:body.tokens/10,isFavorite:false};stock[a.id].push(item);results[a.id]=[item];jobs[a.id]={state:'done',tokens:body.tokens,created:1,value:item.price,convertedToMoney:0,jobId:'job-'+serial};
   if(options.lostMint)throw Error('Resposta perdida');return response({},202);
  }
  if(path==='/api/casino/skinToTokens'){
   const index=stock[a.id].findIndex(i=>i._id===body.id);if(index<0)return response({error:'missing'},400);
   me[a.id].tokens+=stock[a.id][index].price*10;stock[a.id].splice(index,1);
   if(options.stopAfterOriginal&&body.id===originalId)await service.stop();
   return response({});
  }
  if(path==='/api/trading'){
   if(method==='GET')return response({isUnlocked:true,activeUserTrades:trade?.status==='active'?[trade]:[],finishedUserTrades:trade?.status==='finished'?[trade]:[]});
   trade={_id:(900+(++serial)).toString(16).padStart(24,'0'),status:'active',host:{user:{userId:a.id+'-identity'},hasAccepted:false},guest:null,hostTokens:0,guestTokens:0};offered=[];return response({_id:trade._id});
  }
  throw Error('Unexpected '+method+' '+path);
 };
 class Socket extends EventEmitter{
  constructor(opts){super();this.opts=opts;this.connected=false;this.confirmed=false;}deliver(e,...args){super.emit(e,...args);}connect(){this.opts.auth(auth=>{this.accountId=JSON.parse(Buffer.from(auth.token.split('.')[1],'base64url').toString()).id.replace('-identity','');this.connected=true;this.deliver('connect');});}disconnect(){this.connected=false;}
  emit(event,payload){commands.push({accountId:this.accountId,event,payload});
   if(event==='watchTrade'){if(this.accountId==='destination')trade.guest={user:{userId:options.unexpectedGuest?'stranger':this.accountId+'-identity'},hasAccepted:trade.guest?.hasAccepted||false};broadcast();}
   if(event==='tradeAddSkins'){for(const id of payload.skinIds){const at=stock.source.findIndex(i=>i._id===id);offered.push({...stock.source[at],userId:'source-identity'});stock.source.splice(at,1);}broadcast();}
   if(event==='tradeAddTokens'){me.source.tokens-=payload.tokens;trade.hostTokens=payload.tokens;broadcast();}
   if(event==='tradeAccept'){(this.accountId==='source'?trade.host:trade.guest).hasAccepted=true;broadcast();}
   if(event==='tradeConfirm'){this.confirmed=true;if(sockets.filter(s=>s.connected&&s.confirmed).length===2){trade.status='finished';if(!options.missingArrival){stock.destination.push(...offered.map(({userId,...item})=>item));me.destination.tokens+=trade.hostTokens;}broadcast('tradeConfirmed');}}
   if(event==='tradeDelete'){trade.status='cancelled';stock.source.push(...offered.map(({userId,...item})=>item));offered=[];broadcast();}
   return true;
  }
 }
 const queue=createAccountQueue(),transport=createTradeTransport({fetchForAccount,accountQueue:queue,ioFactory:(_,opts)=>{const socket=new Socket(opts);sockets.push(socket);return socket;}}),listAccounts=async()=>accounts;
 const apiForAccount=options.coordinated?require('../../engine/converterNetwork.cjs').createConverterApiFactory({requestWork:require('../../engine/requestCoordinator.cjs').createRequestCoordinator(),coordinator:{cooldown:async()=>0},network:{fetch:(account,path,init)=>fetchForAccount(account)(path,init)},beforeMutation:()=>service.checkDispatch()}):a=>createCaseApi(fetchForAccount(a));
 const locator=createItemLocator({listAccounts,fetchForAccount,accountQueue:queue}),readInventory=createInventoryReader({listAccounts,fetchForAccount});
 const store={load:async()=>{},list:async()=>[...records.values()].map(r=>structuredClone(r)),get:async id=>structuredClone(records.get(id)),put:async r=>{records.set(r.operationId,structuredClone(r));}};
 const inventoryDeps={listAccounts,apiForAccount,locator,accountQueue:queue,store};
 const transfers=createInventoryTransfers({...inventoryDeps,transport});const actions=createInventoryActions({...inventoryDeps,transferService:transfers});
 const deps={listAccounts,apiForAccount,transport,accountQueue:queue,locator,readInventory,inventoryActions:actions,operationStore:store,store:{load:async()=>structuredClone(saved),save:async value=>{saved=structuredClone(value);}},intervalMs:0,waitTimeoutMs:60,consolidationPollMs:1,queuePollMs:0};
 const service=createTokenConverter(deps);t.after(()=>accounts.forEach(a=>transport.dispose(a.id)));
 return {service,deps,me,stock,caseStock,openingPolicies,requests,commands,records,saved:()=>saved,originalId,mainId};
}
async function settled(service){for(let i=0;i<2000;i++){if(!service.active())return service.status();await new Promise(r=>setTimeout(r,2));}throw Error('Converter did not settle');}
module.exports={consolidationFixture,settled};
