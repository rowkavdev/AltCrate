const test=require('node:test'),assert=require('node:assert/strict');
test('account status refresh uses four readers concurrently without overlapping a second pass',async()=>{
 const {createAccountRefreshQueue}=await import('../src/accountRefresh.js');const calls=[];let active=0,peak=0,release;const gate=new Promise(r=>release=r);
 const queue=createAccountRefreshQueue({delayMs:0,refreshAccount:async id=>{calls.push(id);peak=Math.max(peak,++active);await gate;active--;}});
 const accounts=Array.from({length:12},(_,i)=>({id:'a'+i}));const first=queue.run(accounts),duplicate=queue.run(accounts);assert.equal(first,duplicate);const initial=calls.length;release();await first;assert.equal(initial,4);assert.equal(peak,4);assert.equal(new Set(calls).size,12);assert.equal(calls.length,12);
});
test('stop lets current reads finish and never queues more accounts',async()=>{
 const {createAccountRefreshQueue}=await import('../src/accountRefresh.js');const calls=[];let release;const gate=new Promise(r=>release=r);
 const queue=createAccountRefreshQueue({delayMs:0,refreshAccount:async id=>{calls.push(id);await gate;}});const run=queue.run(Array.from({length:20},(_,i)=>({id:'a'+i})));queue.stop();release();await run;assert.equal(calls.length,4);
});
