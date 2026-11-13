const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
let createTradeTransport;try{({createTradeTransport}=require('../engine/tradeTransport.cjs'));}catch{}
const tradeId='c'.repeat(24),itemId='a'.repeat(24);
class Socket extends EventEmitter{constructor(options){super();this.options=options;this.commands=[];this.connected=false;}emit(event,...args){this.commands.push({event,args});return true;}deliver(event,...args){return super.emit(event,...args);}connect(){this.options.auth(auth=>{this.auth=auth;this.connected=true;this.deliver('connect');});}disconnect(){this.connected=false;this.deliver('disconnect');}}
function fixture(){assert.equal(typeof createTradeTransport,'function');const sockets=[],reads=[];const transport=createTradeTransport({fetchForAccount:account=>async path=>{reads.push([account.id,path]);return {ok:true,json:async()=>path==='/api/me'?{money:100}:{token:'header.'+Buffer.from(JSON.stringify({id:account.id+'-identity'})).toString('base64url')+'.signature'}};},ioFactory:(url,opts)=>{const s=new Socket(opts);sockets.push(s);return s;}});return {transport,sockets,reads};}
const trade=()=>({_id:tradeId,status:'active',host:{user:{userId:'a-identity'},hasAccepted:false},guest:{user:{userId:'b-identity'},hasAccepted:false},hostTokens:0,guestTokens:0});
test('trade sockets authenticate per account and commands use session identities',async()=>{
 const f=fixture(),updates=[];await f.transport.watch({id:'a'},tradeId,u=>updates.push(u));await f.transport.watch({id:'b'},tradeId,()=>{});assert.notEqual(f.sockets[0].auth.token,f.sockets[1].auth.token);assert.ok(f.reads.every(([,path])=>path==='/api/auth/token'));
 f.sockets[0].deliver('tradeInfo',trade(),[{_id:itemId,userId:'a-identity'}]);assert.deepEqual(updates.at(-1).snapshot.host.skinIds,[itemId]);await f.transport.command({id:'a'},tradeId,'accept');assert.deepEqual(f.sockets[0].commands.at(-1),{event:'tradeAccept',args:[{userId:'a-identity',tradeId}]});
 const before=f.sockets[0].commands.filter(c=>c.event==='tradeAccept').length;f.sockets[0].deliver('connect');assert.equal(f.sockets[0].commands.filter(c=>c.event==='tradeAccept').length,before);assert.equal(f.sockets[0].commands.some(c=>c.event==='joinTrade'),false);
 f.transport.dispose('a');f.transport.dispose('b');
});
test('another trade is ignored and unscoped event cannot confirm anything',async()=>{
 const f=fixture(),updates=[];await f.transport.watch({id:'a'},tradeId,u=>updates.push(u));f.sockets[0].deliver('tradeInfo',{...trade(),_id:'d'.repeat(24)},[]);assert.equal(updates.length,0);
 f.sockets[0].deliver('tradeDeleted');assert.equal(updates.at(-1).kind,'error');assert.equal(updates.at(-1).snapshot,undefined);
 f.transport.dispose('a');
});
test('missing identity refuses trade socket and malformed offer remains unknown',async()=>{
 assert.equal(typeof createTradeTransport,'function');let made=0;const bad=createTradeTransport({fetchForAccount:()=>async()=>({ok:true,json:async()=>({})}),ioFactory:()=>{made++;}});await assert.rejects(bad.watch({id:'a'},tradeId,()=>{}),/Identidade/);assert.equal(made,0);
 const f=fixture(),updates=[];await f.transport.watch({id:'a'},tradeId,u=>updates.push(u));f.sockets[0].deliver('tradeInfo',trade());assert.equal(updates.at(-1).snapshot.offerKnown,false);f.transport.dispose('a');
});
module.exports={Socket,trade};
test('identity rate limits retain the server retry deadline',async()=>{
 const transport=createTradeTransport({fetchForAccount:()=>async()=>new Response('{}',{status:429,headers:{'Retry-After':'45'}})});
 await assert.rejects(transport.identity({id:'a'}),e=>e.status===429&&e.retryAfter==='45');
});
