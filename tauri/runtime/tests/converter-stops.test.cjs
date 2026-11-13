const test=require('node:test'),assert=require('node:assert/strict');
const {createTokenConverter}=require('../engine/tokenConverter.cjs');
const {consolidationFixture,settled}=require('./helpers/consolidation-fixture.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('stopping a source during its current read prevents its next request and leaves other sources running',async t=>{
 let release,entered;const enteredRead=new Promise(resolve=>entered=resolve),hold=new Promise(resolve=>release=resolve);let reads=0;
 const f=await consolidationFixture(t,{noItems:true,cases:2,beforeRequest:async({accountId,path})=>{if(accountId==='source'&&path==='/api/me'&&++reads>=3){entered();await hold;}}});
 t.after(()=>release());f.caseStock.destination=[structuredClone(f.caseStock.source[0])];const service=createTokenConverter(f.deps);
 const p=await service.prepare({action:'sequence',independent:true,accountIds:['source','destination'],steps:['sell']});
 await service.start({action:'sequence',previewId:p.previewId});await enteredRead;
 const source=service.status().rows.find(r=>r.accountId==='source');assert.equal(source.canStop,true);
 await service.stopAccount(source.operationId);release();await settled(service);
 assert.equal(service.status().rows.find(r=>r.accountId==='source').state,'stopped');assert.equal(service.status().rows.find(r=>r.accountId==='destination').sold,2);
 assert.equal(f.requests.some(r=>r.accountId==='source'&&r.method==='DELETE'),false);
});
test('stopping after a submitted opening preserves its exact pending result instead of declaring it completed',async t=>{
 let release,entered;const sent=new Promise(resolve=>entered=resolve),hold=new Promise(resolve=>release=resolve);
 const f=await consolidationFixture(t,{noItems:true,capsules:2,beforeRequest:async({path})=>{if(path==='/api/open/capsule'){entered();await hold;}}}),service=f.service;
 const p=await service.prepare({action:'sequence',accountIds:['source'],steps:['open','convert-stickers']});await service.start({action:'sequence',previewId:p.previewId});await sent;
 await service.stopAccount(service.status().rows[0].operationId);release();await settled(service);
 const row=f.saved().rows[0];assert.equal(row.state,'unconfirmed');assert.equal(row.pending.kind,'seq-open');assert.equal(row.pending.skinIds.length,2);
 assert.equal(f.requests.filter(r=>r.path==='/api/open/capsule').length,1);assert.equal(f.requests.some(r=>r.path==='/api/casino/skinToTokens'),false);
});
test('stop all works during review preparation and restores idle state with no mutations',async t=>{
 let release,entered;const enteredRead=new Promise(resolve=>entered=resolve),hold=new Promise(resolve=>release=resolve);
 const f=await consolidationFixture(t,{beforeRequest:async({path})=>{if(path==='/api/me'){entered();await hold;}}}),service=f.service;
 const preparing=service.prepare({action:'sequence',independent:true,accountIds:['source'],steps:['sell']});const rejected=assert.rejects(preparing,/parad|cancelad/);
 await enteredRead;await service.stop();release();await rejected;
 assert.equal(service.active(),false);assert.equal(service.status().phase,'idle');assert.equal(f.requests.some(r=>r.method!=='GET'),false);
});
test('stopping saved rows preserves held items and a new independent stage can still be chosen',async t=>{
 const f=await consolidationFixture(t,{noItems:true,capsules:2,cases:1}),service=createTokenConverter({...f.deps,store:{...f.deps.store,archive:async()=>{}}});
 let p=await service.prepare({action:'sequence',independent:true,accountIds:['source'],steps:['open']});await service.start({action:'sequence',previewId:p.previewId});await settled(service);
 const held=structuredClone(f.saved().rows[0].handoffs);await service.stopAccount(service.status().rows[0].operationId);assert.deepEqual(f.saved().rows[0].handoffs,held);
 p=await service.prepare({action:'sequence',independent:true,accountIds:['source'],steps:['sell']});await service.start({action:'sequence',previewId:p.previewId});await settled(service);assert.equal(service.status().rows[0].sold,1);assert.deepEqual(f.saved().rows[0].handoffs,held);
});
test('stop all while idle preserves an unknown result and every held item',async t=>{
 const f=await consolidationFixture(t),rows=[{operationId:'unknown',accountId:'source',sourceIdentity:'source-identity',state:'unconfirmed',pending:{kind:'seq-open',skinIds:['9'.repeat(24)]}},{operationId:'held',accountId:'destination',state:'stopped',handoffs:[{id:'a'.repeat(24),kind:'sticker',location:'source'}],remainingSkinIds:['a'.repeat(24)]}],service=createTokenConverter({...f.deps,store:{...f.deps.store,load:async()=>({version:1,rows})}});
 await service.ready();await service.stop();assert.equal(service.active(),false);assert.deepEqual(f.saved().rows[0].pending,rows[0].pending);assert.equal(f.saved().rows[0].state,'unconfirmed');assert.deepEqual(f.saved().rows[1].handoffs,rows[1].handoffs);assert.equal(f.requests.length,0);
});
test('individual stop during review cancels that preview so the stopped source cannot be submitted',async t=>{
 let release,entered,armed=false;const waiting=new Promise(resolve=>entered=resolve),hold=new Promise(resolve=>release=resolve);
 const f=await consolidationFixture(t,{noItems:true,cases:1,beforeRequest:async({path})=>{if(armed&&path==='/api/me'){entered();await hold;}}}),service=createTokenConverter({...f.deps,store:{...f.deps.store,archive:async()=>{}}});
 const first=await service.prepare({action:'sequence',independent:true,accountIds:['source'],steps:['sell']});await service.start({action:'sequence',previewId:first.previewId});await settled(service);armed=true;
 const preparing=service.prepare({action:'sequence',independent:true,accountIds:['source'],steps:['sell']}),rejected=assert.rejects(preparing,/parad|cancelad/);await waiting;await service.stopAccount(service.status().rows[0].operationId);release();await rejected;assert.equal(service.active(),false);
});
test('review reports bounded read progress and returns to idle without writing an operation',async t=>{
 const f=await consolidationFixture(t,{noItems:true,cases:1}),events=[],service=createTokenConverter({...f.deps,emit:event=>events.push(event.status)});
 await service.prepare({action:'sequence',independent:true,accountIds:['source'],steps:['sell']});
 assert.deepEqual(events.filter(status=>status.preparation).map(status=>status.preparation.completed),[0,1]);assert.equal(events.at(-1).phase,'idle');assert.equal(service.active(),false);assert.equal(f.requests.some(r=>r.method!=='GET'),false);
});
test('stop all also cancels readiness reads instead of leaving the page waiting',async t=>{
 const f=await consolidationFixture(t);let service,entered;const waiting=new Promise(resolve=>entered=resolve);
 const {createConverterApiFactory}=require('../engine/converterNetwork.cjs'),{createRequestCoordinator}=require('../engine/requestCoordinator.cjs');
 const factory=createConverterApiFactory({requestWork:createRequestCoordinator(),coordinator:{cooldown:async()=>0},captureMutationGuard:()=>service.dispatchGuard(),network:{fetch:async(_account,_path,init)=>{entered();return new Promise((resolve,reject)=>{if(init.signal?.aborted)return reject(Error('cancelled'));init.signal?.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});});}}});
 service=createTokenConverter({...f.deps,apiForAccount:factory});const inspecting=service.inspect({accountIds:['source'],steps:['open']});await waiting;await service.stop();
 const result=await Promise.race([inspecting,new Promise((_,reject)=>setTimeout(()=>reject(Error('readiness did not stop')),200))]);assert.equal(result.cancelled,true);assert.deepEqual(result.issues,[]);
});
test('manual verification still reads the server after stopping automatic checks',async t=>{
 const f=await consolidationFixture(t,{noItems:true}),unknown={operationId:'pending',accountId:'source',sourceIdentity:'source-identity',state:'unconfirmed',sold:0,sequencePlan:{selectedSteps:['sell']},pending:{kind:'seq-sell',id:'a'.repeat(24),before:1,amount:1,beforeMoney:0,maximumCredit:70}},reads=[];let service;
 const {createConverterApiFactory}=require('../engine/converterNetwork.cjs'),{createRequestCoordinator}=require('../engine/requestCoordinator.cjs');
 const factory=createConverterApiFactory({requestWork:createRequestCoordinator(),coordinator:{cooldown:async()=>0},captureMutationGuard:()=>service.dispatchGuard(),network:{fetch:async(_account,path)=>{reads.push(path);return new Response(JSON.stringify(path==='/api/me'?{tokens:200,money:70,membership:'free',rank:{id:18},inventoryCount:0,inventorySize:100,caseOpenCount:2,maxCaseOpenMultiplier:3,dailyTradesLeft:100,tradeItems:6}:[]));}}});
 service=createTokenConverter({...f.deps,apiForAccount:factory,store:{...f.deps.store,load:async()=>({version:1,rows:[unknown]})}});
 await service.inspect({accountIds:['source'],steps:['sell']});await service.stop();const result=await service.verify('pending');assert.equal(result.rows[0].state,'stopped',result.rows[0].message);assert.equal(result.rows[0].sold,1);assert.deepEqual(reads,['/api/me','/api/cases']);
});
