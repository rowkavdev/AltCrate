'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {sessionRateLimit}=require('../engine/authRateLimit.cjs');
const {createLoginProbe,createLoginQueue}=require('../engine/accountLogin.cjs');
test('rate limits honor both server headers and retain the longest deadline without secrets',()=>{
 const response=new Response(null,{status:429,headers:{'Retry-After':'2','X-Retry-After':'12','set-cookie':'secret=fixture'}});
 const error=sessionRateLimit(response,{now:1000});assert.equal(error.retryAt,13000);assert.equal(error.rateLimit.source,'X-Retry-After');assert.equal(error.safeToRetry,true);assert(!JSON.stringify(error).includes('secret'));
 assert.equal(sessionRateLimit(new Response(null,{status:429}),{now:0}).retryAt,300000);
 const date=new Date(30000).toUTCString();assert.equal(sessionRateLimit(new Response(null,{headers:{'Retry-After':date}}),{now:1000}).retryAt,30000);
});
test('navigation checks share one in-flight validation and never bypass the interval',async()=>{
 let calls=0,done;const pending=new Promise(resolve=>done=resolve);let clock=0;
 const probe=createLoginProbe({automatic:true,step:async()=> 'other-page',minIntervalMs:5000,now:()=>clock,validate:async()=>{calls++;await pending;return {ok:true};}});
 const checks=Array.from({length:4},()=>probe.check({force:true}));await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);done();await Promise.all(checks);
 await probe.check({force:true});assert.equal(calls,1);clock=5000;await probe.check({force:true});assert.equal(calls,2);
});
test('429 after a token is created waits then validates that token; credentials are submitted once',async()=>{
 let clock=0,hasToken=false,validated=false,logins=0,reads=0;const events=[],waits=[];
 const queue=createLoginQueue({list:()=>[{id:'a',label:'Fixture',hasPassword:true}],now:()=>clock,emit:event=>events.push(event),
  isConnected:async()=>{if(!hasToken)return false;reads++;validated=true;return true;},
  login:async()=>{logins++;hasToken=true;throw sessionRateLimit(new Response(null,{status:429,headers:{'X-Retry-After':'12'}}),{now:clock});},
  wait:async ms=>{waits.push(ms);clock+=ms;},
 });
 const result=await queue.start();assert.equal(result.phase,'complete');assert.equal(logins,1);assert.equal(reads,1);assert(validated);assert.deepEqual(waits,[12000]);assert(events.some(event=>event.status.stage==='waiting'&&event.status.waitUntil===12000));
});
test('stopping during server cooldown aborts the wait and does not retry validation or login',async()=>{
 let waiting,logins=0;const ready=new Promise(resolve=>waiting=resolve);
 const queue=createLoginQueue({list:()=>[{id:'a',hasPassword:true}],isConnected:async()=>false,login:async()=>{logins++;throw sessionRateLimit(new Response(null,{status:429}));},emit(){},wait:(_ms,signal)=>new Promise((resolve,reject)=>{waiting();signal.addEventListener('abort',()=>reject(signal.reason),{once:true});})});
 const run=queue.start();await ready;queue.stop();assert.equal((await run).phase,'stopped');assert.equal(logins,1);
});
test('repeated server limits stop after the bounded retry count and never submit credentials on a validation-only retry',async()=>{
 let clock=0,reads=0,logins=0;
 const queue=createLoginQueue({list:()=>[{id:'a',hasPassword:true}],isConnected:async()=>{reads++;throw sessionRateLimit(new Response(null,{status:429,headers:{'Retry-After':'2'}}),{now:clock});},login:async()=>logins++,emit(){},now:()=>clock,wait:async ms=>clock+=ms,maxRateLimitRetries:2});
 const result=await queue.start();assert.equal(result.phase,'paused');assert.equal(reads,3);assert.equal(logins,0);assert.equal(clock,4000);
});
test('pending validation remains encrypted across restart and still appears in the login queue',async t=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');const {createNetwork}=require('../engine/nativeNetwork.cjs');
 const dataDirectory=await fs.mkdtemp(path.join(os.tmpdir(),'casepilot-pending-validation-')),configuration={dataDirectory,vaultKey:crypto.randomBytes(32).toString('base64')};
 const network=createNetwork({configuration,nativeRequest:async()=>null});let restart;t.after(async()=>{await network.close();await restart?.close();await fs.rm(dataDirectory,{recursive:true,force:true});});
 const local=network.sessions.fromPartition('a');await local.cookies.set({name:'__Secure-better-auth.session_token',value:'private-token-fixture',domain:'case-clicker.com',secure:true});await local.markValidationPending();
 restart=createNetwork({configuration,nativeRequest:async()=>null});const status=await restart.sessions.fromPartition('a').status();assert.equal(status.state,'validating');assert(status.reusable);assert(status.validationPending);
 const {pendingLoginIds}=await import('../../casepilot/apps/web/src/accountSessions.js');assert.deepEqual(pendingLoginIds([{id:'a',session:status}],{}),['a']);
 await restart.sessions.fromPartition('a').markAuthenticated();assert.equal((await restart.sessions.fromPartition('a').status()).validationPending,false);
});
test('unexpected successful validation payloads preserve the token and stop before another credential submission',async()=>{
 const {createAccountSessionManager}=require('../engine/accountSessions.cjs');let invalidated=0;
 const manager=createAccountSessionManager({list:()=>[],sessionFor:()=>({status:async()=>({reusable:true}),prepareBrowser:async()=>{},markNeedsLogin:async()=>invalidated++}),fetchSession:async()=>new Response(JSON.stringify({message:'unexpected'}),{headers:{'content-type':'application/json'}})});
 await assert.rejects(manager.refresh({partition:'a'}),/conservada/);assert.equal(invalidated,0);
});
