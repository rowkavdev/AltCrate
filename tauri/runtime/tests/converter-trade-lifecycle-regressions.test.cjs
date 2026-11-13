const test=require('node:test');
const assert=require('node:assert/strict');
const {createTokenConverter}=require('../engine/tokenConverter.cjs');
const {consolidationFixture,settled}=require('./helpers/consolidation-fixture.cjs');

const cancelledRow=()=>({operationId:'prior-cancelled',accountId:'source',sourceIdentity:'source-identity',destinationAccountId:'destination',destinationIdentity:'destination-identity',state:'cancelled',route:'tokens',tradeId:'c'.repeat(24),cancelSent:true,sourceBefore:200,destinationBefore:50,offerTokens:200,sentTokens:0,receivedTokens:0,completedSteps:[],verified:true,handoffs:[],remainingItems:[],remainingSkinIds:[],sold:0,bought:0,opened:0,converted:0,sequencePlan:{selectedSteps:['transfer'],effectiveSteps:['transfer'],tokenBudget:200,items:[],scopes:{tokens:200,money:0,cases:[],capsule:null,capsuleCount:0}},pending:null});

test('a new trade after a cancelled sequence clears old trade markers and can be cancelled',async t=>{
  const f=await consolidationFixture(t,{pro:true,noItems:true}),prior={...cancelledRow(),confirmSent:true,transferConfirmed:true};
  let service;
  const command=f.deps.transport.command;
  f.deps.transport.command=async(...args)=>{
    const result=await command(...args);
    if(args[2]==='tokens')await service.stopAccount(prior.operationId);
    if(args[2]==='delete')f.me.source.tokens+=200;
    return result;
  };
  service=createTokenConverter({...f.deps,store:{...f.deps.store,load:async()=>({version:1,rows:[structuredClone(prior)]})}});
  await service.ready();
  const preview=await service.prepare({action:'sequence',accountIds:['source'],destinationAccountId:'destination',steps:['transfer'],resumeOperationIds:[prior.operationId]});
  await service.start({action:'sequence',previewId:preview.previewId});
  const paused=await settled(service),current=paused.rows[0];
  assert.notEqual(current.tradeId,prior.tradeId);
  assert.equal(current.state,'unconfirmed');
  assert.equal(current.canCancel,true);
  assert.notEqual(f.saved().rows[0].cancelSent,true);
  assert.notEqual(f.saved().rows[0].confirmSent,true);
  assert.notEqual(f.saved().rows[0].transferConfirmed,true);
  const result=await service.cancel(prior.operationId);
  assert.equal(result.rows[0].state,'cancelled');
  assert.equal(result.rows[0].verified,true);
  assert.equal(f.me.source.tokens,200);
  assert.equal(f.commands.filter(command=>command.event==='tradeDelete').length,1);
});

test('a delayed sequence cancellation is verified before any finished-transfer check',async t=>{
  const f=await consolidationFixture(t,{pro:true,noItems:true}),row={...cancelledRow(),state:'unconfirmed',verified:false,pending:{kind:'tokens'}};
  let refreshed=0;
  const service=createTokenConverter({...f.deps,transport:{...f.deps.transport,refresh:async()=>{refreshed++;throw Error('Cancelled trade must not be checked as a transfer');}},store:{...f.deps.store,load:async()=>({version:1,rows:[structuredClone(row)]})}});
  await service.ready();
  const result=await service.verify(row.operationId);
  assert.equal(result.rows[0].state,'cancelled');
  assert.equal(result.rows[0].verified,true);
  assert.equal(result.rows[0].canRepeat,true);
  assert.equal(refreshed,0);
  assert.equal(f.commands.length,0);
});

test('an earlier cancellation cannot clear a later local sequence intent during verification',async t=>{
  const f=await consolidationFixture(t,{pro:true,noItems:true,money:70}),row={...cancelledRow(),state:'unconfirmed',verified:false,pending:{kind:'seq-sell',id:'635346787db930593e69cd6d',before:1,amount:1,beforeMoney:0,maximumCredit:70}};
  const service=createTokenConverter({...f.deps,store:{...f.deps.store,load:async()=>({version:1,rows:[structuredClone(row)]})}});
  await service.ready();
  const result=await service.verify(row.operationId);
  assert.equal(result.rows[0].state,'stopped');
  assert.equal(result.rows[0].sold,1);
  assert.equal(f.saved().rows[0].pending,null);
});

test('a proven cancellation is atomically verified and can be archived',async t=>{
  const f=await consolidationFixture(t,{pro:true,noItems:true}),row={...cancelledRow(),state:'unconfirmed',verified:false,cancelSent:false,pending:{kind:'tokens'}};
  const snapshot={id:row.tradeId,status:'active',offerKnown:true,host:{userId:'source-identity',tokens:0,skinIds:[],hasAccepted:false},guest:{userId:'destination-identity',tokens:0,skinIds:[],hasAccepted:false}};
  const archives=[];
  const service=createTokenConverter({...f.deps,transport:{identity:async account=>account.id+'-identity',watch:async(_account,_id,callback)=>{callback({snapshot});return {close(){}};},refresh:async()=>snapshot,command:async()=>{snapshot.status='cancelled';},dispose(){}},store:{...f.deps.store,load:async()=>({version:1,rows:[structuredClone(row)]}),archive:async value=>archives.push(value)}});
  await service.ready();
  const result=await service.cancel(row.operationId);
  assert.equal(result.rows[0].state,'cancelled');
  assert.equal(result.rows[0].verified,true);
  assert.equal(result.rows[0].canRepeat,true);
  assert.equal(result.clearableCount,1);
  assert.equal(f.saved().rows[0].verified,true);
  assert.equal((await service.clear()).rows.length,0);
  assert.equal(archives[0].rows[0].operationId,row.operationId);
});

test('a cancellation without the refunded balance remains unconfirmed',async t=>{
  const f=await consolidationFixture(t,{pro:true,noItems:true,tokens:0}),row={...cancelledRow(),state:'unconfirmed',verified:false,pending:{kind:'tokens'}};
  const service=createTokenConverter({...f.deps,store:{...f.deps.store,load:async()=>({version:1,rows:[structuredClone(row)]})}});
  await service.ready();
  const result=await service.verify(row.operationId);
  assert.equal(result.rows[0].state,'unconfirmed');
  assert.equal(result.rows[0].verified,false);
  assert.equal(result.sentTokens,0);
});

test('proven direct tokens remain in totals while opened stickers pause unrelated steps',async t=>{
  const f=await consolidationFixture(t,{noItems:true,capsules:1,pro:true});
  const preview=await f.service.prepare({action:'sequence',accountIds:['source'],destinationAccountId:'destination',steps:['open','transfer']});
  await f.service.start({action:'sequence',previewId:preview.previewId});
  const result=await settled(f.service);
  assert.equal(result.rows[0].state,'paused');
  assert.equal(result.rows[0].sentTokens,200);
  assert.equal(f.saved().rows[0].transferConfirmed,true);
  assert.equal(result.sentTokens,200);
  assert.equal(f.me.destination.tokens,250);
});

test('token totals do not double count received attribution or uncertain direct sends',async()=>{
  const service=createTokenConverter({store:{load:async()=>({version:1,rows:[{operationId:'received',accountId:'a',state:'paused',sentTokens:200,receivedTokens:150,transferConfirmed:true},{operationId:'uncertain',accountId:'b',state:'unconfirmed',sentTokens:500,verified:false}]}),save:async()=>{}}});
  await service.ready();
  assert.equal(service.status().sentTokens,150);
});

test('row events identify the exact changed operation when one account has multiple rows',async()=>{
  const events=[],service=createTokenConverter({store:{load:async()=>({version:1,rows:[{operationId:'old',accountId:'source',state:'stopped'},{operationId:'latest',accountId:'source',state:'paused'}]}),save:async()=>{}},emit:event=>events.push(event)});
  await service.ready();
  await service.stopAccount('latest');
  assert.equal(events.at(-1).operationId,'latest');
  assert.equal(events.at(-1).accountId,'source');
});

function protectedHistory(count){
  return Array.from({length:count},(_,index)=>({operationId:'old-'+index,accountId:'source',sourceIdentity:'source-identity',state:'unresolved',stage:'open',sequencePlan:{selectedSteps:['open'],effectiveSteps:['open'],prerequisites:[],items:[],scopes:{tokens:0}},pending:{kind:'seq-open',id:'64d9ecad463b7ffa9697e2ea',amount:1,before:1,skinIds:[(1000+index).toString(16).padStart(24,'0')]},resolution:{kind:'unresolved-opening'}}));
}

test('protected history does not consume the capacity of a newly reviewed execution',async t=>{
  const f=await consolidationFixture(t,{pro:true,noItems:true}),rows=protectedHistory(100);
  const service=createTokenConverter({...f.deps,store:{...f.deps.store,load:async()=>({version:1,rows:structuredClone(rows)})}});
  await service.ready();
  const preview=await service.prepare({action:'sequence',accountIds:['source'],steps:['sell'],independent:true});
  await service.start({action:'sequence',previewId:preview.previewId});
  const result=await settled(service);
  assert.equal(result.rows.length,101);
  assert.equal(result.rows.filter(row=>row.state==='unresolved').length,100);
  assert.equal(result.rows.at(-1).state,'confirmed');
  assert.deepEqual(f.saved().rows.slice(0,100),rows);
});

test('restart safely loads more than one hundred protected historical rows',async t=>{
  const f=await consolidationFixture(t,{pro:true,noItems:true}),rows=protectedHistory(125);
  const service=createTokenConverter({...f.deps,store:{...f.deps.store,load:async()=>({version:1,rows:structuredClone(rows)})}});
  await service.ready();
  assert.equal(service.status().rows.length,125);
  assert.equal(service.status().clearableCount,0);
  assert.deepEqual(f.saved().rows,rows);
});

test('a review exceeding the active account capacity fails before remote reads',async t=>{
  const f=await consolidationFixture(t,{pro:true,noItems:true});
  await assert.rejects(f.service.prepare({action:'sequence',accountIds:Array.from({length:101},(_,index)=>'source-'+index),steps:['sell'],independent:true}));
  assert.equal(f.requests.length,0);
});

test('confirmation exposes revalidation progress and a stop signal before any mutation',async t=>{
  let armed=false,release,entered;
  const held=new Promise(resolve=>release=resolve),entry=new Promise(resolve=>entered=resolve);
  const f=await consolidationFixture(t,{noItems:true,cases:1,beforeRequest:async({path})=>{if(armed&&path==='/api/me'){entered();await held;}}});
  const events=[],service=createTokenConverter({...f.deps,emit:event=>events.push(event.status)});
  const preview=await service.prepare({action:'sequence',independent:true,accountIds:['source'],steps:['sell']});
  armed=true;events.length=0;
  const starting=service.start({action:'sequence',previewId:preview.previewId}),rejected=assert.rejects(starting,/parad|cancelad/);
  await entry;
  try{
    assert.equal(service.active(),true);
    assert.equal(service.status().phase,'revalidating');
    assert.equal(service.status().preparation.kind,'revalidation');
    assert.equal(service.status().preparation.completed,0);
    assert.equal(service.status().preparation.total,1);
    assert.equal(events.some(status=>status.phase==='revalidating'),true);
    const signal=service.dispatchGuard().signal;
    assert.equal(signal.aborted,false);
    await service.stop();
    assert.equal(signal.aborted,true);
  }finally{await service.stop();release();await rejected;}
  assert.equal(service.active(),false);
  assert.equal(service.status().preparation,undefined);
  assert.equal(f.requests.some(request=>request.method!=='GET'),false);
});

test('a completed confirmation publishes per-account revalidation progress and clears it',async t=>{
  const f=await consolidationFixture(t,{noItems:true,cases:1}),events=[],service=createTokenConverter({...f.deps,emit:event=>events.push(event.status)});
  const preview=await service.prepare({action:'sequence',independent:true,accountIds:['source'],steps:['sell']});events.length=0;
  await service.start({action:'sequence',previewId:preview.previewId});
  await settled(service);
  const progress=events.filter(status=>status.phase==='revalidating').map(status=>status.preparation);
  assert.ok(progress.length>=2,'Confirmation must publish initial and completed progress');
  assert.equal(progress[0].total,1);
  assert.equal(progress[0].completed,0);
  assert.equal(progress.at(-1).completed,1);
  assert.equal(service.status().preparation,undefined);
});
