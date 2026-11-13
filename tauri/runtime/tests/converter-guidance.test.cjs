const test=require('node:test'),assert=require('node:assert/strict');
const {createTokenConverter}=require('../engine/tokenConverter.cjs');
const {consolidationFixture,settled}=require('./helpers/consolidation-fixture.cjs');
const load=()=>import('../../casepilot/apps/web/src/converterViewModel.js');
test('readiness identifies autosell and full inventory without sending a game mutation',async t=>{
 const f=await consolidationFixture(t,{autosell:true,inventorySize:1,capsules:12});
 assert.equal(typeof f.service.inspect,'function');
 const result=await f.service.inspect({accountIds:['source'],steps:['open']});
 assert.deepEqual(result.issues.map(i=>i.code).sort(),['autosell','inventory-full']);
 assert.equal(result.issues.every(i=>i.accountId==='source'),true);
 assert.equal(f.requests.some(r=>r.method!=='GET'),false);
});
test('readiness shares repeated reads but force refresh detects a changed server policy',async t=>{
 let autosell=true;
 const f=await consolidationFixture(t,{beforeRequest:({path})=>path==='/api/user/autoOpen/config'?new Response(JSON.stringify({config:{autosellActivated:autosell,autosellAmount:500,autosellVariant:'money'}})):undefined});
 assert.equal(typeof f.service.inspect,'function');
 const input={accountIds:['source'],steps:['open']};
 const [a,b]=await Promise.all([f.service.inspect(input),f.service.inspect(input)]);
 assert.equal(a.issues[0].code,'autosell');assert.deepEqual(a,b);
 const before=f.requests.length;autosell=false;await f.service.inspect(input);assert.equal(f.requests.length,before);
 const fresh=await f.service.inspect({...input,force:true});assert.deepEqual(fresh.issues,[]);
 assert.equal(f.requests.some(r=>r.method!=='GET'),false);
});
test('readiness honors server cooldown and rejects malformed selections before network access',async t=>{
 const f=await consolidationFixture(t);assert.equal(typeof f.service.inspect,'function');
 for(const accountIds of [[],['source','source'],Array(101).fill('source')])await assert.rejects(f.service.inspect({accountIds,steps:['open']}));
 assert.equal(f.requests.length,0);
});
test('last sequence selection survives completion, clearing and restart',async t=>{
 const f=await consolidationFixture(t,{noItems:true,cases:2}),archive=[];
 const deps={...f.deps,store:{...f.deps.store,archive:async value=>archive.push(value)}};
 const service=createTokenConverter(deps),p=await service.prepare({action:'sequence',accountIds:['source'],steps:['sell'],routing:'selected'});
 await service.start({action:'sequence',previewId:p.previewId});await settled(service);
 assert.deepEqual(service.status().lastSelection.steps,['sell']);
 await service.clear();const reopened=createTokenConverter(deps);await reopened.ready();
 assert.deepEqual(reopened.status().lastSelection.steps,['sell']);assert.equal(archive[0].rows[0].sold,2);
});
test('start explanation includes missing steps and leaves uncertain accounts out of continuation choices',async()=>{
 const m=await load();assert.equal(typeof m.converterGuidance,'function');
 const base={steps:[],sourceIds:['a','b'],status:{phase:'blocked',rows:[{accountId:'a',operationId:'x',state:'unconfirmed'},{accountId:'b',operationId:'y',state:'stopped',canReviewNext:true} ]}};
 const result=m.converterGuidance(base);
 assert.equal(result.issues.some(i=>i.code==='no-steps'),true);
 assert.deepEqual(result.continuable.map(r=>r.operationId),['y']);
 assert.equal(result.issues.some(i=>i.code==='unconfirmed'),true);
});
test('last selection comes from selected steps rather than the shortened continuation',async()=>{
 const m=await load();assert.equal(typeof m.previousConverterSelection,'function');
 const p=m.previousConverterSelection({rows:[{updatedAt:'2026-10-16T12:00:00Z',selectedSteps:['sell','buy','open'],steps:['open'],destinationAccountId:'main'}]});
 assert.deepEqual(p.steps,['sell','buy','open']);
 assert.equal(m.previousConverterSelection({lastSelection:{steps:['invalid']},rows:[]}),null);
});
test('fresh repetition explains retained items while continuing uses only the saved operation',async()=>{
 const m=await load();assert.equal(typeof m.converterGuidance,'function');
 const status={phase:'idle',rows:[{operationId:'op',accountId:'a',state:'paused',handoffCounts:{source:2},canReviewNext:true}]};
 const fresh=m.converterGuidance({status,steps:['sell'],sourceIds:['a']});assert.equal(fresh.issues[0].code,'saved-items');
 const resumed=m.converterGuidance({status,steps:['convert-stickers'],sourceIds:['a'],resumeIds:['op']});assert.deepEqual(resumed.issues,[]);
});
test('full inventory does not block an opening step with no capsules to open',async t=>{
 const f=await consolidationFixture(t,{inventorySize:1,capsules:0});
 const result=await f.service.inspect({accountIds:['source'],steps:['sell','open']});
 assert.deepEqual(result.issues,[]);
});
test('converter activity invalidates cached readiness after inventory conversion frees space',async t=>{
 const f=await consolidationFixture(t,{inventorySize:1,capsules:3});
 const input={accountIds:['source'],steps:['open']};
 assert.equal((await f.service.inspect(input)).issues[0].code,'inventory-full');
 const p=await f.service.prepare({action:'sequence',accountIds:['source'],steps:['convert-inventory']});
 await f.service.start({action:'sequence',previewId:p.previewId});await settled(f.service);
 assert.deepEqual((await f.service.inspect(input)).issues,[]);
});
test('repeating a settled step reviews fresh stock and does not silently execute the previous amount',async t=>{
 const f=await consolidationFixture(t,{noItems:true,cases:2});
 let p=await f.service.prepare({action:'sequence',accountIds:['source'],steps:['sell']});await f.service.start({action:'sequence',previewId:p.previewId});await settled(f.service);
 f.caseStock.source[0].amount=7;
 const before=f.requests.filter(r=>r.method!=='GET').length;
 p=await f.service.prepare({action:'sequence',accountIds:['source'],steps:['sell']});
 assert.equal(p.rows[0].scopes.cases[0].amount,7);assert.equal(f.requests.filter(r=>r.method!=='GET').length,before);
 await f.service.start({action:'sequence',previewId:p.previewId});await settled(f.service);
 assert.equal(f.service.status().rows[0].sold,7);
 assert.deepEqual(f.requests.filter(r=>r.path==='/api/cases'&&r.method==='DELETE').map(r=>r.body.amount),[2,7]);
});
test('explicit repetition preserves unrelated uncertain rows and archives only the completed source',async t=>{
 const f=await consolidationFixture(t,{noItems:true,cases:2});
 const first=await f.service.prepare({action:'sequence',accountIds:['source'],steps:['sell']});await f.service.start({action:'sequence',previewId:first.previewId});await settled(f.service);
 const done=structuredClone(f.saved().rows[0]),unknown={operationId:'unknown',accountId:'destination',sourceLabel:'Outra',sourceIdentity:'destination-identity',state:'unconfirmed',pending:{kind:'seq-open',skinIds:['9'.repeat(24)]},handoffs:[],remainingSkinIds:[],sold:0};
 const archived=[],store={...f.deps.store,load:async()=>({version:1,phase:'blocked',rows:[done,unknown]}),archive:async value=>archived.push(value)};
 const service=createTokenConverter({...f.deps,store});await service.ready();f.caseStock.source[0].amount=7;
 const p=await service.prepare({action:'sequence',accountIds:['source'],steps:['sell'],repeatOperationIds:[done.operationId]});
 assert.equal(p.rows[0].scopes.cases[0].amount,7);
 await service.start({action:'sequence',previewId:p.previewId});await settled(service);
 assert.deepEqual(f.saved().rows.find(r=>r.operationId==='unknown'),unknown);
 assert.equal(service.status().rows.find(r=>r.accountId==='source').sold,7);
 assert.deepEqual(archived[0].rows,[done]);
});
test('repetition refuses a source with identified items or an uncertain intent',async t=>{
 const f=await consolidationFixture(t,{noItems:true,cases:2});
 for(const extra of [{state:'unconfirmed',pending:{kind:'seq-sell'}},{state:'paused',handoffs:[{id:'a'.repeat(24),kind:'skin',location:'source'}]}]){
  const row={operationId:'old',accountId:'source',sourceIdentity:'source-identity',...extra};
  const service=createTokenConverter({...f.deps,store:{...f.deps.store,load:async()=>({version:1,phase:'blocked',rows:[row]})}});
  await assert.rejects(service.prepare({action:'sequence',accountIds:['source'],steps:['sell'],repeatOperationIds:['old']}));
 }
 assert.equal(f.requests.some(r=>r.method!=='GET'),false);
});
test('repetition cannot consume retained destination items belonging to another row or identity alias',async t=>{
 const f=await consolidationFixture(t,{cases:2});const first=await f.service.prepare({action:'sequence',accountIds:['source'],steps:['sell']});await f.service.start({action:'sequence',previewId:first.previewId});await settled(f.service);
 const done=structuredClone(f.saved().rows[0]);
 for(const targetId of ['source','old-alias']){
  const retained={operationId:'retained',accountId:'destination',sourceIdentity:'destination-identity',destinationAccountId:targetId,destinationIdentity:'source-identity',state:'paused',handoffs:[{id:f.originalId,kind:'skin',location:'destination'}]};
  const service=createTokenConverter({...f.deps,store:{...f.deps.store,load:async()=>({version:1,phase:'idle',rows:[done,retained]}),archive:async()=>{}}});
  const writes=f.requests.filter(r=>r.method!=='GET').length;
  await assert.rejects(service.prepare({action:'sequence',accountIds:['source'],steps:['convert-inventory'],repeatOperationIds:[done.operationId]}),/guardad|identificad|isolad/i);
  assert.equal(f.requests.filter(r=>r.method!=='GET').length,writes);
 }
});
test('repetition cannot start when the old result could not be archived durably',async t=>{
 const f=await consolidationFixture(t,{noItems:true,cases:2});const first=await f.service.prepare({action:'sequence',accountIds:['source'],steps:['sell']});await f.service.start({action:'sequence',previewId:first.previewId});await settled(f.service);
 const saved=structuredClone(f.saved()),done=saved.rows[0];f.caseStock.source[0].amount=7;
 const service=createTokenConverter({...f.deps,store:{...f.deps.store,archive:async()=>{throw Error('archive unavailable');}}});
 const p=await service.prepare({action:'sequence',accountIds:['source'],steps:['sell'],repeatOperationIds:[done.operationId]}),writes=f.requests.filter(r=>r.method!=='GET').length;
 await assert.rejects(service.start({action:'sequence',previewId:p.previewId}),/archive/);
 assert.equal(f.requests.filter(r=>r.method!=='GET').length,writes);assert.deepEqual(f.saved().rows,saved.rows);
});
test('changing accounts after choosing a repetition explains the stale scope before review',async()=>{
 const {converterGuidance}=await load();
 const result=converterGuidance({status:{rows:[{operationId:'done',accountId:'first',canRepeat:true}]},sourceIds:['other'],steps:['sell'],repeatIds:['done']});
 assert.equal(result.issues.some(issue=>issue.code==='mode-scope'),true);
});
test('preserved legacy consolidation resumes its own plan after a sequence changed the run action',async t=>{
 const f=await consolidationFixture(t,{stopAfterOriginal:true}),p=await f.service.prepare({accountIds:['source'],destinationAccountId:'destination',includeInventory:true});
 await f.service.start({action:'consolidate',previewId:p.previewId});await settled(f.service);
 const seed=structuredClone(f.saved());seed.action='sequence';
 const service=createTokenConverter({...f.deps,store:{...f.deps.store,load:async()=>seed}});await service.ready();
 await service.resume(seed.rows[0].operationId);await settled(service);
 assert.equal(f.me.destination.tokens,350);
 assert.equal(f.requests.filter(r=>r.path==='/api/casino/skinToTokens'&&r.body.id===f.originalId).length,1);
});
test('failed new journal write after repetition archival keeps the previous run available without mutations',async t=>{
 const f=await consolidationFixture(t,{noItems:true,cases:2}),first=await f.service.prepare({action:'sequence',accountIds:['source'],steps:['sell']});
 await f.service.start({action:'sequence',previewId:first.previewId});await settled(f.service);const saved=structuredClone(f.saved()),done=saved.rows[0];f.caseStock.source[0].amount=7;
 const service=createTokenConverter({...f.deps,store:{...f.deps.store,archive:async()=>{},save:async value=>{if(value.rows.some(row=>row.operationId!==done.operationId))throw Error('disk full');await f.deps.store.save(value);}}});
 const p=await service.prepare({action:'sequence',accountIds:['source'],steps:['sell'],repeatOperationIds:[done.operationId]}),writes=f.requests.filter(r=>r.method!=='GET').length;
 await assert.rejects(service.start({action:'sequence',previewId:p.previewId}),/disk full/);
 assert.equal(service.active(),false);assert.equal(service.status().rows[0].operationId,done.operationId);assert.deepEqual(f.saved().rows,saved.rows);assert.equal(f.requests.filter(r=>r.method!=='GET').length,writes);
});
