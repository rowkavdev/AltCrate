const test=require('node:test'),assert=require('node:assert/strict');
const {createRequestCoordinator}=require('../engine/requestCoordinator.cjs');
let createConverterApiFactory;try{({createConverterApiFactory}=require('../engine/converterNetwork.cjs'));}catch{}
function fixture(network){assert.equal(typeof createConverterApiFactory,'function');return createConverterApiFactory({requestWork:createRequestCoordinator(),coordinator:{cooldown:async()=>0,limit:async()=>{}},network});}

test('converter reads share the bounded request queue and retain their account route',async()=>{
 let active=0,maximum=0;const routed=[];
 const factory=fixture({fetch:async(account,path)=>{routed.push([account.id,path]);maximum=Math.max(maximum,++active);await new Promise(r=>setTimeout(r,5));active--;return new Response('[]');}});
 await Promise.all(Array.from({length:8},(_,i)=>factory({id:'a'+i}).converterCases()));
 assert.equal(maximum,2);assert.equal(routed.length,8);assert.deepEqual(new Set(routed.map(([id])=>id)),new Set(Array.from({length:8},(_,i)=>'a'+i)));
 assert.ok(routed.every(([,path])=>path==='/api/cases'));
});

test('a server rate limit prevents queued converter requests on other accounts from being sent',async()=>{
 let calls=0;const factory=fixture({fetch:async()=>{calls++;return new Response('{}',{status:429,headers:{'Retry-After':'60'}});}});
 const result=await Promise.allSettled(Array.from({length:8},(_,i)=>factory({id:'a'+i}).converterCases()));
 assert.ok(calls<=2);assert.ok(result.every(r=>r.status==='rejected'&&r.reason.status===429));
 assert.ok(result.slice(2).every(r=>r.reason.notSent===true&&r.reason.retryAt>Date.now()));
});

test('a stopped queued mutation is rejected before network dispatch',async()=>{
 assert.equal(typeof createConverterApiFactory,'function');const requestWork=createRequestCoordinator({maxInFlight:1});let release,calls=0,stopped=false;
 const blocker=requestWork.run({accountId:'other'},()=>new Promise(r=>{release=r;}));await new Promise(r=>setImmediate(r));
 const factory=createConverterApiFactory({requestWork,coordinator:{cooldown:async()=>0},network:{fetch:async()=>{calls++;return new Response('{}');}}});
 const pending=factory({id:'a'},{beforeSend:()=>{if(stopped)throw Object.assign(Error('stopped'),{stopped:true});}}).sellCase('a'.repeat(24),1);
 stopped=true;release();await blocker;await assert.rejects(pending,e=>e.stopped&&e.notSent);assert.equal(calls,0);
});

test('confirmation reads reach the existing verification priority before pending user requests',async()=>{
 const requestWork=createRequestCoordinator({maxInFlight:1}),seen=[];let release;
 const blocker=requestWork.run({accountId:'other'},()=>new Promise(r=>{release=r;}));await new Promise(r=>setImmediate(r));
 const factory=createConverterApiFactory({requestWork,coordinator:{cooldown:async()=>0},network:{fetch:async account=>{seen.push(account.id);return new Response('[]');}}});
 const normal=factory({id:'normal'}).converterCases(),verification=factory({id:'verification'},{priority:'verification'}).converterCases();
 release();await Promise.all([blocker,normal,verification]);assert.deepEqual(seen,['verification','normal']);
});

test('converter trade commands check stop at dispatch and leave cancellation available',async()=>{
 const {createConverterTradeTransport}=require('../engine/converterNetwork.cjs');let stopped=false,sends=0;
 const transport=createConverterTradeTransport({command:async(_account,_id,_kind,_item,controls)=>{stopped=true;await controls.beforeSend();controls.guard();sends++;}},()=>{if(stopped)throw Object.assign(Error('stopped'),{stopped:true});});
 await assert.rejects(transport.command({id:'a'},'trade','confirm'),e=>e.stopped);assert.equal(sends,0);
 await transport.command({id:'a'},'trade','delete');assert.equal(sends,1);
});

test('a second recovery service reads externally settled child transfers instead of cached pending data',async()=>{
 const {createInventoryTransfers}=require('../engine/inventoryTransfers.cjs');
 let record={operationId:'child',kind:'transfer',accountId:'a',destinationAccountId:'b',state:'confirmed',verified:true,ref:{itemId:'i'}};
 const service=createInventoryTransfers({store:{get:async()=>structuredClone(record)}});
 assert.equal((await service.verify('child')).state,'confirmed');record={...record,state:'cancelled'};
 assert.equal((await service.verify('child')).state,'cancelled');
});
test('captured per-account guards reject only the stopped queued request',async()=>{
 const queue=createRequestCoordinator({maxInFlight:1}),stopped=new Set(),sent=[];let release,current;
 const blocker=queue.run({accountId:'blocker'},()=>new Promise(resolve=>release=resolve));await new Promise(resolve=>setImmediate(resolve));
 const factory=createConverterApiFactory({requestWork:queue,coordinator:{cooldown:async()=>0},captureMutationGuard:()=>{const account=current;return ()=>{if(stopped.has(account))throw Object.assign(Error('stopped'),{stopped:true});};},network:{fetch:async account=>{sent.push(account.id);return new Response('{}');}}});
 current='a';const a=factory({id:'a'}).sellCase('a'.repeat(24),1);current='b';const b=factory({id:'b'}).sellCase('a'.repeat(24),1);stopped.add('a');release();await blocker;
 await assert.rejects(a,error=>error.stopped&&error.notSent);await b;assert.deepEqual(sent,['b']);
});
test('a captured cancellation signal interrupts reads and never cancels an already sent mutation',async()=>{
 const controller=new AbortController(),seen=[];
 const factory=createConverterApiFactory({requestWork:createRequestCoordinator(),coordinator:{cooldown:async()=>0},captureMutationGuard:()=>Object.assign(()=>{}, {signal:controller.signal}),network:{fetch:async(_account,_path,init)=>{seen.push(init.signal);return new Response('[]');}}});
 await factory({id:'a'}).converterCases();await factory({id:'a'}).sellCase('a'.repeat(24),1);assert.equal(seen[0],controller.signal);assert.equal(seen[1],undefined);
});
