const test=require('node:test'),assert=require('node:assert/strict');
const {createTokenConverter}=require('../engine/tokenConverter.cjs');
const {consolidationFixture,settled}=require('./helpers/consolidation-fixture.cjs');
const input={action:'sequence',independent:true,accountIds:['source','destination'],steps:['open','convert-stickers']};
test('all selected accounts review automatic preparation without writes and start at the same chosen step',async t=>{
 const f=await consolidationFixture(t,{autosell:true,capsules:2,noItems:true});
 f.openingPolicies.destination.autosellActivated=true;f.openingPolicies.destination.autosellAmount=500;
 f.caseStock.destination.push({...f.caseStock.source[1],amount:1});
 const before=structuredClone(f.openingPolicies),preview=await f.service.prepare(input);
 assert.deepEqual(preview.rows.map(r=>r.accountId),input.accountIds);assert.equal(f.requests.some(r=>r.method!=='GET'),false);
 assert.equal(preview.rows.every(r=>r.prerequisites[0]?.kind==='disable-autosell'),true);
 await f.service.start({action:'sequence',previewId:preview.previewId});const result=await settled(f.service);
 assert.equal(result.rows.length,2);assert.equal(result.rows.every(r=>r.state==='confirmed'),true);
 for(const id of input.accountIds){const requests=f.requests.filter(r=>r.accountId===id),write=requests.find(r=>r.method!=='GET');assert.equal(write.method,'PUT');assert.equal(write.path,'/api/user/autoOpen/config');assert.equal(write.body.activePresetId,'preset-'+id);assert.deepEqual(f.openingPolicies[id],{...before[id],autosellActivated:false});assert.equal(result.rows.find(r=>r.accountId===id).preparationCompleted.includes('disable-autosell'),true);}
 assert.equal(result.rows.find(r=>r.accountId==='source').opened,2);assert.equal(result.rows.find(r=>r.accountId==='destination').opened,1);
});
test('a lost preference response is reconciled read-only after restart and never repeats an opening',async t=>{
 let lost=true;const f=await consolidationFixture(t,{autosell:true,capsules:1,noItems:true,beforeRequest:({path,method})=>{if(lost&&path==='/api/user/autoOpen/config'&&method==='PUT'){lost=false;f.openingPolicies.source.autosellActivated=false;throw Error('response lost');}}});
 const preview=await f.service.prepare({...input,accountIds:['source']});await f.service.start({action:'sequence',previewId:preview.previewId});await settled(f.service);
 assert.equal(f.saved().rows[0].pending.kind,'seq-preference');assert.equal(f.requests.some(r=>r.path==='/api/open/capsule'),false);
 const reopened=createTokenConverter(f.deps);await reopened.ready();const writes=f.requests.filter(r=>r.method!=='GET').length;
 const result=await reopened.verify(reopened.status().rows[0].operationId);assert.equal(result.rows[0].state,'stopped');assert.equal(f.requests.filter(r=>r.method!=='GET').length,writes);assert.equal(result.rows[0].preparationCompleted.includes('disable-autosell'),true);
});
test('preference changes after review invalidate the start before sending anything',async t=>{
 const f=await consolidationFixture(t,{autosell:true,capsules:1,noItems:true}),preview=await f.service.prepare({...input,accountIds:['source']});
 f.openingPolicies.source.favoriteLowFloats=!f.openingPolicies.source.favoriteLowFloats;
 await assert.rejects(f.service.start({action:'sequence',previewId:preview.previewId}),/mudou|revê/i);assert.equal(f.requests.some(r=>r.method!=='GET'),false);
});
test('failed preference verification stops that account before any capsule purchase or opening',async t=>{
 const f=await consolidationFixture(t,{autosell:true,money:200,capsules:1,noItems:true,beforeRequest:({path,method})=>path==='/api/user/autoOpen/config'&&method==='PUT'?new Response('{}'):undefined});
 const p=await f.service.prepare({...input,accountIds:['source'],steps:['buy','open']});await f.service.start({action:'sequence',previewId:p.previewId});await settled(f.service);
 assert.equal(f.service.status().rows[0].state,'unconfirmed');assert.equal(f.requests.some(r=>r.path==='/api/open/capsule'||r.path==='/api/cases'&&r.method==='POST'),false);
});
test('steps without opening never change site preferences',async t=>{
 const f=await consolidationFixture(t,{autosell:true,cases:0,noItems:true});
 const p=await f.service.prepare({...input,accountIds:['source'],steps:['sell']});assert.deepEqual(p.rows[0].prerequisites,[]);
 await f.service.start({action:'sequence',previewId:p.previewId});await settled(f.service);assert.equal(f.requests.some(r=>r.method!=='GET'),false);
});
test('unwrapped configuration keeps the active preset outside config and preserves future site fields',async t=>{
 const f=await consolidationFixture(t),{openingConfiguration}=require('../engine/converterPreparation.cjs');
 const value=openingConfiguration({...f.openingPolicies.source,activePresetId:'selected-preset'});
 assert.equal(value.activePresetId,'selected-preset');assert.equal(Object.hasOwn(value.config,'activePresetId'),false);assert.deepEqual(value.config.futureSiteSetting,{keep:true});
});
test('failure to save the preparation intent prevents every site write',async t=>{
 const f=await consolidationFixture(t,{autosell:true,capsules:1,noItems:true}),service=createTokenConverter({...f.deps,store:{...f.deps.store,save:async value=>{if(value.rows.some(r=>r.pending?.kind==='seq-preference'))throw Error('disk full');await f.deps.store.save(value);}}});
 const p=await service.prepare({...input,accountIds:['source']});await service.start({action:'sequence',previewId:p.previewId});await settled(service);
 assert.equal(f.requests.some(r=>r.method!=='GET'),false);assert.equal(f.openingPolicies.source.autosellActivated,true);
});
test('a stop during the last preparation read prevents the preference write and selected stages',async t=>{
 let reads=0;const f=await consolidationFixture(t,{autosell:true,capsules:1,noItems:true,beforeRequest:async({path,method})=>{if(path==='/api/user/autoOpen/config'&&method==='GET'&&++reads===3)await f.service.stop();}});
 const p=await f.service.prepare({...input,accountIds:['source']});await f.service.start({action:'sequence',previewId:p.previewId});await settled(f.service);
 assert.equal(f.requests.some(r=>r.method!=='GET'),false);assert.equal(f.openingPolicies.source.autosellActivated,true);
});
test('the UI keeps every selected account instead of silently removing unresolved sources',async()=>{
 const {converterGuidance}=await import('../../casepilot/apps/web/src/converterViewModel.js');
 const result=converterGuidance({independent:true,steps:['open'],sourceIds:['a','b'],status:{rows:[{accountId:'a',state:'unconfirmed',lockedAccountIds:['a']}]}});
 assert.deepEqual(result.eligibleSourceIds,['a','b']);assert.equal(result.issues.find(i=>i.code==='unconfirmed').blocking,true);assert.equal(result.issues.some(i=>i.excludedCount>0),false);
});
test('a resumed review prepares the current preferences even after an earlier preparation completed',async t=>{
 let stopAfterPut=true;const f=await consolidationFixture(t,{autosell:true,money:200,noItems:true,beforeRequest:async({path,method})=>{if(stopAfterPut&&path==='/api/user/autoOpen/config'&&method==='GET'&&f.requests.some(r=>r.method==='PUT')){stopAfterPut=false;await f.service.stop();}}});
 const config={...input,independent:false,accountIds:['source'],steps:['buy','open','convert-stickers']},first=await f.service.prepare(config);await f.service.start({action:'sequence',previewId:first.previewId});await settled(f.service);
 const row=f.service.status().rows[0];assert.equal(row.state,'stopped');assert.equal(row.preparationCompleted.includes('disable-autosell'),true);f.openingPolicies.source.autosellActivated=true;
 const p=await f.service.prepare({...config,resumeOperationIds:[row.operationId]});assert.equal(p.rows[0].prerequisites.length,1);await f.service.start({action:'sequence',previewId:p.previewId});await settled(f.service);
 assert.equal(f.service.status().rows[0].state,'confirmed');assert.equal(f.openingPolicies.source.autosellActivated,false);assert.equal(f.requests.filter(r=>r.method==='PUT').length,2);
});
test('an uncertain source preference does not lock an untouched Main',async t=>{
 const f=await consolidationFixture(t,{autosell:true,pro:true,noItems:true,capsules:1,beforeRequest:({path,method})=>{if(path==='/api/user/autoOpen/config'&&method==='PUT')throw Error('response lost');}});
 const p=await f.service.prepare({...input,accountIds:['source'],destinationAccountId:'destination',steps:['open','convert-stickers','transfer']});await f.service.start({action:'sequence',previewId:p.previewId});await settled(f.service);
 assert.deepEqual(f.service.status().rows[0].lockedAccountIds,['source']);
 const sale=await f.service.prepare({...input,accountIds:['destination'],steps:['sell']});assert.deepEqual(sale.rows.map(r=>r.accountId),['destination']);
});
