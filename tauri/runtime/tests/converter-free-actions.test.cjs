const test=require('node:test'),assert=require('node:assert/strict');
const {createTokenConverter}=require('../engine/tokenConverter.cjs');
const {consolidationFixture,settled}=require('./helpers/consolidation-fixture.cjs');
test('independent actions can sell, open, then sell again while keeping earlier stickers identified',async t=>{
 const f=await consolidationFixture(t,{noItems:true,cases:2,capsules:3}),archives=[];
 const service=createTokenConverter({...f.deps,store:{...f.deps.store,archive:async value=>archives.push(value)}});
 const doStep=async steps=>{const p=await service.prepare({action:'sequence',independent:true,accountIds:['source'],steps});await service.start({action:'sequence',previewId:p.previewId});return settled(service);};
 await doStep(['sell']);let result=await doStep(['open']);
 assert.equal(result.rows[0].pendingStickers,3);const ids=[...f.saved().rows[0].remainingSkinIds];
 f.caseStock.source[0].amount=5;result=await doStep(['sell']);
 assert.equal(result.rows[0].sold,5);assert.equal(result.rows[0].pendingStickers,3);assert.deepEqual(f.saved().rows[0].remainingSkinIds,ids);
 assert.equal(f.requests.filter(r=>r.path==='/api/open/capsule').length,1);assert.deepEqual(f.requests.filter(r=>r.path==='/api/cases'&&r.method==='DELETE').map(r=>r.body.amount),[2,5]);
 assert.equal(archives.length,2);assert.equal(archives[1].rows[0].opened,3);
 await doStep(['convert-stickers']);assert.equal(f.stock.source.length,0);assert.equal(f.me.source.tokens,500);
});
test('an independent new source does not replace an unrelated unknown operation',async t=>{
 const f=await consolidationFixture(t,{noItems:true,cases:2}),unknown={operationId:'unknown',accountId:'destination',sourceLabel:'Other',sourceIdentity:'destination-identity',state:'unconfirmed',pending:{kind:'seq-open',skinIds:['9'.repeat(24)]}};
 const service=createTokenConverter({...f.deps,store:{...f.deps.store,load:async()=>({version:1,phase:'blocked',rows:[unknown]}),archive:async()=>{}}});
 const p=await service.prepare({action:'sequence',independent:true,accountIds:['source'],steps:['sell']});await service.start({action:'sequence',previewId:p.previewId});await settled(service);
 assert.deepEqual(f.saved().rows.find(row=>row.operationId==='unknown'),unknown);assert.equal(f.saved().rows.find(row=>row.accountId==='source').sold,2);
});
test('independent mode still refuses to reopen capsules with an unknown opening',async t=>{
 const f=await consolidationFixture(t,{noItems:true,cases:2});const unknown={operationId:'unknown',accountId:'source',sourceIdentity:'source-identity',state:'unconfirmed',pending:{kind:'seq-open',skinIds:['9'.repeat(24)]}};
 const service=createTokenConverter({...f.deps,store:{...f.deps.store,load:async()=>({version:1,phase:'blocked',rows:[unknown]}),archive:async()=>{}}});
 await assert.rejects(service.prepare({action:'sequence',independent:true,accountIds:['source'],steps:['open']}),/confirm|pendente|anterior/);assert.equal(f.requests.some(r=>r.method!=='GET'),false);
});
test('the UI keeps selected accounts and explains unresolved conflicts rather than skipping them',async()=>{
 const {converterGuidance}=await import('../../casepilot/apps/web/src/converterViewModel.js');
 const result=converterGuidance({independent:true,sourceIds:['a','b'],steps:['sell'],status:{phase:'blocked',rows:[{accountId:'a',state:'unconfirmed',lockedAccountIds:['a']}]}});
 assert.deepEqual(result.eligibleSourceIds,['a','b']);assert.equal(result.issues.some(issue=>issue.blocking!==false),true);
});
test('selling does not trigger irrelevant background account profile reads',async t=>{
 const f=await consolidationFixture(t);await f.service.inspect({accountIds:['source'],steps:['sell']});assert.equal(f.requests.length,0);
});
test('independent purchases use the current money and reset old sale and purchase counters',async t=>{
 const f=await consolidationFixture(t,{noItems:true,money:100,cases:2}),service=createTokenConverter({...f.deps,store:{...f.deps.store,archive:async()=>{}}});
 for(const steps of [['buy'],['sell'],['buy']]){const p=await service.prepare({action:'sequence',independent:true,accountIds:['source'],steps});await service.start({action:'sequence',previewId:p.previewId});await settled(service);}
 assert.equal(f.service.active(),false);assert.equal(service.status().rows[0].bought,1);assert.equal(f.caseStock.source[1].amount,2);assert.equal(f.me.source.money,40);
 assert.deepEqual(f.requests.filter(r=>r.path==='/api/cases'&&r.method==='POST').map(r=>r.body.amount),[1,1]);
});
test('held skins survive unrelated local actions and restart before independent transfer and received conversion',async t=>{
 const f=await consolidationFixture(t,{noItems:true,cases:2}),deps={...f.deps,store:{...f.deps.store,archive:async()=>{}}};let service=createTokenConverter(deps);
 async function step(steps,main=false){const p=await service.prepare({action:'sequence',independent:true,accountIds:['source'],steps,...(main?{destinationAccountId:'destination'}:{})});await service.start({action:'sequence',previewId:p.previewId});const result=await settled(service);assert.notEqual(result.rows.find(r=>r.accountId==='source').state,'unconfirmed',result.rows[0].message);return result;}
 await step(['mint']);const skinId=f.saved().rows[0].handoffs[0].id;
 await step(['sell']);assert.equal(f.saved().rows[0].handoffs[0].id,skinId);
 service=createTokenConverter(deps);await step(['transfer'],true);assert.equal(f.saved().rows[0].handoffs[0].location,'destination');
 f.caseStock.source[0].amount=1;await step(['sell']);assert.equal(f.saved().rows[0].destinationAccountId,'destination');
 service=createTokenConverter(deps);await step(['convert-received'],true);
 assert.equal(f.me.destination.tokens,250);assert.equal(f.saved().rows[0].handoffs.length,0);assert.equal(f.saved().rows[0].remainingItems.length,0);assert.equal(f.stock.destination.some(i=>i._id===f.mainId),true);
});
test('independent action refuses to consume another row held inventory through an identity alias',async t=>{
 const f=await consolidationFixture(t),retained={operationId:'retained',accountId:'destination',sourceIdentity:'destination-identity',destinationAccountId:'old-alias',destinationIdentity:'source-identity',state:'paused',handoffs:[{id:f.originalId,kind:'skin',location:'destination'}]};
 const service=createTokenConverter({...f.deps,store:{...f.deps.store,load:async()=>({version:1,rows:[retained]})}});
 await assert.rejects(service.prepare({action:'sequence',independent:true,accountIds:['source'],steps:['convert-inventory']}),/guardad|identificad|isolad/);assert.equal(f.requests.some(r=>r.method!=='GET'),false);
});
test('a failed archive of held items leaves their ownership intact and sends no new action',async t=>{
 const f=await consolidationFixture(t,{noItems:true,capsules:2,cases:1}),deps={...f.deps,store:{...f.deps.store,archive:async()=>{throw Error('archive unavailable');}}};let service=createTokenConverter(deps);
 const first=await service.prepare({action:'sequence',independent:true,accountIds:['source'],steps:['open']});await service.start({action:'sequence',previewId:first.previewId});await settled(service);
 const before=structuredClone(f.saved()),writes=f.requests.filter(r=>r.method!=='GET').length;service=createTokenConverter(deps);
 const p=await service.prepare({action:'sequence',independent:true,accountIds:['source'],steps:['sell']});await assert.rejects(service.start({action:'sequence',previewId:p.previewId}),/archive/);
 assert.deepEqual(f.saved().rows,before.rows);assert.equal(f.requests.filter(r=>r.method!=='GET').length,writes);
});
test('independent guidance preserves selection and blocks conflicts on selected sources or Main',async()=>{
 const {converterGuidance}=await import('../../casepilot/apps/web/src/converterViewModel.js');
 const status={rows:[{accountId:'a',state:'unconfirmed',lockedAccountIds:['a']}]};
 const all=converterGuidance({independent:true,steps:['sell'],sourceIds:['a'],status});assert.equal(all.issues[0].blocking,true);assert.deepEqual(all.eligibleSourceIds,['a']);
 const main=converterGuidance({independent:true,steps:['transfer'],sourceIds:['b'],destination:{id:'a'},needsDestination:true,status});assert.equal(main.issues[0].blocking,true);
 const unrelated=converterGuidance({independent:true,steps:['sell'],sourceIds:['b'],status});assert.deepEqual(unrelated.issues,[]);
});
test('a Pro account can send new tokens while earlier received skins remain in Main',async t=>{
 const f=await consolidationFixture(t,{pro:true,noItems:true}),service=createTokenConverter({...f.deps,store:{...f.deps.store,archive:async()=>{}}});
 async function step(steps){const p=await service.prepare({action:'sequence',independent:true,accountIds:['source'],destinationAccountId:'destination',routing:'selected',steps});await service.start({action:'sequence',previewId:p.previewId});await settled(service);return p;}
 await step(['mint','transfer']);const id=f.saved().rows[0].handoffs[0].id;f.me.source.tokens=123;
 const p=await step(['transfer']);assert.equal(p.rows[0].route,'tokens');assert.equal(f.me.source.tokens,0);assert.equal(f.me.destination.tokens,173);
 assert.equal(f.saved().rows[0].handoffs[0].id,id);assert.equal(f.saved().rows[0].handoffs[0].location,'destination');
});
test('a Main conversion awaiting confirmation exposes both affected accounts as locked',async t=>{
 const f=await consolidationFixture(t,{noItems:true,cases:1}),unknown={operationId:'pending',accountId:'source',sourceIdentity:'source-identity',destinationAccountId:'destination',destinationIdentity:'destination-identity',state:'unconfirmed',sequencePlan:{selectedSteps:['convert-received']},pending:{kind:'inventory-child',childKind:'convert',accountId:'destination',itemId:'9'.repeat(24)}};
 const service=createTokenConverter({...f.deps,store:{...f.deps.store,load:async()=>({version:1,rows:[unknown]})}});await service.ready();
 assert.deepEqual(service.status().rows[0].lockedAccountIds,['source','destination']);
 const {converterGuidance}=await import('../../casepilot/apps/web/src/converterViewModel.js');
 const result=converterGuidance({independent:true,status:service.status(),steps:['sell'],sourceIds:['source']});assert.equal(result.issues[0].blocking,true);
 await assert.rejects(service.prepare({action:'sequence',independent:true,accountIds:['source'],steps:['sell']}),/confirm/);assert.equal(f.requests.some(r=>r.method!=='GET'),false);
});
