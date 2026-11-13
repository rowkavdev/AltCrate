const test=require('node:test'),assert=require('node:assert/strict');
const {createAccountSummaryReader}=require('../engine/accountSummary.cjs');
const base='../../casepilot/apps/web/src/';
const accounts=Array.from({length:5},(_,index)=>({id:'a'+index}));
test('overview refresh coalesces duplicate runs and publishes progressive results',async()=>{
 const {createAccountRefreshQueue}=await import(base+'accountRefresh.js');let release;const gate=new Promise(resolve=>release=resolve),calls=[],states=[];
 const queue=createAccountRefreshQueue({maxConcurrent:1,delayMs:0,onProgress:state=>states.push(state),refreshAccount:async id=>{calls.push(id);await gate;}});
 const run=queue.run(accounts);assert.equal(queue.run(accounts),run);assert.equal(calls.length,1);release();const result=await run;
 assert.equal(result.phase,'complete');assert.equal(result.succeeded,5);assert.equal(result.processed,5);assert.equal(new Set(calls).size,5);assert(states.some(state=>state.processed===2));
});
test('overview refresh stops on a shared 429 without querying remaining accounts',async()=>{
 const {createAccountRefreshQueue}=await import(base+'accountRefresh.js');const calls=[];const retryAt=Date.now()+60000;
 const queue=createAccountRefreshQueue({maxConcurrent:1,delayMs:0,continueOnError:true,refreshAccount:async id=>{calls.push(id);if(id==='a1')throw Object.assign(Error('Limited'),{status:429,retryAt});}});
 const status=await queue.run(accounts);assert.deepEqual(calls,['a0','a1']);assert.equal(status.phase,'paused');assert.equal(status.succeeded,1);assert.equal(status.failed,1);assert.equal(status.retryAt,retryAt);
});
test('stop interrupts the inter-account wait and preserves the completed reading',async()=>{
 const {createAccountRefreshQueue}=await import(base+'accountRefresh.js');const calls=[];let queue;
 queue=createAccountRefreshQueue({maxConcurrent:1,delayMs:60000,onProgress:state=>{if(state.processed===1)setTimeout(()=>queue.stop(),0);},refreshAccount:async id=>calls.push(id)});
 const result=await queue.run(accounts);assert.equal(result.phase,'stopped');assert.equal(result.succeeded,1);assert.deepEqual(calls,['a0']);
});
test('an expired individual session does not discard successful account readings',async()=>{
 const {createAccountRefreshQueue}=await import(base+'accountRefresh.js');const queue=createAccountRefreshQueue({maxConcurrent:1,delayMs:0,continueOnError:true,refreshAccount:async id=>{if(id==='a1')throw Object.assign(Error('Expired'),{status:401});}});
 const result=await queue.run(accounts);assert.equal(result.phase,'complete');assert.equal(result.succeeded,4);assert.equal(result.failed,1);
});
test('failed reads retain cached values and unknown fields are not represented as observed zeroes',async()=>{
 const {observedSnapshot,failedSnapshot,overviewReadings}=await import(base+'accountReadState.js');
 const before=observedSnapshot({money:12,tokens:0,casesTotal:7},1000),failed=failedSnapshot(before,Object.assign(Error('Limited'),{status:429,retryAt:5000}));
 assert.equal(failed.money,12);assert.equal(failed.tokens,0);assert.equal(failed.observedAt,before.observedAt);assert.equal(failed.refreshError.status,429);
 const result=overviewReadings([{id:'a'},{id:'b'},{id:'c'}],{a:failed,b:{tokens:2.5},c:{error:'Failed'},removed:{tokens:999}});
 assert.deepEqual(result.fields.money,{value:12,count:1});assert.deepEqual(result.fields.tokens,{value:2.5,count:2});assert.equal(result.read,2);assert.equal(result.failed,2);
 assert(!observedSnapshot(failed,2000).refreshError);
});
test('cached summary persists timestamps and excludes credentials and error payloads',async()=>{
 const {accountSummaryCache}=await import(base+'accountSummaryCache.js');
 const result=accountSummaryCache({a:{money:1,tokens:0,casesTotal:0,observedAt:'2026-10-15T10:00:00.000Z',refreshError:{message:'secret'},session:{token:'secret'}}});
 assert.deepEqual(result,{a:{money:1,tokens:0,casesTotal:0,observedAt:'2026-10-15T10:00:00.000Z'}});
});
test('structured summary errors cross IPC with safe limit metadata, preserving the legacy result',async()=>{
 const snapshot={money:1,tokens:2,casesTotal:3};let limited=false;
 const read=createAccountSummaryReader({listAccounts:async()=>accounts,read:async()=>{if(limited)throw Object.assign(Error('secret token and body'),{status:429,stack:'secret'});return snapshot;},cooldown:async()=>9000,now:()=>1000});
 assert.deepEqual(await read('a0'),snapshot);assert.deepEqual(await read('a0',{structured:true}),{ok:true,snapshot});limited=true;
 const result=await read('a0',{structured:true});assert.equal(result.ok,false);assert.equal(result.error.status,429);assert.equal(result.error.retryAt,9000);assert(!JSON.stringify(result).includes('secret'));
 await assert.rejects(read('a0'),/secret token/);
});
test('a verification challenge stops subsequent account reads',async()=>{
 const {createAccountRefreshQueue}=await import(base+'accountRefresh.js');let calls=0;
 const queue=createAccountRefreshQueue({maxConcurrent:1,delayMs:0,continueOnError:true,refreshAccount:async()=>{calls++;throw Object.assign(Error('Verify'),{status:403});}});
 const result=await queue.run(accounts);assert.equal(calls,1);assert.equal(result.phase,'paused');
});
test('consecutive unavailable sessions pause the batch instead of trying every account',async()=>{
 const {createAccountRefreshQueue}=await import(base+'accountRefresh.js');let count=0;
 const queue=createAccountRefreshQueue({maxConcurrent:1,delayMs:0,continueOnError:true,maxConsecutiveErrors:3,refreshAccount:async()=>{count++;throw Error('Offline');}});
 const result=await queue.run(accounts);assert.equal(count,3);assert.equal(result.phase,'paused');
});
test('snapshot errors honor the longer retry header and a 429 from either read',async()=>{
 const {createCaseApi}=require('../engine/api.cjs');
 const api=createCaseApi(async endpoint=>new Response('{}',{status:endpoint==='/api/me'?403:429,headers:endpoint==='/api/me'?{}:{'Retry-After':'1','X-Retry-After':'7'}}));
 await assert.rejects(api.snapshot(),error=>error.status===429&&error.retryAfter==='7'&&error.endpoint==='/api/cases');
});
test('parallel failures preserve the server deadline while in-flight reads drain',async()=>{
 const {createAccountRefreshQueue}=await import(base+'accountRefresh.js');const releases={},calls=[];
 const queue=createAccountRefreshQueue({maxConcurrent:4,delayMs:0,continueOnError:true,refreshAccount:async id=>{calls.push(id);await new Promise(resolve=>releases[id]=resolve);if(id==='a0')throw Object.assign(Error('Limited'),{status:429,retryAt:9000});if(id==='a1')throw Object.assign(Error('Expired'),{status:401});if(id==='a2')throw Object.assign(Error('Verify'),{status:403});},now:()=>1000});
 const run=queue.run(accounts);assert.equal(calls.length,4);releases.a0();await new Promise(resolve=>setImmediate(resolve));releases.a1();releases.a2();releases.a3();
 const status=await run;assert.equal(status.phase,'paused');assert.equal(status.retryAt,9000);assert.equal(status.errorStatus,429);assert.deepEqual(calls,['a0','a1','a2','a3']);assert.equal(status.succeeded,1);assert.equal(status.failed,3);
});
