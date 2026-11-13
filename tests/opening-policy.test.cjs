const test=require('node:test'),assert=require('node:assert/strict');
const {validateOpeningRules,canonicalSkinName,createOpeningPolicy}=require('../electron/openingPolicy.cjs');
const id='a'.repeat(24),other='b'.repeat(24);
const catalog={items:[{name:'AK-47 | Point Disarray',specialItems:[]},{name:'Rare Special Items',specialItems:[{name:'Karambit | Fade'},{name:'Bayonet | Blue Steel'}]}]};

test('rules accept listed skins and individual special items but reject the special placeholder',()=>{
 const valid=validateOpeningRules([{name:'AK-47 | Point Disarray',action:'sell'},{name:'Karambit | Fade',action:'storage',destinationAccountId:'a1',storageUnitId:id}],catalog);
 assert.equal(valid.length,2);
 assert.equal(canonicalSkinName('★ StatTrak™ Karambit | Fade (Factory New)'),canonicalSkinName('Karambit | Fade'));
 assert.throws(()=>validateOpeningRules([{name:'Rare Special Items',action:'sell'}],catalog),/catálogo/i);
 assert.throws(()=>validateOpeningRules([{name:'Not in case',action:'sell'}],catalog),/catálogo/i);
 assert.throws(()=>validateOpeningRules([{name:'Karambit | Fade',action:'sell'},{name:'★ StatTrak™ Karambit | Fade',action:'sell'}],catalog),/duplicada/i);
});

test('opened item policy sells only returned owned IDs, leaving unmatched results in inventory',async()=>{
 const calls=[],events=[];
 const policy=createOpeningPolicy({apiForAccount:()=>({inventoryPage:async()=>({pages:1,skins:[{_id:id,name:'StatTrak™ AK-47 | Point Disarray',price:40},{_id:other,name:'Other item'}]})}),inventoryActions:{prepare:async request=>{calls.push(['prepare',request.kind,request.ref.itemId]);return {previewId:'p',item:{id:request.ref.itemId,name:'StatTrak™ AK-47 | Point Disarray'}};},confirm:async()=>({operation:{state:'confirmed',verified:true}})},emit:event=>events.push(event)});
 await policy.apply({id:'source'},[id,other],[{name:'AK-47 | Point Disarray',action:'sell'}]);
 assert.deepEqual(calls,[['prepare','sell',id]]);
 assert.equal(events.filter(event=>event.type==='opening-item'&&event.action==='sell').length,1);
});

test('storage rule binds exact destination and stops after an uncertain operation',async()=>{
 const calls=[];
 const policy=createOpeningPolicy({apiForAccount:()=>({inventoryPage:async()=>({pages:1,skins:[{_id:id,name:'Karambit | Fade'},{_id:other,name:'Karambit | Fade'}]})}),inventoryActions:{prepare:async request=>{calls.push(request);return {previewId:'p',item:{id:request.ref.itemId,name:'Karambit | Fade'}};},confirm:async()=>({operation:{state:'unconfirmed',verified:false,message:'A confirmar chegada'}})},emit:()=>{}});
 await assert.rejects(policy.apply({id:'source'},[id,other],[{name:'Karambit | Fade',action:'storage',destinationAccountId:'a2',storageUnitId:id}]),/confirmar chegada/i);
 assert.equal(calls.length,1);
 assert.equal(calls[0].destinationAccountId,'a2');assert.equal(calls[0].destinationStorageUnitId,id);
});

test('no mutation occurs if an opened item cannot be located',async()=>{
 let prepared=0;
 const policy=createOpeningPolicy({apiForAccount:()=>({inventoryPage:async()=>({pages:1,skins:[]})}),inventoryActions:{prepare:async()=>{prepared++;}},emit:()=>{}});
 await assert.rejects(policy.apply({id:'source'},[id],[{name:'AK-47 | Point Disarray',action:'sell'}]),/não encontrados/i);
 assert.equal(prepared,0);
});
