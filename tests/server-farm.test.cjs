const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
test('desktop monitoring reuses a verified SSH connection instead of opening one per poll',async()=>{
 const {EventEmitter}=require('node:events');const {createServerSsh}=require('../electron/serverFarmSsh.cjs');let args;
 const rpc=createServerSsh({profile:{host:'home.example',user:'farmer',keyPath:'/tmp/key',knownHostsPath:'/tmp/hosts'},spawnProcess:(_program,a)=>{args=a;const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();child.stdin.end=()=>queueMicrotask(()=>{child.stdout.emit('data','{"status":{"phase":"running"}}');child.emit('close',0);});return child;}});
 await rpc({op:'status'});assert.ok(args.includes('ControlMaster=auto'));assert.ok(args.includes('ControlPersist=600'));assert.ok(args.some(a=>a.startsWith('ControlPath=')));assert.ok(args.includes('StrictHostKeyChecking=yes'));
});
test('server transport limits endpoints and sends only matching unexpired cookies',()=>{
 const {cookieHeader,validateRequest}=require('../electron/serverFarmTransport.cjs');
 const cookies=[{name:'auth',value:'secret',domain:'.case-clicker.com',path:'/',secure:true},{name:'other',value:'wrong',domain:'evil.test',path:'/'},{name:'old',value:'expired',domain:'case-clicker.com',path:'/',expirationDate:1},{name:'restricted',value:'private',domain:'case-clicker.com',path:'/api/auth'}];
 assert.equal(cookieHeader(cookies,'/api/me',Date.now()),'auth=secret');
 assert.throws(()=>validateRequest('/api/trade',{method:'POST'}));assert.throws(()=>validateRequest('https://evil.test/api/me',{}));assert.throws(()=>validateRequest('/api/me',{method:'POST'}));assert.throws(()=>validateRequest('/api/caseClick',{method:'POST',body:'{"clicks":1001}'}));
 assert.equal(validateRequest('/api/vault',{method:'POST'}).method,'POST');
});
test('durable ledger retains only confirmed awards and survives reload',async()=>{
 const {createServerLedger}=require('../electron/serverFarmLedger.cjs');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'farm-ledger-'));
 try{let ledger=createServerLedger(dir);await ledger.ready();await ledger.record({type:'request',accountId:'a',kind:'case',httpStatus:200,verifiedDelta:25,at:new Date().toISOString()});await ledger.record({type:'vault',accountId:'a',httpStatus:200,confirmedDelta:null});ledger=createServerLedger(dir);await ledger.ready();assert.equal(ledger.results('a').case,25);assert.equal(ledger.results('a').vault,0);assert.equal(ledger.results('a').unconfirmedRequests,1);assert.equal(ledger.events().length,2);}finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('incremental ledger recovers legacy results and journal without rewriting history per award',async()=>{
 const {createServerLedger}=require('../electron/serverFarmLedger.cjs');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'farm-journal-'));
 try{const checkpoint={sequence:10,accounts:{a:{case:100,money:0,vault:0,confirmedRequests:4,unconfirmedRequests:0}},events:[]};await fs.writeFile(path.join(dir,'results.json'),JSON.stringify(checkpoint));let ledger=createServerLedger(dir);await ledger.ready();ledger.record({type:'request',accountId:'a',kind:'case',httpStatus:200,verifiedDelta:25});assert.equal(JSON.parse(await fs.readFile(path.join(dir,'results.json'))).sequence,10);ledger=createServerLedger(dir);await ledger.ready();assert.equal(ledger.results('a').case,125);assert.equal(ledger.sequence(),11);
  await fs.appendFile(path.join(dir,'results.journal'),'partial');ledger=createServerLedger(dir);await ledger.ready();ledger.record({type:'request',accountId:'a',kind:'case',httpStatus:200,verifiedDelta:25});ledger=createServerLedger(dir);await ledger.ready();assert.equal(ledger.results('a').case,150);await ledger.reset();ledger=createServerLedger(dir);await ledger.ready();assert.equal(ledger.results('a').case,0);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('seven slow accounts leave a read slot for another server account',async()=>{
 const {createWorkerSnapshots}=require('../electron/serverFarmWorker.cjs');let release;const gate=new Promise(r=>release=r);const reader=createWorkerSnapshots({apiForAccount:a=>({snapshot:()=>a.id==='fast'?Promise.resolve({casesTotal:123}):gate})});
 const slow=Array.from({length:7},(_,i)=>reader.read({id:'slow'+i},{fresh:true}));try{const fast=await Promise.race([reader.read({id:'fast'},{fresh:true}),new Promise((_,reject)=>setTimeout(()=>reject(Error('A slow account blocked the remaining read slot')),100))]);assert.equal(fast.casesTotal,123);}finally{release({casesTotal:0});await Promise.all(slow);}
});
test('a completed checkpoint cannot replay duplicate journal awards after restart',async()=>{
 const {createServerLedger}=require('../electron/serverFarmLedger.cjs');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'farm-checkpoint-'));
 try{let ledger=createServerLedger(dir,{checkpointEvery:2});await ledger.ready();ledger.record({type:'request',accountId:'a',kind:'case',httpStatus:200,verifiedDelta:25});const first=await fs.readFile(path.join(dir,'results.journal'));ledger.record({type:'request',accountId:'a',kind:'case',httpStatus:200,verifiedDelta:25});await fs.writeFile(path.join(dir,'results.journal'),first);ledger=createServerLedger(dir);await ledger.ready();assert.equal(ledger.results('a').case,50);assert.equal(ledger.sequence(),2);}finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('migration drains local work before collecting sessions, and validates before starting',async()=>{
 const {createRemoteFarm}=require('../electron/remoteFarm.cjs');let order=[];let enabled=false;
 const local={stop(){order.push('stop');},status(){return {phase:'stopped',accounts:[]};},ready:async()=>{},};
 const remote=createRemoteFarm({local,readConfig:async()=>({enabled}),writeConfig:async c=>{enabled=c.enabled;order.push('persist');},preparePayload:async()=>{order.push('sessions');return {accounts:[{id:'a'}]};},rpc:async request=>{order.push(request.op);return request.op==='import'?{validated:1,status:{phase:'idle',accounts:[{id:'a'}]}}:{status:{phase:'running',accounts:[{id:'a'}]}};}});
 await remote.ready();await remote.migrate(['a']);assert.deepEqual(order,['stop','sessions','persist','import','persist']);assert.equal(remote.status().execution.kind,'server');
});
test('remote connection loss never falls back to a local start or reports fresh status',async()=>{
 const {createRemoteFarm}=require('../electron/remoteFarm.cjs');let localStarts=0;let failed=false;
 const remote=createRemoteFarm({local:{start(){localStarts++;},status(){return {phase:'idle',accounts:[]};}},readConfig:async()=>({enabled:true}),writeConfig:async()=>{},rpc:async()=>{if(failed)throw Error('disconnected');return {status:{phase:'running',accounts:[{id:'a'}]}};}});
 await remote.ready();failed=true;await assert.rejects(remote.start(['a']));await remote.refresh();assert.equal(localStarts,0);assert.equal(remote.status().execution.connected,false);assert.equal(remote.status().phase,'running');
});
test('failed import cannot enable remote farming or start accepted mutations',async()=>{
 const {createRemoteFarm}=require('../electron/remoteFarm.cjs');let enabled=false,started=false;
 const remote=createRemoteFarm({local:{stop(){},status(){return {phase:'stopped',accounts:[]};}},readConfig:async()=>({enabled:false}),writeConfig:async c=>{enabled=c.enabled===true;},preparePayload:async()=>({accounts:[{id:'a'}]}),rpc:async r=>{if(r.op==='start')started=true;throw Error('Session unavailable');}});
 await remote.ready();await assert.rejects(remote.migrate(['a']));assert.equal(enabled,false);assert.equal(started,false);
});
test('worker imports validated sessions without farming and keeps inherited server deadlines',async()=>{
 const {createServerWorker}=require('../electron/serverFarmWorker.cjs');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'farm-worker-'));let mutations=0;let worker;
 const cooldownUntil=Date.now()+60000;
 try{worker=await createServerWorker({directory:dir,apiFactory:()=>({snapshot:async()=>({money:0,cases:[],casesTotal:0,casesPerClick:33.65}),generate:async()=>{mutations++;return {ok:true,status:200,awardedCount:25};}})});
 const reply=await worker.request({op:'import',payload:{accounts:[{id:'a',label:'test',cookies:[{name:'auth',value:'secret',domain:'case-clicker.com',path:'/'}]}],rateState:{cooldownUntil},farmState:{accounts:{a:{modes:{case:true,money:false,vault:false},paused:false}}}}});
 assert.equal(reply.validated,1);assert.equal(reply.status.observations.a.money,0);assert.equal(mutations,0);await worker.request({op:'start',accountIds:['a']});await new Promise(r=>setTimeout(r,30));assert.equal(mutations,0);assert.equal(worker.status().budget.cooldownUntil,cooldownUntil);await assert.rejects(worker.request({op:'import',payload:{}}));await worker.close();worker=null;
 worker=await createServerWorker({directory:dir,apiFactory:()=>({snapshot:async()=>({money:0,cases:[],casesTotal:0,casesPerClick:33.65})})});await new Promise(r=>setTimeout(r,20));assert.equal(worker.status().phase,'running');assert.equal(worker.status().budget.cooldownUntil,cooldownUntil);await worker.request({op:'stop'});assert.equal(worker.status().phase,'stopped');
 }finally{await worker?.close();await fs.rm(dir,{recursive:true,force:true});}
});
test('an uncertain remote start keeps server mode enabled and never retries locally',async()=>{
 const {createRemoteFarm}=require('../electron/remoteFarm.cjs');let enabled=false,starts=0;
 const remote=createRemoteFarm({local:{stop(){},status(){return {phase:'stopped',accounts:[]};}},readConfig:async()=>({enabled}),writeConfig:async c=>{enabled=c.enabled;},preparePayload:async()=>({accounts:[{id:'a'}]}),rpc:async r=>{if(r.op==='import')return {validated:1,status:{phase:'idle',accounts:[{id:'a'}]}};starts++;throw Error('Lost response');}});
 await remote.ready();await remote.migrate(['a']);await assert.rejects(remote.start(['a']));assert.equal(enabled,true);assert.equal(starts,1);assert.equal(remote.status().execution.kind,'server');
});
