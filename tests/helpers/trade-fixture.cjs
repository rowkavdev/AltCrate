const {EventEmitter}=require('node:events');
const {inventoryFixture,itemId}=require('./inventory-fixture.cjs'),{createTradeTransport}=require('../../electron/tradeTransport.cjs');
async function tradeFixture(t,options={}){
 const f=await inventoryFixture(t,options),sockets=[],commands=[];
 const trade={_id:'c'.repeat(24),status:'active',host:{user:{userId:'source-identity'},hasAccepted:false},guest:null,hostTokens:0,guestTokens:0},items=[];f.state.trade=trade;
 const broadcast=()=>sockets.forEach(s=>queueMicrotask(()=>s.deliver('tradeInfo',structuredClone(trade),structuredClone(items))));
 class ServerSocket extends EventEmitter{
  constructor(opts){super();this.opts=opts;this.connected=false;}deliver(event,...args){super.emit(event,...args);}connect(){this.opts.auth(auth=>{this.accountId=JSON.parse(Buffer.from(auth.token.split('.')[1],'base64url').toString('utf8')).id.replace(/-identity$/,'');this.connected=true;this.deliver('connect');});}disconnect(){this.connected=false;}
  emit(event,arg){commands.push({accountId:this.accountId,event,arg});
   if(event==='watchTrade'){
    if(this.accountId==='destination')trade.guest={user:{userId:options.unexpectedGuest?'other-identity':'destination-identity'},hasAccepted:trade.guest?.hasAccepted||false};
    if(options.changedOffer&&trade.host.hasAccepted&&trade.guest?.hasAccepted)trade.hostTokens=1;
    broadcast();
   }
   if(event==='tradeAddSkins'){items.push({...f.raw,userId:'source-identity'});f.state.inventory=[];broadcast();}
   if(event==='tradeAccept'){(this.accountId==='source'?trade.host:trade.guest).hasAccepted=true;broadcast();}
   if(event==='tradeConfirm'){
    this.confirmed=true;if(sockets.filter(s=>s.confirmed).length===2){trade.status='finished';f.state.destinationInventory=options.missingArrival?[]:[{...f.raw,_id:options.changedId?'d'.repeat(24):itemId}];for(const s of sockets)queueMicrotask(()=>s.deliver('tradeConfirmed',structuredClone(trade),f.state.destinationInventory.map(i=>({...i,userId:'destination-identity'}))));}
   }
   if(event==='tradeDelete'||event==='tradeExit'){trade.status='cancelled';f.state.inventory=[f.raw];items.length=0;broadcast();}
   return true;
  }
 }
 const transport=createTradeTransport({fetchForAccount:f.fetchForAccount,accountQueue:f.deps.accountQueue,ioFactory:(url,opts)=>{const s=new ServerSocket(opts);sockets.push(s);return s;}});t.after(()=>{transport.dispose('source');transport.dispose('destination');});
 return {...f,transport,commands,trade,items};
}
async function result(service,id){for(let i=0;i<200;i++){const r=(await service.list()).find(o=>o.operationId===id);if(r&&r.state!=='running'&&!(r.kind==='move-to-storage'&&r.stage==='arrived'))return r;await new Promise(r=>setTimeout(r,5));}throw Error('Operation did not settle');}
module.exports={tradeFixture,result};
