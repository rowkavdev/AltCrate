const test=require('node:test'),assert=require('node:assert/strict');
const {validateOpeningRules,decideOpeningItem,createOpeningPolicy}=require('../engine/openingPolicy.cjs');
const name='Karambit | Fade',id='a'.repeat(24),catalog={items:[{name}]};
const variant={name,action:'keep',conditions:{floatMax:0.01,patterns:['42'],statTrak:true,souvenir:false,eventName:'Orbit'}};
const item={_id:id,name,float:0.005,patternId:'42',statTrak:true,souvenir:false,event:{name:'Orbit'}};
test('ordered attribute variants precede a broad fallback and legacy duplicates stay invalid',()=>{
 const rules=validateOpeningRules([variant,{name,action:'sell'}],catalog);
 assert.equal(decideOpeningItem(item,rules).action,'keep');assert.equal(decideOpeningItem(item,rules).ruleIndex,0);
 assert.equal(decideOpeningItem({...item,float:0.1},rules).action,'sell');
 assert.equal(decideOpeningItem(item,[rules[1],rules[0]]).action,'sell');
 assert.throws(()=>validateOpeningRules([{name,action:'sell'},{name,action:'keep'}],catalog),/duplicada/i);
});
test('missing condition data keeps the item instead of falling through to destructive fallback',()=>{
 for(const field of ['float','patternId','statTrak','souvenir','event']){
  const incomplete={...item};delete incomplete[field];const decision=decideOpeningItem(incomplete,[variant,{name,action:'sell'}]);
  assert.equal(decision.action,'keep',field);assert.match(decision.reason,/ausente/i);assert.equal(decision.ruleIndex,0);
 }
});
test('favorite protection also applies to automatic storage moves',()=>{
 const decision=decideOpeningItem({...item,isFavorite:true},[{name,action:'storage',destinationAccountId:'b',storageUnitId:id}]);
 assert.equal(decision.action,'keep');assert.equal(decision.reasonCode,'favorite-protected');
});
test('individual top N needs fresh account/item bound rank and never aggregate coverage',()=>{
 const rule={name,action:'keep',conditions:{topN:10}},fallback={name,action:'sell'};
 for(const ranking of [null,{rankedSkins:1,totalSkins:100},{state:'stale',rank:1},{state:'fresh',rank:1,accountId:'other',itemId:id}])assert.equal(decideOpeningItem(item,[rule,fallback],{accountId:'a',ranking}).action,'keep');
 assert.equal(decideOpeningItem(item,[rule,fallback],{accountId:'a',ranking:{state:'fresh',scope:'lowestFloatBySkingroupRank',accountId:'a',itemId:id,rank:20}}).action,'sell');
});
test('invalid bounds, patterns, unknown attributes and duplicate variants are rejected',()=>{
 for(const conditions of [{floatMin:.2,floatMax:.1},{floatMin:-1},{patterns:[]},{patterns:['']},{statTrak:'true'},{topN:0},{eventName:''},{unknown:true}])assert.throws(()=>validateOpeningRules([{name,action:'sell',conditions}],catalog));
 assert.throws(()=>validateOpeningRules([variant,variant],catalog),/duplicada/i);
});
function fixture(original,preview){let confirmed=0,prepared=0;const events=[];return {events,get confirmed(){return confirmed;},get prepared(){return prepared;},policy:createOpeningPolicy({apiForAccount:()=>({inventoryPage:async()=>({pages:1,skins:[original]})}),inventoryActions:{prepare:async()=>{prepared++;return {previewId:'p',item:{id,...preview}};},confirm:async()=>{confirmed++;return {operation:{state:'confirmed',verified:true}};}},emit:event=>events.push(event)})};}
test('preview attribute change is kept with a reason and no confirmation',async()=>{
 const f=fixture(item,{...item,float:0.2});
 const result=await f.policy.apply({id:'a'},[id],[{name,action:'sell',conditions:{floatMax:.01}}]);
 assert.equal(f.confirmed,0);assert.equal(result.handled,0);assert.equal(f.events[0].action,'keep');assert.equal(f.events[0].reasonCode,'preview-changed');
});
test('preview favorite and identity changes never confirm',async()=>{
 const favorite=fixture(item,{...item,isFavorite:true});await favorite.policy.apply({id:'a'},[id],[{name,action:'storage',destinationAccountId:'b',storageUnitId:id}]);assert.equal(favorite.confirmed,0);
 const changed=fixture(item,{...item,id:'b'.repeat(24)});await assert.rejects(changed.policy.apply({id:'a'},[id],[{name,action:'sell'}]),/mudou/i);assert.equal(changed.confirmed,0);
});
test('kept and unmatched items emit a dated reason and matched rule',async()=>{
 const f=fixture(item,item);const result=await f.policy.apply({id:'a'},[id],[variant]);assert.equal(result.handled,0);assert.equal(f.prepared,0);assert.equal(f.events[0].ruleIndex,0);assert.match(f.events[0].reason,/regra/i);assert.ok(f.events[0].at);
});
test('a preview with a different named variant never confirms even when canonical skin is unchanged',async()=>{
 const f=fixture(item,{...item,name:'StatTrak™ '+name});await assert.rejects(f.policy.apply({id:'a'},[id],[{name,action:'sell'}]),/mudou/i);assert.equal(f.confirmed,0);
});
test('a ranking observation that expires during preparation keeps the item',async()=>{
 let reads=0,confirmed=0;const events=[];
 const policy=createOpeningPolicy({apiForAccount:()=>({inventoryPage:async()=>({pages:1,skins:[item]})}),itemRanking:{read:async()=>({state:++reads===1?'fresh':'stale',scope:'lowestFloatBySkingroupRank',accountId:'a',itemId:id,rank:3})},inventoryActions:{prepare:async()=>({previewId:'p',item:{...item,id}}),confirm:async()=>{confirmed++;}},emit:event=>events.push(event)});
 await policy.apply({id:'a'},[id],[{name,action:'sell',conditions:{topN:10}}]);assert.equal(confirmed,0);assert.equal(events[0].action,'keep');
});
test('top N selectively refreshes a newly opened item before applying the first rule',async()=>{
 let refreshed=0,prepared=0;const events=[];const ranking={state:'fresh',accountId:'a',itemId:id,rank:3,scope:'lowestFloatBySkingroupRank'};
 const policy=createOpeningPolicy({apiForAccount:()=>({inventoryPage:async()=>({pages:1,skins:[item]})}),itemRanking:{read:()=>refreshed?ranking:{state:'unavailable'},refresh:async ref=>{assert.equal(ref.itemId,id);assert.ok(ref.identity);refreshed++;return ranking;}},inventoryActions:{prepare:async()=>{prepared++;return {previewId:'p',item:{...item,id}};},confirm:async()=>({operation:{state:'confirmed',verified:true}})},emit:event=>events.push(event)});
 await policy.apply({id:'a'},[id],[{name,action:'sell',conditions:{topN:10}}]);assert.equal(refreshed,1);assert.equal(prepared,1);assert.equal(events[0].verified,true);
});
test('a failed ranking refresh conserves the item instead of applying the broad sale fallback',async()=>{
 let prepared=0;const events=[];const policy=createOpeningPolicy({apiForAccount:()=>({inventoryPage:async()=>({pages:1,skins:[item]})}),itemRanking:{read:()=>({state:'unavailable'}),refresh:async()=>{throw Error('ranking timeout');}},inventoryActions:{prepare:async()=>{prepared++;}},emit:event=>events.push(event)});
 await policy.apply({id:'a'},[id],[{name,action:'keep',conditions:{topN:10}},{name,action:'sell'}]);assert.equal(prepared,0);assert.equal(events[0].action,'keep');assert.match(events[0].reason,/timeout/);
});
test('HTTP429 while reading rank emits keep reason and stops before requesting another item',async()=>{
 let calls=0,prepared=0;const events=[];const policy=createOpeningPolicy({apiForAccount:()=>({inventoryPage:async()=>({pages:1,skins:[item,{...item,_id:'b'.repeat(24)}]})}),itemRanking:{read:()=>({state:'unavailable'}),refresh:async()=>{calls++;const error=Error('ranking HTTP 429');error.status=429;throw error;}},inventoryActions:{prepare:async()=>{prepared++;}},emit:event=>events.push(event)});
 await assert.rejects(policy.apply({id:'a'},[id,'b'.repeat(24)],[{name,action:'keep',conditions:{topN:10}},{name,action:'sell'}]),error=>error.status===429);assert.equal(calls,1);assert.equal(prepared,0);assert.equal(events[0].action,'keep');
});
test('Top N never uses a position from the highest-float ranking as Overall lowest float',()=>{
 const decision=decideOpeningItem(item,[{name,action:'sell',conditions:{topN:10}}],{accountId:'a',ranking:{state:'fresh',accountId:'a',itemId:id,rank:1,scope:'highestFloatBySkingroupRank'}});assert.equal(decision.action,'keep');
});
test('rank identity survives the existing inventory normalizer for a standard non-event item',async()=>{
 const {normalizeInventoryItem}=require('../engine/inventoryView.cjs');const {itemRankingIdentity}=require('../engine/openingPolicy.cjs');const raw={_id:id,name,float:.2,statTrak:false,souvenir:false};assert.equal(itemRankingIdentity(raw),itemRankingIdentity(normalizeInventoryItem(raw)));
});
test('stopping during ranking refresh prevents a new item preparation',async()=>{
 let stopped=false,prepared=0;const events=[];const ranking={state:'fresh',scope:'lowestFloatBySkingroupRank',accountId:'a',itemId:id,rank:1};
 const policy=createOpeningPolicy({apiForAccount:()=>({inventoryPage:async()=>({pages:1,skins:[item]})}),itemRanking:{read:()=>({state:'unavailable'}),refresh:async()=>{stopped=true;return ranking;}},inventoryActions:{prepare:async()=>{prepared++;return {item:{...item,id}};}},emit:event=>events.push(event)});
 await policy.apply({id:'a'},[id],[{name,action:'sell',conditions:{topN:10}}],{isStopped:()=>stopped});assert.equal(prepared,0);assert.equal(events[0].reasonCode,'stopped');
});
test('normalized preview preserves unknown variant data and cannot fall through to a general sale',async()=>{const {normalizeInventoryItem}=require('../engine/inventoryView.cjs');for(const attribute of ['statTrak','souvenir']){const initial={_id:id,name,[attribute]:false};const preview=normalizeInventoryItem({_id:id,name});const f=fixture(initial,preview);await f.policy.apply({id:'a'},[id],[{name,action:'keep',conditions:{[attribute]:true}},{name,action:'sell'}]);assert.equal(f.confirmed,0,attribute);assert.match(f.events[0].reason,/mudaram|ausente/i);}});
