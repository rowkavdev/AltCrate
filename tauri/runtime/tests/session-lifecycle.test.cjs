'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createNetwork}=require('../engine/nativeNetwork.cjs');
const {createAccountSessionManager}=require('../engine/accountSessions.cjs');
const {describeSession}=require('../engine/sessionState.cjs');
test('renewed cookies remain encrypted, account isolated and reusable after restart; HTTP limits preserve the session',async t=>{
 const dataDirectory=await fs.mkdtemp(path.join(os.tmpdir(),'casepilot-session-life-'));
 const configuration={dataDirectory,vaultKey:crypto.randomBytes(32).toString('base64')};
 let cookies=[{name:'__Secure-better-auth.session_token',value:'private-fixture-first',domain:'case-clicker.com',path:'/',secure:true,httpOnly:true,expirationDate:Date.now()/1000+3600}];
 let status=200;const events=[];
 const network=createNetwork({configuration,onSessionChanged:(partition,session)=>events.push({partition,session}),nativeRequest:async(method,args)=>{
  if(method==='session.prepare')return {userAgent:'Fixture Chromium'};
  if(method==='login.cookies')return args.partition==='persist:a'?cookies:[];
  if(method==='login.fetch')return {status,headers:{},body:Buffer.from(JSON.stringify({session:{expiresAt:new Date(Date.now()+86400000).toISOString(),token:'private-response-token'},user:{email:'fixture@example.invalid'}})).toString('base64')};
  return null;
 }});
 let restarted;t.after(async()=>{await network.close();await restarted?.close();await fs.rm(dataDirectory,{recursive:true,force:true});});
 const local=network.sessions.fromPartition('persist:a');assert((await local.restoreSession()).reusable);
 const manager=createAccountSessionManager({list:()=>[{id:'a',partition:'persist:a',email:'fixture@example.invalid'}],sessionFor:partition=>network.sessions.fromPartition(partition),fetchSession:()=>local.fetch('https://case-clicker.com/api/auth/get-session')});
 cookies=[{...cookies[0],value:'private-fixture-rotated',expirationDate:Date.now()/1000+86400}];
 assert.equal((await manager.refresh((await manager.list())[0])).state,'connected');
 status=429;await assert.rejects(manager.refresh((await manager.list())[0]),error=>error.status===429);assert((await local.status()).reusable);
 const published=JSON.stringify(events);assert(!published.includes('private-'));assert(!JSON.stringify(await manager.list()).includes('private-'));
 for(const file of await fs.readdir(path.join(dataDirectory,'sessions')))assert(!(await fs.readFile(path.join(dataDirectory,'sessions',file))).includes(Buffer.from('private-')));
 restarted=createNetwork({configuration,nativeRequest:async()=>null});
 assert((await restarted.sessions.fromPartition('persist:a').status()).reusable);assert.equal((await restarted.sessions.fromPartition('persist:a').cookies.get({name:cookies[0].name}))[0].value,'private-fixture-rotated');
 assert.equal((await restarted.sessions.fromPartition('persist:b').status()).hasToken,false);
 status=401;assert.equal((await manager.refresh((await manager.list())[0])).reusable,false);
});
test('expiry and server invalidation require login, verification preserves tokens, transient balance failures do not affect pending logins',async()=>{
 const now=Date.now(),cookie={name:'__Secure-better-auth.session_token',value:'private',expirationDate:(now+86400000)/1000};
 assert.equal(describeSession([cookie],{requiresLogin:true},now).reusable,false);
 assert.equal(describeSession([cookie],{requiresVerification:true},now).state,'verification');
 assert.equal(describeSession([cookie],{serverExpiresAt:now-1,browserSession:true},now).state,'expired');
 assert.equal(describeSession([cookie],{lastRefreshedAt:now-86400001},now).refreshDue,true);
 const {pendingLoginIds}=await import('../../casepilot/apps/web/src/accountSessions.js');
 assert.deepEqual(pendingLoginIds([{id:'saved',session:describeSession([cookie],{},now)},{id:'missing',session:describeSession([],{},now)}],{saved:{error:'HTTP 429'}}),['missing']);
});
test('summary cache persists only bounded balance fields and never credentials or full response bodies',async()=>{
 const {accountSummaryCache}=await import('../../casepilot/apps/web/src/accountSummaryCache.js');
 const cached=accountSummaryCache({a:{money:10,tokens:20,casesTotal:30,session:{token:'secret'},user:{password:'secret'},cases:[{id:'one',name:'Fixture',quantity:2,token:'secret'}]},b:{error:'HTTP 429'}});
 assert.deepEqual(cached,{a:{money:10,tokens:20,casesTotal:30,cases:[{id:'one',name:'Fixture',quantity:2}]}});assert.deepEqual(accountSummaryCache([]),{});
});
test('session maintenance is serial, skips healthy recent tokens, and stops immediately on a server limit',async()=>{
 const visited=[];let active=0,peak=0;
 const manager=createAccountSessionManager({list:()=>['recent','due','limited','later'].map(id=>({id,partition:id})),sessionFor:id=>({status:async()=>({reusable:true,refreshDue:id!=='recent',state:'saved'}),prepareBrowser:async()=>{},markAuthenticated:async()=>({reusable:true}),markNeedsLogin:async()=>({reusable:false})}),fetchSession:async account=>{visited.push(account.id);peak=Math.max(peak,++active);await new Promise(resolve=>setImmediate(resolve));active--;return {ok:account.id!=='limited',status:account.id==='limited'?429:200,json:async()=>({session:{expiresAt:new Date(Date.now()+86400000).toISOString()},user:{}})};},delay:async()=>{}});
 await Promise.all([manager.runDue(),manager.runDue()]);assert.deepEqual(visited,['due','limited']);assert.equal(peak,1);
});
test('batch logins are paced without extra validation requests for saved sessions',async()=>{
 const {createLoginQueue}=require('../engine/accountLogin.cjs');let clock=0;const starts=[],waits=[];
 const queue=createLoginQueue({list:()=>[{id:'saved'},{id:'a',hasPassword:true},{id:'b',hasPassword:true}],isConnected:async account=>account.id==='saved',login:async account=>{starts.push([account.id,clock]);return account;},emit(){},minIntervalMs:5000,now:()=>clock,wait:async ms=>{waits.push(ms);clock+=ms;}});
 const result=await queue.start();assert.equal(result.alreadyConnected,1);assert.deepEqual(starts,[['a',0],['b',5000]]);assert.deepEqual(waits,[5000]);
});
