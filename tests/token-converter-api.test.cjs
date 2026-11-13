const test=require('node:test'),assert=require('node:assert/strict');
const {createCaseApi}=require('../electron/api.cjs');
const capsuleId='64d9ecad463b7ffa9697e2ea';
test('converter reads the real rank object and does not expose unrelated profile fields',async()=>{
  const api=createCaseApi(async()=>new Response(JSON.stringify({money:200,tokens:30,membership:'basic',rank:{id:13,name:'Master Guardian Elite',short:'MGE',image:'/pictures/ranks/mge.png',xpNeeded:10000,xpNeededForRankup:20000},caseOpenCount:9,maxCaseOpenMultiplier:1,email:'private@example.test'})));
  assert.deepEqual(await api.converterProfile(),{money:200,tokens:30,membership:'basic',rank:13,caseOpenCount:9,maxCaseOpenMultiplier:1});
});
test('invalid rank ids are refused instead of silently becoming zero or another level',async()=>{
  for(const rank of [null,{},[],{id:null},{id:true},{id:'Master Guardian Elite'},{id:13.5}]) {
    const api=createCaseApi(async()=>new Response(JSON.stringify({money:200,tokens:30,membership:'pro',rank,caseOpenCount:9,maxCaseOpenMultiplier:1})));
    await assert.rejects(api.converterProfile(),/nível/);
  }
});
test('capsule catalog uses its public reader instead of the API-only farm route',async()=>{
  const calls=[];
  const api=createCaseApi(async path=>{if(!path.startsWith('/api/'))throw Error('Endpoint de farm inválido');return new Response('{}');},{publicFetcher:async(path,init)=>{calls.push({path,method:init.method});return new Response('<script id="__NEXT_DATA__">'+JSON.stringify({props:{pageProps:{caseProp:{_id:capsuleId,type:'capsule',price:100,rankNeeded:11}}}})+'</script>');}});
  assert.deepEqual(await api.converterCapsule(),{id:capsuleId,price:100,rankNeeded:11});
  assert.deepEqual(calls,[{path:'/cases/capsules/atlanta-2017-legends-holo-foil',method:'GET'}]);
});
test('converter API constrains sale, purchase and capsule opening payloads',async()=>{
  const requests=[],api=createCaseApi(async(path,init)=>{requests.push({path,method:init.method,body:JSON.parse(init.body)});return new Response(JSON.stringify({openedStickers:[{_id:'a'.repeat(24)}]}));});
  assert.equal(typeof api.sellCase,'function');
  await api.sellCase('b'.repeat(24),2);await api.buyConverterCapsules(4);const opened=await api.openConverterCapsules(2,3);
  assert.deepEqual(requests,[{path:'/api/cases',method:'DELETE',body:{id:'b'.repeat(24),type:'case',amount:2}},{path:'/api/cases',method:'POST',body:{id:capsuleId,type:'capsule',amount:4}},{path:'/api/open/capsule',method:'POST',body:{id:capsuleId,quickOpen:true,count:2,useEventTickets:false,caseOpenMultiplier:3}}]);
  assert.deepEqual(opened.skinIds,['a'.repeat(24)]);
  await assert.rejects(api.sellCase('invalid',1));await assert.rejects(api.buyConverterCapsules(-1));await assert.rejects(api.openConverterCapsules(0,1));
});
test('quick capsule opening identifies stickers in the top-level array returned by the site',async()=>{
  const api=createCaseApi(async()=>new Response(JSON.stringify([{_id:'a'.repeat(24),isSticker:true},{_id:'b'.repeat(24),isSticker:true}])));
  assert.deepEqual((await api.openConverterCapsules(2,1)).skinIds,['a'.repeat(24),'b'.repeat(24)]);
});
test('manual capsule opening omits the autoOpen field exactly as the sites manual quick-open action does',async()=>{
  let body;const api=createCaseApi(async(_path,init)=>{body=JSON.parse(init.body);return new Response('[]');});
  await api.openConverterCapsules(1,1);assert.equal(Object.hasOwn(body,'autoOpen'),false);
});
test('token transport deposits positive integer amounts under the authenticated identity',async()=>{
  const {EventEmitter}=require('node:events');const {createTradeTransport}=require('../electron/tradeTransport.cjs');let socket;
  class Socket extends EventEmitter{constructor(opts){super();this.opts=opts;this.commands=[];this.connected=false;}emit(event,...args){this.commands.push({event,args});return true;}connect(){this.opts.auth(()=>{this.connected=true;super.emit('connect');});}disconnect(){this.connected=false;}}
  const transport=createTradeTransport({fetchForAccount:()=>async()=>({ok:true,json:async()=>({token:'h.'+Buffer.from(JSON.stringify({id:'account-identity'})).toString('base64url')+'.s'})}),ioFactory:(_,opts)=>(socket=new Socket(opts))});
  const account={id:'account'},tradeId='c'.repeat(24);await transport.watch(account,tradeId,()=>{});
  try{await transport.command(account,tradeId,'tokens',123);assert.deepEqual(socket.commands.at(-1),{event:'tradeAddTokens',args:[{userId:'account-identity',tradeId,tokens:123}]});for(const n of [0,-1,1.1,NaN,Infinity])await assert.rejects(transport.command(account,tradeId,'tokens',n));}finally{transport.dispose(account.id);}
});
