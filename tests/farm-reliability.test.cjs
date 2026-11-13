const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {createServerLedger}=require('../electron/serverFarmLedger.cjs');
const {probeGameRoute,checkGameRoutes,RECOVERABLE,recoveryDelay}=require('../electron/serverFarmHealth.cjs');
test('rolling performance retains confirmed cases through restart and migration, with exact window boundaries',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'farm-performance-'));let at=Date.now(),ledger=createServerLedger(dir,{now:()=>at});
 try{await ledger.ready();ledger.performance('a');const start=at;
  const award=(delta,status=200)=>ledger.record({type:'request',accountId:'a',kind:'case',httpStatus:status,verifiedDelta:delta,at:new Date(at).toISOString()});
  award(25);at+=60000;award(50);award(null);award(999,429);ledger.record({type:'request',accountId:'a',kind:'money',httpStatus:200,verifiedDelta:100,at:new Date(at).toISOString()});
  assert.equal(ledger.performance('a').casesPerMinute5,75);assert.equal(ledger.performance('a').cases5,75);assert.equal(ledger.results('a').case,75);
  ledger.flush();ledger=createServerLedger(dir,{now:()=>at});await ledger.ready();assert.equal(ledger.performance('a').cases5,75);
  const exported=ledger.export();ledger.restore(exported);assert.equal(ledger.performance('a').cases5,75);assert.equal(ledger.results('a').unconfirmedRequests,1);
  at=start+300000;assert.equal(ledger.performance('a').cases5,50);assert.equal(ledger.performance('a').casesPerMinute5,10);
  at=start+1800001;assert.equal(ledger.performance('a').cases30,50);at=start+1860000;assert.equal(ledger.performance('a').cases30,0);assert.equal(ledger.results('a').case,75);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('30 minute performance outlives the bounded event feed and does not count a replay twice',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'farm-performance-feed-'));let at=Date.now();
 try{let l=createServerLedger(dir,{now:()=>at,checkpointEvery:6000});await l.ready();l.performance('a');l.record({type:'request',accountId:'a',kind:'case',httpStatus:200,verifiedDelta:25,at:new Date(at).toISOString()});
  for(let i=0;i<5100;i++)l.record({type:'account-error',accountId:'a',at:new Date(at+1).toISOString()});at+=60000;l.flush();assert.equal(l.events().length,5000);assert.equal(l.performance('a').cases30,25);
  l=createServerLedger(dir,{now:()=>at});await l.ready();assert.equal(l.performance('a').cases30,25);assert.equal(l.results('a').case,25);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('invalid performance imports do not alter the existing ledger',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'farm-performance-invalid-'));
 try{const l=createServerLedger(dir);await l.ready();l.record({type:'request',accountId:'a',kind:'case',httpStatus:200,verifiedDelta:25,at:new Date().toISOString()});const bad=l.export();bad.performance.accounts.a.awards=[[Date.now(),-1]];assert.throws(()=>l.restore(bad));assert.equal(l.results('a').case,25);}
 finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('route checks keep certificates enabled, send no cookies and distinguish challenges from connectivity',async()=>{
 let options,destroyed=false;
 function request(opts,reply){options=opts;const req=new EventEmitter();req.end=()=>{const res=new EventEmitter();res.statusCode=403;res.headers={'cf-mitigated':'challenge'};res.destroy=()=>{destroyed=true;};reply(res);};return req;}
 const result=await probeGameRoute({id:'direct',family:4},{request});assert.equal(result.ok,false);assert.equal(result.challenged,true);assert.equal(options.rejectUnauthorized,true);assert.equal(options.method,'GET');assert.equal(options.path,'/');assert.equal(options.headers.Cookie,undefined);assert.equal(destroyed,true);
 const timeout=await probeGameRoute({id:'direct',family:4},{timeoutMs:5,request:()=>{const req=new EventEmitter();req.end=()=>{};req.destroy=()=>{};return req;}});assert.equal(timeout.errorCode,'ETIMEDOUT');
});
test('route diagnostics bound parallelism and keep every route result',async()=>{
 let active=0,max=0;const routes=Array.from({length:13},(_,i)=>({id:'r'+i,family:4}));const result=await checkGameRoutes(routes,{probe:async route=>{max=Math.max(max,++active);await new Promise(r=>setTimeout(r,1));active--;return {routeId:route.id,ok:route.id!=='r4'};}});assert.equal(max,4);assert.equal(result.total,13);assert.equal(result.healthy,12);
});
test('network recovery uses bounded progressive delays and excludes invalid certificates',()=>{
 assert.ok(recoveryDelay('a')>=30000&&recoveryDelay('a')<40000);assert.ok(recoveryDelay('a',1)>recoveryDelay('a'));assert.ok(recoveryDelay('a',99)<310000);assert.equal(RECOVERABLE.has('SELF_SIGNED_CERT_IN_CHAIN'),false);assert.equal(RECOVERABLE.has('ERR_CERT_AUTHORITY_INVALID'),false);
});
async function pausedWorker(work){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'farm-recovery-'));let worker;
 try{const account={id:'a',label:'A',cookies:[{name:'auth',value:'test',domain:'case-clicker.com',path:'/'}]};await fs.writeFile(path.join(dir,'sessions.json'),JSON.stringify([account]));await fs.writeFile(path.join(dir,'desired.json'),JSON.stringify({active:true,selected:['a']}));await fs.writeFile(path.join(dir,'farm-state.json'),JSON.stringify({accounts:{a:{paused:true,modes:{case:false,money:false,vault:false}}}}));await fs.writeFile(path.join(dir,'network-retries.json'),JSON.stringify({a:1}));const time=Date.now();await fs.writeFile(path.join(dir,'rate-state.json'),JSON.stringify({accountBudgets:{a:{budgets:{case:{windowStart:time,used:75},money:{windowStart:time,used:0}},combined:{windowStart:time,used:75},cooldownUntil:0}}}));
  const {createServerWorker}=require('../electron/serverFarmWorker.cjs');worker=await work.create(dir,createServerWorker);await work.check(worker,dir);
 }finally{await worker?.close();await fs.rm(dir,{recursive:true,force:true});}
}
test('a paused account resumes only after a successful read, with no recovery mutations',()=>pausedWorker({create:(directory,create)=>create({directory,apiFactory:()=>({snapshot:async()=>({money:0,cases:[],casesTotal:0,casesPerClick:33.65})})}),check:async (worker,dir)=>{assert.equal(worker.status().accounts[0].paused,true);await worker.maintain();assert.equal(worker.status().accounts[0].paused,false);assert.equal(worker.status().accounts[0].networkRetryAt,0);const rate=JSON.parse(await fs.readFile(path.join(dir,'rate-state.json')));assert.equal(rate.accountBudgets.a.budgets.case.used,75);}}));
test('a failed recovery read respects the server deadline and preserves all budgets',()=>pausedWorker({create:(directory,create)=>create({directory,apiFactory:()=>({snapshot:async()=>{throw Object.assign(Error('Limited'),{status:429,retryAfter:'600'});}})}),check:async (worker,dir)=>{await worker.maintain();const a=worker.status().accounts[0];assert.equal(a.paused,true);assert.ok(a.networkRetryAt>=Date.now()+590000);const rate=JSON.parse(await fs.readFile(path.join(dir,'rate-state.json')));assert.ok(rate.accountBudgets.a.cooldownUntil>=Date.now()+590000);}}));
test('stopping during a recovery read prevents a late resume',()=>{
 let resolve,started;const ready=new Promise(r=>started=r),gate=new Promise(r=>resolve=r);
 return pausedWorker({create:(directory,create)=>create({directory,apiFactory:()=>({snapshot:()=>{started();return gate;}})}),check:async worker=>{const recovery=worker.maintain();await ready;await worker.request({op:'stop'});resolve({money:0,cases:[],casesTotal:0});await recovery;assert.equal(worker.status().accounts[0].paused,true);}});
});
test('invalid TLS during recovery stays paused for manual review',()=>pausedWorker({create:(directory,create)=>create({directory,apiFactory:()=>({snapshot:async()=>{throw Object.assign(Error('Invalid TLS'),{code:'SELF_SIGNED_CERT_IN_CHAIN'});}})}),check:async worker=>{await worker.maintain();assert.equal(worker.status().accounts[0].paused,true);assert.equal(worker.status().accounts[0].networkRetryAt,0);}}));
test('the UI distinguishes stale readings, expected quota waits and actual missing earnings',async()=>{
 const {farmCaseProgress,farmPerformanceSummary,farmAccountState}=await import('../src/farmViewModel.js');const now=Date.now();const entry={id:'a',selected:true,modes:{case:true},performance:{measuredAt:now,lastCaseAt:now-600001,observedSeconds30:1000,casesPerMinute5:0,casesPerMinute30:1}};const status={phase:'running',accounts:[entry]};assert.equal(farmCaseProgress(entry,status,now),'stalled');assert.equal(farmPerformanceSummary(status,now).stalled,1);entry.budget={cooldownUntil:now+1000};assert.equal(farmCaseProgress(entry,status,now),'measured');status.execution={kind:'server',connected:false};assert.equal(farmCaseProgress(entry,status,now),'stale');assert.equal(farmPerformanceSummary(status,now).stalled,0);assert.equal(farmAccountState({...entry,paused:true,networkRetryAt:now+1000},status,now).key,'waiting');
});
test('game route checks do not block farm controls or start account requests',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'farm-network-control-'));let worker,release;const gate=new Promise(r=>release=r);let mutations=0;
 try{const {createServerWorker}=require('../electron/serverFarmWorker.cjs');worker=await createServerWorker({directory:dir,networkProbe:()=>gate,apiFactory:()=>({snapshot:async()=>{mutations++;}})});
  const checking=worker.request({op:'network-check'});const stopped=await Promise.race([worker.request({op:'stop'}),new Promise((_,reject)=>setTimeout(()=>reject(Error('Diagnostics blocked stop')),100))]);assert.ok(['stopped','idle'].includes(stopped.status.phase));assert.equal(mutations,0);release({routeId:'direct',family:4,ok:true});assert.equal((await checking).networkCheck.healthy,1);
 }finally{release?.({routeId:'direct',family:4,ok:true});await worker?.close();await fs.rm(dir,{recursive:true,force:true});}
});
