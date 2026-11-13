const test=require('node:test'),assert=require('node:assert/strict');
const load=()=>import('../../casepilot/apps/web/src/openingSkinSelection.js');
const skins=[{name:'AK-47 | Slate',image:'a'},{name:'Nomad Knife | Fade',image:'b'},{name:'Broken Fang Gloves | Jade',image:'c'}];
test('search composes token matching, category and selected-only filters before bounded pagination',async()=>{
 const {prepareSkinOptions,skinSelectionPage}=await load();const options=prepareSkinOptions(skins);
 assert.deepEqual(skinSelectionPage(options,{query:'nomad fade',category:'knives'}).items.map(s=>s.name),[skins[1].name]);
 assert.equal(skinSelectionPage(options,{query:'ak47'}).total,1);
 assert.equal(skinSelectionPage(options,{selectedOnly:true,selectedNames:[skins[2].name],page:50}).page,1);
 assert.equal(skinSelectionPage(options,{category:'gloves'}).items[0].name,skins[2].name);
});
test('one shared draft expands atomically at the original priority without changing unrelated rules',async()=>{
 const {prepareSkinRuleBatch}=await load();const {ruleDraft}=await import('../../casepilot/apps/web/src/openingRulesViewModel.js');
 const rules=[{id:'before',name:skins[0].name,action:'keep',conditions:{floatMax:0.01}},{id:'edit',name:skins[0].name,action:'sell'},{id:'after',name:skins[2].name,action:'keep'}];
 const draft=ruleDraft({...rules[1],conditions:{statTrak:false,floatMin:0}});
 const result=prepareSkinRuleBatch(rules,1,draft,[skins[0].name,skins[1].name],skins);
 assert.equal(result.valid,true);assert.deepEqual(result.nextRules.map(r=>r.name),[skins[0].name,skins[0].name,skins[1].name,skins[2].name]);assert.equal(result.nextRules[0],rules[0]);assert.equal(result.nextRules[3],rules[2]);assert.deepEqual(result.candidates[1].conditions,{floatMin:0,statTrak:false});assert.equal(rules.length,3);
});
test('a duplicate, unknown selection or exceeded rule limit rejects the entire selection',async()=>{
 const {prepareSkinRuleBatch}=await load();const {ruleDraft}=await import('../../casepilot/apps/web/src/openingRulesViewModel.js');const draft=ruleDraft({id:'new',name:skins[0].name,action:'sell'});
 const result=prepareSkinRuleBatch([{name:skins[1].name,action:'keep'}],null,draft,skins.slice(0,2).map(s=>s.name),skins);
 assert.equal(result.valid,false);assert.equal(result.nextRules,null);
 assert.equal(prepareSkinRuleBatch([],null,draft,[],skins).valid,false);
 assert.equal(prepareSkinRuleBatch([],null,draft,['Unknown'],skins).valid,false);
 assert.equal(prepareSkinRuleBatch(Array.from({length:500},()=>({name:'Other',action:'keep'})),null,draft,[skins[0].name],skins).valid,false);
});
test('legacy decorated rule names map to selectable catalog tiles',async()=>{
 const {normalizeSelectedSkinNames}=await load();
 assert.deepEqual(normalizeSelectedSkinNames(['StatTrak™ AK-47 | Slate (Factory New)'],skins),[skins[0].name]);
});
test('invalid saved rows remain visible and blocked instead of crashing profile preparation',async()=>{
 const {toOperationProfileRules}=await import('../../casepilot/apps/web/src/operationProfile.js');
 assert.deepEqual(toOperationProfileRules([null]),[null]);
});
test('a batch can only use skins from the selected case even if another case contains the name',async()=>{
 const {prepareSkinRuleBatch}=await load();const {ruleDraft}=await import('../../casepilot/apps/web/src/openingRulesViewModel.js');const {validateOpeningRules}=require('../engine/openingPolicy.cjs');
 const draft=ruleDraft({name:skins[0].name,action:'keep'}),otherCase=[skins[1]];
 assert.equal(prepareSkinRuleBatch([],null,draft,[skins[0].name],otherCase).valid,false);
 assert.throws(()=>validateOpeningRules([{name:skins[0].name,action:'keep'}],{items:otherCase}),/catálogo da caixa/);
});
