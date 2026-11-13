const test=require('node:test'),assert=require('node:assert/strict');
const load=()=>import('../../casepilot/apps/web/src/openingRuleGroups.js');
const rules=[{id:'one',name:'AK-47 | Slate',action:'sell',conditions:{floatMax:.02}},{id:'two',name:'M4A4 | Neo-Noir',action:'sell',conditions:{floatMax:.02}},{id:'three',name:'AK-47 | Slate',action:'keep'}];
test('compatible adjacent rules become one editable group without moving priority or changing payloads',async()=>{
 const {groupOpeningRules}=await load();const groups=groupOpeningRules(rules);assert.equal(groups.length,2);assert.deepEqual(groups[0].indices,[0,1]);assert.equal(groups[0].rules[0],rules[0]);assert.equal(groups[1].rules[0],rules[2]);assert.equal(groupOpeningRules([null,...rules]).length,3);
});
test('moving and deleting a group affects all its skins, preserving internal order',async()=>{
 const {groupOpeningRules,moveRuleGroup,removeRuleGroup}=await load();const groups=groupOpeningRules(rules);assert.deepEqual(moveRuleGroup(rules,groups,0,1),[rules[2],rules[0],rules[1]]);assert.deepEqual(removeRuleGroup(rules,groups[0]),[rules[2]]);
});
test('explicit groups stay separate and variants share a group without erasing their pattern constraints',async()=>{
 const {groupOpeningRules,ruleSelectionKey,sharedRuleDraftSource}=await load();const variant={...rules[0],conditions:{patterns:['a'.repeat(24)]},groupId:'group-1',selectionVariant:{id:'a'.repeat(24),name:'Sapphire'}};
 const normal={...rules[1],conditions:undefined,groupId:'group-1'};assert.equal(groupOpeningRules([variant,normal]).length,1);assert.equal(ruleSelectionKey(variant),variant.name+'::'+'a'.repeat(24));assert.equal(sharedRuleDraftSource(variant).conditions,undefined);assert.equal(variant.conditions.patterns.length,1);
 assert.equal(groupOpeningRules([{...rules[0],groupId:'one'},{...rules[1],groupId:'two'}]).length,2);
});
test('editing a group replaces its complete block and compiles official variant IDs',async()=>{
 const {prepareSkinOptions,prepareSkinRuleBatch}=await import('../../casepilot/apps/web/src/openingSkinSelection.js');const {ruleDraft}=await import('../../casepilot/apps/web/src/openingRulesViewModel.js');
 const id='a'.repeat(24),skins=[{name:'Flip Knife | Doppler',variants:[{id,name:'Sapphire',image:'sapphire'}]},{name:'AK-47 | Slate'}];const options=prepareSkinOptions(skins);assert.equal(options.length,3);
 const result=prepareSkinRuleBatch(rules,0,ruleDraft({id:'edit',action:'sell'}),['Flip Knife | Doppler::'+id],skins,[0,1]);
 assert.equal(result.valid,true);assert.equal(result.nextRules.length,2);assert.equal(result.nextRules[1],rules[2]);assert.deepEqual(result.candidates[0].conditions,{patterns:[id]});assert.equal(result.candidates[0].selectionVariant.name,'Sapphire');
 assert.equal(prepareSkinRuleBatch([],null,ruleDraft({action:'sell'}),['Flip Knife | Doppler::'+'b'.repeat(24)],skins).valid,false);
});
test('choosing a published variant never crashes or silently repairs malformed saved conditions',async()=>{
 const {prepareSkinRuleBatch}=await import('../../casepilot/apps/web/src/openingSkinSelection.js');const {ruleDraft}=await import('../../casepilot/apps/web/src/openingRulesViewModel.js');const id='a'.repeat(24),skins=[{name:'Flip Knife | Doppler',variants:[{id,name:'Sapphire'}]}];
 for(const conditions of [{patterns:{}},{patterns:null},{patterns:[]},null,[]]){const draft=ruleDraft({name:skins[0].name,action:'sell',conditions});assert.equal(prepareSkinRuleBatch([],null,draft,[skins[0].name+'::'+id],skins).valid,false);}
});
