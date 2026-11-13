const test=require('node:test'),assert=require('node:assert/strict');
const maps=require('./fixtures/auto-skill-v17.json'),presets=require('../electron/skillPresets.json');
const {summarizePresets}=require('../electron/skillPresetSummary.cjs');
const profile={money:10000000,skillPoints:54,casesPerClick:1,moneyPerClick:0.1,vaultCapacity:10,vaultMoneyPerMinute:1,caseOpenCount:1,maxCaseOpenMultiplier:1};
const states=(owned=[])=>Object.entries(maps).map(([name,skills])=>({map:{name,skills,requiredRankId:0,requiredPremierId:null},ownedIds:[...owned],rank:20,premierRank:0,money:profile.money,skillPoints:54}));
test('all five supplied builds contain 54 unique skills with complete dependencies and independent totals',()=>{
 const rows=summarizePresets(presets,states(),profile),expected={f27f31MaxCasesBuild:[6158850,25.5,25],imageBuild:[4997050,32.5,9],optimizedBuild:[213930,32.65,6],f27Build:[1432270,33.65,6],maxClickBuild:[1120950,15.5,5]};
 assert.equal(Object.values(maps).flat().length,195);assert.equal(rows.filter(p=>!p.resetOnly).length,5);
 for(const p of rows.filter(p=>!p.resetOnly)){const [cost,chance,opens]=expected[p.id];assert.equal(p.summary.available,true);assert.equal(p.summary.totalPoints,54);assert.equal(p.summary.totalCost,cost);assert.equal(p.summary.bonuses[15],chance);assert.equal(p.summary.bonuses[17],opens);assert.equal(p.summary.missingPoints,54);assert.equal(p.summary.canAdd,true);}
 assert.equal(rows[1].summary.projection.reset.casesPerClick,26.5);assert.equal(rows[1].summary.projection.reset.maxCaseOpenMultiplier,2);
});
test('projections retain actual account bonuses and distinguish adding from a full reset',()=>{
 const owned=presets.find(p=>p.id==='f27Build').skillIds,live={...profile,casesPerClick:34.65,moneyPerClick:0.232,skillPoints:0};const rows=summarizePresets(presets,states(owned),live),target=rows.find(p=>p.id==='f27f31MaxCasesBuild');
 assert.equal(target.summary.projection.reset.casesPerClick,26.5);assert.ok(target.summary.projection.add.casesPerClick>=34.65);assert.equal(target.summary.canAdd,false);assert.equal(target.summary.ownedPoints,54);assert.ok(target.summary.missingPoints<54);assert.equal(rows.find(p=>p.id==='f27Build').summary.missingCost,0);
});
test('a changed dependency or missing live skill does not produce a valid preset claim',()=>{
 const s=structuredClone(states());s[5].map.skills.find(n=>n.id==='f27').requiredPrevSkillId='f999';const row=summarizePresets(presets,s,profile).find(p=>p.id==='f27Build');assert.equal(row.summary.available,false);assert.match(row.summary.reason,/dependência/i);
 const missing=structuredClone(states());missing[5].map.skills=missing[5].map.skills.filter(n=>n.id!=='f27');assert.equal(summarizePresets(presets,missing,profile).find(p=>p.id==='f27Build').summary.available,false);
});
test('mixed ownership between pages and duplicate map IDs are rejected',()=>{
 const s=states();s[1].ownedIds=['a1'];assert.throws(()=>summarizePresets(presets,s,profile),/alteradas/);const d=structuredClone(states());d[1].map.skills[0].id='a1';assert.throws(()=>summarizePresets(presets,d,profile),/duplicado/);
});
test('resource and map rank requirements remain visible rather than implying applicability',()=>{
 const s=states();s[5].rank=0;s[5].map.requiredRankId=18;const rows=summarizePresets(presets,s,{...profile,money:0,skillPoints:0,casesPerClick:null});const p=rows.find(p=>p.id==='f27Build');assert.equal(p.summary.canAdd,false);assert.ok(p.summary.warnings.length);assert.equal(p.summary.projection.add.casesPerClick,null);
});
