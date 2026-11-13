const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createCaseApi}=require('../engine/api.cjs');
const {createAccountQueue}=require('../engine/accountQueue.cjs');
const {createTradeTransport}=require('../engine/tradeTransport.cjs');
let createTokenConverter;
try {({createTokenConverter}=require('../engine/tokenConverter.cjs'));} catch {}
const capsuleId='64d9ecad463b7ffa9697e2ea',caseId='635346787db930593e69cd6d',tradeId='c'.repeat(24);
function fixture(t,options={}) {
  const accounts=[...(options.sourceCount?Array.from({length:options.sourceCount},(_,i)=>'source'+i):['source','other']),'destination'].map(id=>({id,label:id}));
  const me=Object.fromEntries(accounts.map(a=>[a.id,{money:a.id==='destination'?0:50,tokens:a.id==='destination'?20:10.9,membership:'pro',caseOpenCount:2,maxCaseOpenMultiplier:3,rank:{id:13,name:'Master Guardian Elite'}}]));
  if(options.nonPro)me.source.membership='free';
  const inventory=Object.fromEntries(accounts.map(a=>[a.id,[{_id:caseId,type:'case',amount:5},{_id:capsuleId,type:'capsule',amount:options.capsules??0}]]));
  const stickers=new Map(),requests=[],commands=[],sockets=[];
  let serial=0,conversionCalls=0,saved=null,trade=null,tradeItems=[];
  const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Retry-After':'2'}});
  const broadcast=(event='tradeInfo')=>sockets.forEach(s=>queueMicrotask(()=>s.deliver(event,structuredClone(trade),tradeItems)));
  const fetchForAccount=a=>async(path,init={})=>{
    const body=init.body?JSON.parse(init.body):null,method=init.method||'GET';requests.push({accountId:a.id,path,method,body});
    await options.beforeRequest?.({accountId:a.id,path,method,body});
    if(path==='/api/auth/token')return response({token:'h.'+Buffer.from(JSON.stringify({id:a.id+'-identity'})).toString('base64url')+'.s'});
    if(path==='/api/me')return response(me[a.id]);
    if(path==='/cases/capsules/atlanta-2017-legends-holo-foil')return new Response('<script id="__NEXT_DATA__">'+JSON.stringify({props:{pageProps:{caseProp:JSON.stringify({_id:capsuleId,type:'capsule',price:100,rankNeeded:11})}}})+'</script>');
    if(path==='/api/cases') {
      if(method==='GET')return response(inventory[a.id]);
      const box=inventory[a.id].find(c=>c._id===body.id);
      if(method==='DELETE'){box.amount-=body.amount;me[a.id].money+=body.amount*70;return response({});}
      if(method==='POST'){box.amount+=body.amount;me[a.id].money-=body.amount*100;return response({});}
    }
    if(path==='/api/open/capsule') {
      const box=inventory[a.id].find(c=>c._id===capsuleId),amount=body.count*body.caseOpenMultiplier;
      if(amount>box.amount)return response({error:'not enough'},400);
      box.amount-=amount;
      const openedStickers=Array.from({length:amount},()=>{const skin={_id:(++serial).toString(16).padStart(24,'0'),isSticker:true};stickers.set(skin._id,a.id);return skin;});
      if(options.lostOpen)throw Error('Lost response');
      const returned=options.incompleteOpening?openedStickers.slice(0,1):openedStickers;
      return response(options.quickArray?returned:{openedStickers:returned});
    }
    if(path==='/api/casino/skinToTokens') {
      assert.equal(stickers.get(body.id),a.id);stickers.delete(body.id);me[a.id].tokens+=100;
      conversionCalls++;
      if(options.stopAfterConvert&&conversionCalls===1)await service.stop();
      if(options.lostConvert&&conversionCalls===1)throw Error('Lost conversion response');
      return response({});
    }
    if(path==='/api/trading') {
      if(method==='GET')return response({isUnlocked:true,activeUserTrades:trade?.status==='active'?[trade]:[],finishedUserTrades:trade?.status==='finished'?[trade]:[]});
      trade={_id:tradeId,status:'active',host:{user:{userId:a.id+'-identity'},hasAccepted:false},guest:null,hostTokens:0,guestTokens:0};
      if(options.lostCreate)throw Error('Lost response');
      return response({_id:tradeId});
    }
    throw Error('Unexpected request '+path);
  };
  class Socket extends EventEmitter {
    constructor(opts){super();this.opts=opts;this.connected=false;this.confirmed=false;}
    deliver(e,...args){super.emit(e,...args);}
    connect(){this.opts.auth(auth=>{this.id=JSON.parse(Buffer.from(auth.token.split('.')[1],'base64url').toString()).id.replace('-identity','');this.connected=true;this.deliver('connect');});}
    disconnect(){this.connected=false;}
    emit(event,payload) {
      commands.push({accountId:this.id,event,payload});
      if(event==='watchTrade') {
        if(this.id==='destination')trade.guest={user:{userId:options.unexpectedGuest?'outsider':this.id+'-identity'},hasAccepted:trade.guest?.hasAccepted||false};
        if(options.changedOffer&&trade.host.hasAccepted&&trade.guest.hasAccepted)trade.guestTokens=1;
        broadcast();
      }
      if(event==='tradeAddTokens') {
        me[this.id].tokens-=payload.tokens;trade.hostTokens+=payload.tokens;
        if(options.stopAtDeposit)queueMicrotask(()=>service.stop());
        broadcast();
      }
      if(event==='tradeAccept'){(this.id==='destination'?trade.guest:trade.host).hasAccepted=true;broadcast();}
      if(event==='tradeConfirm') {
        this.confirmed=true;
        if(sockets.filter(s=>s.connected&&s.confirmed).length===2){trade.status='finished';if(!options.missingArrival)me.destination.tokens+=trade.hostTokens;broadcast('tradeConfirmed');}
      }
      if(event==='tradeDelete'&&!options.delayedCancel){me.source.tokens+=trade.hostTokens;trade.hostTokens=0;trade.status='cancelled';broadcast('tradeDeleted');}
      return true;
    }
  }
  const queue=createAccountQueue();
  const transport=createTradeTransport({fetchForAccount,accountQueue:queue,ioFactory:(_,opts)=>{const s=new Socket(opts);sockets.push(s);return s;}});
  const store={load:async()=>structuredClone(saved),save:async value=>{saved=structuredClone(value);}};
  const deps={listAccounts:async()=>accounts,apiForAccount:a=>createCaseApi(fetchForAccount(a)),transport,accountQueue:queue,store,intervalMs:0,waitTimeoutMs:60};
  assert.equal(typeof createTokenConverter,'function','Token converter service is available');
  const service=createTokenConverter(deps);
  t.after(()=>accounts.forEach(a=>transport.dispose(a.id)));
  return {service,deps,accounts,me,inventory,requests,commands,stickers,saved:()=>saved,completeCancellation(){me.source.tokens+=trade.hostTokens;trade.hostTokens=0;trade.status='cancelled';}};
}
async function settled(service) {
  for(let i=0;i<1000;i++){const s=service.status();if(!['preparing','running','stopping'].includes(s.phase))return s;await new Promise(r=>setTimeout(r,3));}
  throw Error('Converter did not settle');
}
const config={action:'full',accountIds:['source'],destinationAccountId:'destination'};
test('full sequence sells cases, converts new stickers and transfers the entire integer token balance',async t=>{
  const f=fixture(t);await f.service.start(config);const status=await settled(f.service);
  assert.equal(status.rows[0].state,'confirmed');assert.equal(status.rows[0].sold,5);assert.equal(status.rows[0].bought,4);assert.equal(status.rows[0].opened,4);assert.equal(status.rows[0].converted,4);assert.equal(status.rows[0].sentTokens,410);
  assert.equal(f.me.destination.tokens,430);assert.ok(Math.abs(f.me.source.tokens-.9)<1e-9);assert.equal(f.stickers.size,0);
  const deposits=f.commands.filter(c=>c.event==='tradeAddTokens');assert.equal(deposits.length,1);assert.equal(deposits[0].payload.tokens,410);
  assert.deepEqual(f.commands.filter(c=>c.event==='tradeAccept').map(c=>c.accountId),['source','destination']);
  assert.deepEqual(f.commands.filter(c=>c.event==='tradeConfirm').map(c=>c.accountId),['source','destination']);
  assert.ok(f.requests.filter(r=>r.path==='/api/open/capsule').every(r=>!Object.hasOwn(r.body,'autoOpen')));
});
test('opening sizes the final batch without exceeding remaining capsules',async t=>{
  const f=fixture(t,{capsules:5});await f.service.start({...config,action:'open'});const s=await settled(f.service);
  assert.equal(s.rows[0].opened,5);assert.equal(s.rows[0].converted,5);
  assert.deepEqual(f.requests.filter(r=>r.path==='/api/open/capsule').map(r=>[r.body.count,r.body.caseOpenMultiplier]),[[1,3],[2,1]]);
});
test('Pro is checked before selling any cases in the full sequence',async t=>{
  const f=fixture(t,{nonPro:true});await assert.rejects(f.service.start(config),/Pro/);
  assert.equal(f.requests.filter(r=>r.method!=='GET').length,0);
});
test('destination must be known, distinct and excluded from source selection',async t=>{
  const f=fixture(t);
  for(const bad of [{...config,destinationAccountId:'source'},{...config,destinationAccountId:'missing'},{...config,accountIds:['source','source']}])await assert.rejects(f.service.start(bad));
  assert.equal(f.requests.filter(r=>r.method!=='GET').length,0);
});
test('changed recipient prevents depositing and accepting tokens',async t=>{
  const f=fixture(t,{unexpectedGuest:true});await f.service.start({...config,action:'trade'});const s=await settled(f.service);
  assert.equal(s.rows[0].state,'unconfirmed');assert.equal(f.commands.filter(c=>['tradeAddTokens','tradeAccept','tradeConfirm'].includes(c.event)).length,0);
});
test('changed counteroffer prevents confirmation',async t=>{
  const f=fixture(t,{changedOffer:true});await f.service.start({...config,action:'trade'});const s=await settled(f.service);
  assert.equal(s.rows[0].state,'unconfirmed');assert.equal(f.commands.filter(c=>c.event==='tradeConfirm').length,0);
});
test('finished socket event without destination balance arrival is not counted as sent',async t=>{
  const f=fixture(t,{missingArrival:true});await f.service.start({...config,action:'trade'});const s=await settled(f.service);
  assert.equal(s.rows[0].state,'unconfirmed');assert.equal(s.sentTokens,0);
});
test('stop after deposit prevents acceptance and leaves the known trade cancellable',async t=>{
  const f=fixture(t,{stopAtDeposit:true});await f.service.start({...config,action:'trade'});let s=await settled(f.service);
  assert.equal(s.rows[0].state,'unconfirmed');assert.equal(f.commands.filter(c=>c.event==='tradeAccept').length,0);
  await f.service.cancel(s.rows[0].operationId);s=f.service.status();assert.equal(s.rows[0].state,'cancelled');assert.equal(f.me.source.tokens,10.9);
});
test('lost creation response is never retried, including after process restart',async t=>{
  const f=fixture(t,{lostCreate:true});await f.service.start({...config,action:'trade'});const s=await settled(f.service);
  assert.equal(s.rows[0].state,'unconfirmed');assert.equal(f.requests.filter(r=>r.path==='/api/trading'&&r.method==='POST').length,1);
  const recovered=createTokenConverter(f.deps);await recovered.ready();await assert.rejects(recovered.start(config),/confirmar/);
  assert.equal(f.requests.filter(r=>r.path==='/api/trading'&&r.method==='POST').length,1);
});
test('lost open response stops the sequence and never repeats the opening',async t=>{
  const f=fixture(t,{lostOpen:true,capsules:5});await f.service.start({...config,action:'open'});const s=await settled(f.service);
  assert.equal(s.rows[0].state,'unconfirmed');assert.equal(f.requests.filter(r=>r.path==='/api/open/capsule').length,1);
  assert.equal(f.requests.filter(r=>r.path==='/api/casino/skinToTokens').length,0);
});
test('stop during an asynchronous send gate prevents purchasing capsules',async t=>{
  const f=fixture(t);f.me.source.money=200;let unblock,reached;const entered=new Promise(r=>{reached=r;});let intercepted=false;
  const coordinator={cooldown:async()=>{if(!intercepted&&f.saved()?.rows[0]?.pending?.kind==='buy'){intercepted=true;reached();await new Promise(r=>{unblock=r;});}return 0;}};
  const service=createTokenConverter({...f.deps,coordinator});await service.start({...config,action:'buy'});await entered;
  await service.stop();unblock();const s=await settled(service);
  assert.equal(f.requests.filter(r=>r.path==='/api/cases'&&r.method==='POST').length,0);assert.equal(s.rows[0].state,'stopped');
});
test('a delayed cancellation can be reconciled after restart without deleting twice',async t=>{
  const f=fixture(t,{stopAtDeposit:true,delayedCancel:true});await f.service.start({...config,action:'trade'});const s=await settled(f.service),id=s.rows[0].operationId;
  await f.service.cancel(id);assert.equal(f.service.status().rows[0].state,'unconfirmed');
  f.completeCancellation();const recovered=createTokenConverter(f.deps);await recovered.ready();await recovered.verify(id);
  assert.equal(recovered.status().rows[0].state,'cancelled');assert.equal(f.commands.filter(c=>c.event==='tradeDelete').length,1);
});
test('concurrent cancellation sends at most one deletion',async t=>{
  const f=fixture(t,{stopAtDeposit:true});await f.service.start({...config,action:'trade'});const s=await settled(f.service),id=s.rows[0].operationId;
  await Promise.all([f.service.cancel(id),f.service.cancel(id)]);
  assert.equal(f.commands.filter(c=>c.event==='tradeDelete').length,1);
});
test('multiple origins send sequentially to the selected destination',async t=>{
  const f=fixture(t);await f.service.start({...config,action:'trade',accountIds:['source','other']});const s=await settled(f.service);
  assert.equal(s.rows.length,2);assert.ok(s.rows.every(r=>r.state==='confirmed'));assert.equal(s.sentTokens,20);assert.equal(f.me.destination.tokens,40);
  assert.deepEqual(f.commands.filter(c=>c.event==='tradeAddTokens').map(c=>c.accountId),['source','other']);
});
test('all fifty origins can sell before any slower origin completes its request',async t=>{
  let release;const blocked=new Promise(r=>{release=r;}),entered=new Set();
  const f=fixture(t,{sourceCount:50,beforeRequest:async r=>{if(r.path==='/api/cases'&&r.method==='DELETE'){entered.add(r.accountId);await blocked;}}});
  await f.service.start({action:'sell',accountIds:f.accounts.filter(a=>a.id!=='destination').map(a=>a.id)});
  try {
    for(let i=0;i<100&&entered.size<50;i++)await new Promise(r=>setTimeout(r,3));
    assert.equal(entered.size,50,'All selected accounts enter selling concurrently');
    assert.equal(f.service.status().rows.filter(r=>r.state==='running').length,50);
  }finally{release();await settled(f.service);}
  assert.equal(f.service.status().rows.filter(r=>r.state==='confirmed'&&r.sold===5).length,50);
});
test('a finished parallel preparation does not disconnect another origins active trade',async t=>{
  let releaseSale,releaseTrade,tradeStarted;const saleBlocked=new Promise(r=>{releaseSale=r;}),tradeBlocked=new Promise(r=>{releaseTrade=r;}),inTrade=new Promise(r=>{tradeStarted=r;});
  const f=fixture(t,{beforeRequest:async r=>{
    if(r.accountId==='other'&&r.path==='/api/cases'&&r.method==='DELETE')await saleBlocked;
    if(r.accountId!=='other'&&r.path==='/api/auth/token'&&f.service.status().rows.some(row=>row.accountId==='source'&&row.stage==='accept')){tradeStarted();await tradeBlocked;}
  }});
  await f.service.start({...config,accountIds:['source','other']});
  await inTrade;releaseSale();
  try {
    for(let i=0;i<100&&!f.service.status().rows.some(r=>r.accountId==='other'&&r.converted===4);i++)await new Promise(r=>setTimeout(r,3));
    assert.equal(f.service.status().rows.find(r=>r.accountId==='other').converted,4,'Other origin converts while the destination handles the first trade');
    assert.equal(f.requests.filter(r=>r.path==='/api/trading'&&r.method==='POST').length,1,'Only one trade is created before first trade verification');
  }finally{releaseTrade();releaseSale();}
  const s=await settled(f.service);assert.ok(s.rows.every(r=>r.state==='confirmed'),JSON.stringify(s));assert.equal(s.sentTokens,820);assert.equal(f.me.destination.tokens,840);
});
test('Stop drains all sent parallel sales and prevents further purchases',async t=>{
  let release;const blocked=new Promise(r=>{release=r;}),entered=new Set();
  const f=fixture(t,{beforeRequest:async r=>{if(r.path==='/api/cases'&&r.method==='DELETE'){entered.add(r.accountId);await blocked;}}});
  await f.service.start({...config,accountIds:['source','other']});
  try {
    for(let i=0;i<100&&entered.size<2;i++)await new Promise(r=>setTimeout(r,3));
    assert.equal(entered.size,2);await f.service.stop();assert.equal(f.service.status().phase,'stopping');
  }finally{release();}
  const s=await settled(f.service);assert.equal(s.phase,'idle');assert.ok(s.rows.every(r=>r.state==='stopped'&&r.sold===5));
  assert.equal(f.requests.filter(r=>r.path==='/api/cases'&&r.method==='POST').length,0);
});
test('fifty full sequences verify every transfer without overlapping destination trades',async t=>{
  const f=fixture(t,{sourceCount:50});
  await f.service.start({...config,accountIds:f.accounts.filter(a=>a.id!=='destination').map(a=>a.id)});
  const s=await settled(f.service);
  assert.equal(s.rows.filter(r=>r.state==='confirmed'&&r.converted===4&&r.sentTokens===410).length,50);
  assert.equal(s.sentTokens,20500);assert.equal(f.me.destination.tokens,20520);assert.equal(f.stickers.size,0);
  assert.equal(f.requests.filter(r=>r.path==='/api/trading'&&r.method==='POST').length,50);
  assert.equal(f.commands.filter(c=>c.event==='tradeConfirm').length,100);
});
test('an uncertain trade prevents the next origin from creating a trade',async t=>{
  const f=fixture(t,{lostCreate:true});await f.service.start({...config,action:'trade',accountIds:['source','other']});const s=await settled(f.service);
  assert.equal(s.phase,'blocked');assert.equal(s.rows.filter(r=>r.state==='unconfirmed').length,1);
  assert.equal(f.requests.filter(r=>r.path==='/api/trading'&&r.method==='POST').length,1);
  assert.equal(s.rows.find(r=>r.accountId==='other').state,'stopped');
});
test('an uncertain parallel purchase drains an already sent sale before releasing the operation lock',async t=>{
  let release;const blocked=new Promise(r=>{release=r;});
  const f=fixture(t,{beforeRequest:async r=>{
    if(r.accountId==='other'&&r.path==='/api/cases'&&r.method==='DELETE')await blocked;
    if(r.accountId==='source'&&r.path==='/api/cases'&&r.method==='POST')throw Error('Lost purchase response');
  }});
  await f.service.start({...config,accountIds:['source','other']});
  try {
    for(let i=0;i<100&&!f.service.status().rows.some(r=>r.state==='unconfirmed');i++)await new Promise(r=>setTimeout(r,3));
    assert.equal(f.service.status().phase,'stopping');assert.equal(f.service.active(),true);
    await assert.rejects(f.service.start(config),/execução/);
  }finally{release();}
  const s=await settled(f.service);assert.equal(s.phase,'blocked');assert.equal(s.rows.find(r=>r.accountId==='other').sold,5);
  assert.equal(s.rows.find(r=>r.accountId==='other').state,'stopped');
  assert.equal(f.requests.filter(r=>r.path==='/api/cases'&&r.method==='POST').length,1);
});
test('boosted opening settings are bounded to supported requests rather than rejecting a valid account',async t=>{
  const f=fixture(t,{capsules:5});f.me.source.caseOpenCount=500;f.me.source.maxCaseOpenMultiplier=50;
  await f.service.start({...config,action:'open'});const s=await settled(f.service);
  assert.equal(s.rows[0].state,'confirmed');assert.equal(s.rows[0].opened,5);
  assert.deepEqual(f.requests.filter(r=>r.path==='/api/open/capsule').map(r=>[r.body.count,r.body.caseOpenMultiplier]),[[5,1]]);
});
test('fifty origins convert the actual quick-opening array response without blocking',async t=>{
  const f=fixture(t,{sourceCount:50,capsules:3,quickArray:true});await f.service.start({action:'open',accountIds:f.accounts.filter(a=>a.id!=='destination').map(a=>a.id)});
  const s=await settled(f.service);assert.equal(s.phase,'idle');assert.equal(s.rows.filter(r=>r.opened===3&&r.converted===3&&r.state==='confirmed').length,50);
  assert.equal(f.stickers.size,0);
});
test('stopping between conversions keeps the known stickers for the next explicit opening run after restart',async t=>{
  const f=fixture(t,{capsules:5,stopAfterConvert:true});await f.service.start({...config,action:'open'});await settled(f.service);
  const recovered=createTokenConverter(f.deps);await recovered.ready();await recovered.start({...config,action:'open'});
  const s=await settled(recovered);assert.equal(s.rows[0].state,'confirmed');assert.equal(s.rows[0].opened,5);assert.equal(s.rows[0].converted,5);assert.equal(f.stickers.size,0);
  assert.equal(f.requests.filter(r=>r.path==='/api/casino/skinToTokens').length,5);
  assert.equal(f.requests.filter(r=>r.path==='/api/open/capsule').length,2,'Already opened capsules are not reopened');
});
test('opening response ids survive a failed quantity check and read-only verification after restart',async t=>{
  let failed=false;const f=fixture(t,{capsules:3,quickArray:true,beforeRequest:r=>{
    if(!failed&&r.path==='/api/cases'&&r.method==='GET'&&f.requests.some(r=>r.path==='/api/open/capsule')){failed=true;throw Error('Lost verification response');}
  }});
  await f.service.start({...config,action:'open'});const first=await settled(f.service);assert.equal(first.phase,'blocked');
  const recovered=createTokenConverter(f.deps);await recovered.ready();await recovered.verify(first.rows[0].operationId);
  assert.equal(recovered.status().rows[0].pendingStickers,3);
  await recovered.start({...config,action:'open'});const s=await settled(recovered);
  assert.equal(s.rows[0].converted,3);assert.equal(f.stickers.size,0);assert.equal(f.requests.filter(r=>r.path==='/api/open/capsule').length,1);
});
test('a verified lost conversion response removes that sticker from the queue before another explicit run',async t=>{
  const f=fixture(t,{capsules:3,lostConvert:true});await f.service.start({...config,action:'open'});const first=await settled(f.service);
  assert.equal(first.phase,'blocked');const recovered=createTokenConverter(f.deps);await recovered.ready();await recovered.verify(first.rows[0].operationId);
  await recovered.start({...config,action:'open'});const s=await settled(recovered);assert.equal(s.rows[0].converted,3);assert.equal(f.stickers.size,0);
  assert.equal(f.requests.filter(r=>r.path==='/api/casino/skinToTokens').length,3,'The uncertain conversion is verified, never resent');
});
test('a new action or selection cannot discard known unconverted stickers',async t=>{
  const f=fixture(t,{capsules:3,stopAfterConvert:true});await f.service.start({...config,action:'open'});await settled(f.service);
  for(const next of [{...config,action:'sell'},{...config,action:'open',accountIds:['other']}])await assert.rejects(f.service.start(next),/stickers por converter/);
  assert.equal(f.service.status().rows[0].pendingStickers,2);
});
test('manual acknowledgement cannot cause an uncertain queued conversion to be resent',async t=>{
  const f=fixture(t,{capsules:3,lostConvert:true});await f.service.start({...config,action:'open'});const first=await settled(f.service);
  await f.service.acknowledge(first.rows[0].operationId);assert.equal(f.service.status().phase,'blocked');
  await assert.rejects(f.service.start({...config,action:'open'}),/confirmar/);
  assert.equal(f.requests.filter(r=>r.path==='/api/casino/skinToTokens').length,1);
});
test('quantity-only verification leaves an opening blocked when its response did not identify every sticker',async t=>{
  const f=fixture(t,{capsules:3,incompleteOpening:true});await f.service.start({...config,action:'open'});const first=await settled(f.service);
  await f.service.verify(first.rows[0].operationId);assert.equal(f.service.status().phase,'blocked');
  await assert.rejects(f.service.start({...config,action:'open'}),/confirmar/);
  assert.equal(f.stickers.size,3);assert.equal(f.requests.filter(r=>r.path==='/api/open/capsule').length,1);
});
