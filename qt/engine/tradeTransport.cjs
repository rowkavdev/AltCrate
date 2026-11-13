const {identityFromToken}=require('./sessionIdentity.cjs');
const {io}=require('socket.io-client');
const {validId}=require('./inventoryItemLocator.cjs');
function normalizeTrade(raw,items,previous){
 if(!validId(raw?._id)||!raw.host?.user?.userId)return null;
 const hostId=raw.host.user.userId,guestId=raw.guest?.user?.userId||null;
 if(typeof hostId!=='string'||(guestId!==null&&typeof guestId!=='string'))return null;
 const offer=Array.isArray(items)?items:previous?.items;
 const offerKnown=Array.isArray(offer)&&offer.length<=1000&&offer.every(i=>validId(i?._id)&&[hostId,guestId].includes(i.userId));
 const tokens=[raw.hostTokens,raw.guestTokens];
 const participant=(value,userId,index)=>value?{userId,hasAccepted:value.hasAccepted===true,skinIds:offerKnown?offer.filter(i=>i.userId===userId).map(i=>i._id):[],tokens:typeof tokens[index]==='number'&&Number.isFinite(tokens[index])?tokens[index]:null}:null;
 return {tradeId:raw._id,status:typeof raw.status==='string'?raw.status:'unknown',host:participant(raw.host,hostId,0),guest:participant(raw.guest,guestId,1),offerKnown};
}
function createTradeTransport({fetchForAccount,websocketTransportForAccount,ioFactory=io,accountQueue}){
 const entries=new Map(),pending=new Map();
 const read=async(account,path)=>{const work=async()=>{const r=await fetchForAccount(account)(path,{method:'GET',credentials:'include',cache:'no-store'});if(!r.ok){const e=Error('Sessão indisponível: HTTP '+r.status);e.status=r.status;throw e;}return r.json();};return accountQueue?accountQueue.run(account.id,work):work();};
 async function identity(account){return identityFromToken(await read(account,'/api/auth/token'));}
 async function connect(account){
  if(entries.has(account.id))return entries.get(account.id);if(pending.has(account.id))return pending.get(account.id);
  const work=(async()=>{const userId=await identity(account),transport=websocketTransportForAccount?.(account);
   const socket=ioFactory('https://ws.case-clicker.com',{autoConnect:false,...(transport?{transportImplementations:[transport]}:{transports:['websocket']}),reconnectionDelay:5000,auth:async callback=>{try{const body=await read(account,'/api/auth/token');callback(typeof body?.token==='string'&&body.token?{token:body.token}:{});}catch{callback({});}}});
   const entry={socket,userId,watchers:new Map()};entries.set(account.id,entry);
   socket.on('connect',()=>{for(const id of entry.watchers.keys())socket.emit('watchTrade',id);});
   socket.on('disconnect',()=>{for(const w of entry.watchers.values())w.callback({kind:'disconnected',message:'Ligação à troca interrompida'});});
   const state=(kind)=>(raw,items)=>{
    const w=entry.watchers.get(raw?._id);if(!w)return;const snapshot=normalizeTrade(raw,kind==='confirmed'?undefined:items,w);
    if(!snapshot){w.callback({kind:'error',message:'Estado da troca inválido'});return;}
    if(kind!=='confirmed'&&Array.isArray(items))w.items=items.map(i=>({_id:i?._id,userId:i?.userId}));w.snapshot=snapshot;
    const update={kind,snapshot};if(kind==='confirmed')update.receivedItemIds=Array.isArray(items)?items.filter(i=>i?.userId===userId&&validId(i?._id)).map(i=>i._id):[];
    w.callback(update);if(kind==='state'&&Array.isArray(items)){for(const resolve of w.refreshers.splice(0))resolve(snapshot);}
   };
   socket.on('tradeInfo',state('state'));socket.on('tradeAccepted',state('state'));socket.on('tradeConfirmed',state('confirmed'));socket.on('tradeExited',state('exited'));socket.on('tradeKicked',state('exited'));
   for(const event of ['tradeDeleted','tradeError','tradeWatchError'])socket.on(event,()=>{for(const w of entry.watchers.values())w.callback({kind:'error',message:event==='tradeDeleted'?'Troca apagada; verifica o estado':'Erro na troca; verifica o estado'});});
   await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.disconnect();entries.delete(account.id);reject(Error('Ligação à troca por confirmar'));},15000);const done=()=>{clearTimeout(timer);socket.off('connect',done);socket.off('connect_error',fail);resolve();};const fail=()=>{clearTimeout(timer);socket.off('connect',done);socket.off('connect_error',fail);socket.disconnect();entries.delete(account.id);reject(Error('Ligação à troca indisponível'));};socket.on('connect',done);socket.on('connect_error',fail);socket.connect();});return entry;
  })();pending.set(account.id,work);try{return await work;}finally{pending.delete(account.id);}
 }
 return {identity,async watch(account,tradeId,onUpdate){
  if(!validId(tradeId)||typeof onUpdate!=='function')throw Error('Troca inválida');const e=await connect(account);if(e.watchers.size&&!e.watchers.has(tradeId))throw Error('Esta conta já acompanha outra operação de envio');
  e.watchers.set(tradeId,{callback:onUpdate,items:undefined,snapshot:null,refreshers:[]});e.socket.emit('watchTrade',tradeId);
  return {close(){e.watchers.delete(tradeId);if(e.socket.connected)e.socket.emit('exitWatchTrade',tradeId);}};
 },async refresh(account,tradeId){
  const e=entries.get(account.id),w=e?.watchers.get(tradeId);if(!e?.socket.connected||!w)throw Error('Troca desligada');
  return new Promise((resolve,reject)=>{const accept=s=>{clearTimeout(timer);resolve(s);},timer=setTimeout(()=>{w.refreshers=w.refreshers.filter(r=>r!==accept);reject(Error('Oferta atual por confirmar'));},30000);w.refreshers.push(accept);e.socket.emit('watchTrade',tradeId);});
 },async command(account,tradeId,kind,itemId,controls={}){
  const e=entries.get(account.id);if(!e?.socket.connected||!e.watchers.has(tradeId))throw Error('Troca desligada');if(await identity(account)!==e.userId)throw Error('A identidade da conta mudou');
  const names={add:'tradeAddSkins',tokens:'tradeAddTokens',accept:'tradeAccept',confirm:'tradeConfirm',delete:'tradeDelete',exit:'tradeExit'};if(!names[kind])throw Error('Comando de troca inválido');if(kind==='add'&&!validId(itemId))throw Error('Item inválido');
  if(kind==='tokens'&&(!Number.isSafeInteger(itemId)||itemId<1))throw Error('Quantidade de tokens inválida');
  const payload={userId:e.userId,tradeId,...(kind==='add'?{skinIds:[itemId]}:kind==='tokens'?{tokens:itemId}:{})};const work=async()=>{await controls.beforeSend?.();if(!e.socket.connected)throw Error('Troca desligada');controls.guard?.();e.socket.emit(names[kind],payload);return {sent:true};};return accountQueue?accountQueue.run(account.id,work):work();
 },dispose(accountId){const e=entries.get(accountId);if(!e)return;for(const id of e.watchers.keys())if(e.socket.connected)e.socket.emit('exitWatchTrade',id);e.watchers.clear();e.socket.disconnect();entries.delete(accountId);}};
}
module.exports={createTradeTransport,normalizeTrade};
