const test=require('node:test'),assert=require('node:assert/strict');

test('common case choices require positive stock in every selected account and preserve first-account ordering',async()=>{
 const {commonCaseChoices,selectedCaseTotals}=await import('../src/workspaceViewModel.js');
 const snapshots={a:{cases:[{id:'x',amount:5},{id:'y',amount:9},{id:'z',amount:0}]},b:{cases:[{id:'x',amount:3},{id:'y',amount:0},{id:'z',amount:10}]}};
 assert.deepEqual(commonCaseChoices(['a','b'],snapshots),[{id:'x',amount:5}]);
 assert.deepEqual(commonCaseChoices(['a','missing'],snapshots),[]);
 assert.deepEqual(commonCaseChoices([],snapshots),[]);
 assert.deepEqual(commonCaseChoices(['a'],snapshots).map(box=>box.id),['y','x']);
 assert.equal(selectedCaseTotals(['a','b'],snapshots).get('x'),8);
 assert.equal(snapshots.a.cases[0].id,'x','source snapshots must not be reordered');
});

test('stock intersection and totals traverse large account inventories linearly',async()=>{
 const {commonCaseChoices,selectedCaseTotals}=await import('../src/workspaceViewModel.js');
 let reads=0;const ids=Array.from({length:100},(_,i)=>'a'+i),snapshots={};
 for(const id of ids)snapshots[id]={cases:Array.from({length:1000},(_,i)=>({id:'c'+i,get amount(){reads++;return i+1;}}))};
 assert.equal(commonCaseChoices(ids,snapshots).length,1000);
 assert.ok(reads<=104000,'stock reads should grow with total inventory size');
 reads=0;assert.equal(selectedCaseTotals(ids,snapshots).get('c999'),100000);
 assert.equal(reads,100000);
 snapshots.a99.cases[999]={id:'c999',amount:0};
 assert.equal(commonCaseChoices(ids,snapshots).some(box=>box.id==='c999'),false);
});

test('indexed skill states preserve dependency protection for mixed IDs and successor-only edges',async()=>{
 const {skillIndex,skillAvailability}=await import('../src/pages/progressionHelpers.js');
 const data={ownedIds:['1',2,4],money:100,skillPoints:2,rank:3,map:{requiredRankId:2,skills:[{id:1,cost:10},{id:'2',cost:10,requiredPrevSkillId:1},{id:3,cost:10,requiredPrevSkillId:'2'},{id:4,cost:10,nextSkillIds:[2]}]}};
 const index=skillIndex(data);
 assert.equal(index.byId.get('2').id,'2');
 assert.equal(skillAvailability(data,data.map.skills[0],index).canSell,false);
 assert.equal(skillAvailability(data,data.map.skills[3],index).canSell,false);
 assert.equal(skillAvailability(data,data.map.skills[2],index).canBuy,true);
 for(const skill of data.map.skills)assert.deepEqual(skillAvailability(data,skill,index),skillAvailability(data,skill));
});

test('skill lookup scans the map once even when rendering hundreds of nodes',async()=>{
 const {skillIndex,skillAvailability}=await import('../src/pages/progressionHelpers.js');
 let reads=0;const skills=Array.from({length:1000},(_,i)=>({id:i,cost:1,requiredPrevSkillId:i?i-1:null}));
 const data={ownedIds:[0],money:100,skillPoints:2,rank:3,map:{requiredRankId:1,get skills(){reads++;return skills;}}};
 const index=skillIndex(data);
 for(const skill of skills)skillAvailability(data,skill,index);
 assert.equal(reads,1);
});
