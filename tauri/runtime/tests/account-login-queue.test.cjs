const test=require('node:test'),assert=require('node:assert/strict');
const {createLoginQueue}=require('../engine/accountLogin.cjs');
const accounts=[{id:'a',label:'A',email:'a@example.com',hasPassword:true},{id:'b',label:'B',email:'b@example.com',hasPassword:true},{id:'pending',label:'Pending',email:'p@example.com',hasPassword:false}];
test('logs into imported accounts serially, skipping active sessions and missing passwords',async()=>{
 assert.equal(typeof createLoginQueue,'function');let active=0,peak=0;const visited=[],events=[];
 const queue=createLoginQueue({list:async()=>accounts,isConnected:async a=>a.id==='b',login:async a=>{visited.push(a.id);peak=Math.max(peak,++active);await new Promise(r=>setImmediate(r));active--;return a;},emit:event=>events.push(event)});
 const result=await queue.start();assert.deepEqual(visited,['a']);assert.equal(peak,1);assert.equal(result.connected,1);assert.equal(result.alreadyConnected,1);assert.equal(result.withoutPassword,1);assert.equal(result.phase,'complete');assert.equal(events.at(-1).status.phase,'complete');
});
test('failed login pauses before any following account and restart skips validated accounts',async()=>{
 assert.equal(typeof createLoginQueue,'function');const visited=[];let fail=true;const connected=new Set();
 const queue=createLoginQueue({list:async()=>accounts,isConnected:async a=>connected.has(a.id),login:async a=>{visited.push(a.id);if(fail&&a.id==='b')throw Error('Login recusado');connected.add(a.id);return a;},emit(){}});
 const first=await queue.start();assert.equal(first.phase,'paused');assert.equal(first.accountId,'b');assert.deepEqual(visited,['a','b']);assert.equal(first.connected,1);
 fail=false;const next=await queue.start();assert.equal(next.phase,'complete');assert.deepEqual(visited,['a','b','b']);assert.equal(next.alreadyConnected,1);
});
test('stop aborts current login and never starts a following login',async()=>{
 assert.equal(typeof createLoginQueue,'function');const visited=[];let begun;const ready=new Promise(r=>begun=r);
 const queue=createLoginQueue({list:async()=>accounts,isConnected:async()=>false,login:(a,{signal})=>new Promise(resolve=>{visited.push(a.id);begun();signal.addEventListener('abort',()=>resolve(null),{once:true});}),emit(){}});
 const run=queue.start();await ready;await assert.rejects(()=>queue.start(),/curso/);queue.stop();const result=await run;assert.equal(result.phase,'stopped');assert.deepEqual(visited,['a']);
});

test('batch also verifies existing manually added accounts without importing credentials again',async()=>{
 const calls=[];const queue=createLoginQueue({list:async()=>[{id:'manual',label:'Existing session'},{id:'new',label:'Imported',email:'new@example.com',hasPassword:true}],isConnected:async account=>{calls.push(account.id);return account.id==='manual';},login:async a=>a,emit(){}});
 const result=await queue.start();assert.deepEqual(calls,['manual','new']);assert.equal(result.total,2);assert.equal(result.alreadyConnected,1);assert.equal(result.connected,1);
});

test('an authentication-required preflight opens login instead of pausing the queue',async()=>{
 const visited=[];
 const queue=createLoginQueue({list:async()=>accounts,isConnected:async account=>{
  if(account.id==='b')return true;
  throw Object.assign(Error('Esta conta precisa de login.'),{status:401,code:'AUTHENTICATION_REQUIRED'});
 },login:async account=>{visited.push(account.id);return account;},emit(){}});
 const result=await queue.start(['a','b']);
 assert.equal(result.phase,'complete');assert.equal(result.connected,1);assert.equal(result.alreadyConnected,1);assert.deepEqual(visited,['a']);
});

test('a preflight transport failure pauses without logging into any account',async()=>{
 let logins=0;
 const queue=createLoginQueue({list:async()=>accounts,isConnected:async()=>{throw Object.assign(Error('Serviço indisponível'),{status:503});},login:async()=>{logins++;},emit(){}});
 const result=await queue.start(['a']);assert.equal(result.phase,'paused');assert.equal(logins,0);assert.match(result.message,/indisponível/);
});
