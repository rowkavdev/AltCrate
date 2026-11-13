const test=require('node:test'),assert=require('node:assert/strict');
const {loadComponent,render}=require('./helpers/render.cjs');
const model={accounts:[{id:'a',label:'Conta A'}],bridge:{}};
test('new progression pages expose single account reads without starting mutations on render',async()=>{
 for(const name of ['RewardsPage','SkillMapsPage','SiteAutoOpenPage','DiagnosticsPage']){
  const Page=await loadComponent(`/src/pages/${name}.jsx`);
  let writes=0;const html=render(Page,{model:{...model,bridge:{prepareProgression(){writes++},confirmProgression(){writes++}}},ui:{},onUiChange(){}});
  assert.match(html,/Conta A/);assert.equal(writes,0);assert.match(html,/conta|Conta/);
 }
});
test('request guard discards late account reads and replaced previews',async()=>{
 const {createScopeGuard}=await import('../src/pages/progressionHelpers.js');
 const guard=createScopeGuard();guard.setScope('a');const old=guard.ticket('read');
 guard.setScope('b');assert.equal(guard.current(old),false);
 const first=guard.ticket('preview'),second=guard.ticket('preview');assert.equal(guard.current(first),false);assert.equal(guard.current(second),true);
});
test('skill availability considers dependencies, rank, owned children, money and points',async()=>{
 const {skillAvailability}=await import('../src/pages/progressionHelpers.js');
 const data={ownedIds:[1],money:100,skillPoints:1,rank:{id:3},map:{requiredRankId:2,skills:[{id:1,cost:10,nextSkillIds:[2]},{id:2,cost:50,requiredPrevSkillId:1}]}};
 assert.equal(skillAvailability(data,data.map.skills[1]).canBuy,true);
 assert.equal(skillAvailability({...data,skillPoints:0},data.map.skills[1]).canBuy,false);
 assert.equal(skillAvailability({...data,ownedIds:[]},data.map.skills[1]).canBuy,false);
 assert.equal(skillAvailability({...data,ownedIds:[1,2]},data.map.skills[0]).canSell,false);
 assert.equal(skillAvailability({...data,rank:{id:1}},data.map.skills[1]).canBuy,false);
});
test('reward cards retain fractional IDs and only server eligibility enables preview',async()=>{
 const Content=await loadComponent('/src/pages/RewardsPage.jsx','RewardsContent');
 const html=render(Content,{data:{tracks:[{key:'money',id:1.25,title:'Dinheiro',eligible:true,current:3,target:5,description:'+1 por clique'},{key:'cases',id:2,title:'Caixas',eligible:false,current:1,target:10}]},pending:false,onPrepare(){}});
 assert.match(html,/data-reward-id="1.25"/);assert.match(html,/3 \/ 5/);assert.match(html,/disabled[^>]*>Rever recompensa/);assert.match(html,/\+1 por clique/);
});
test('skill map has background positioned nodes and an accessible list with dependencies and costs',async()=>{
 const Content=await loadComponent('/src/pages/SkillMapsPage.jsx','SkillMapContent');
 const html=render(Content,{data:{map:{name:'Dust II',image:'https://case-clicker.com/map.webp',requiredRankId:2,skills:[{id:1,name:'Cofre',cost:20,requiredPrevSkillId:null,rewards:[{type:14,value:5}],waypointX:20,waypointY:40}]},ownedIds:[],money:100,skillPoints:2,rank:{id:3}},onPrepare(){}});
 assert.match(html,/map.webp/);assert.match(html,/left:20%/);assert.match(html,/Lista de habilidades/);assert.match(html,/Cofre/);assert.match(html,/20/);
});
test('diagnostic display never renders unlisted private fields and shows timed before-after evidence',async()=>{
 const Content=await loadComponent('/src/pages/DiagnosticsPage.jsx','DiagnosticsContent');
 const html=render(Content,{data:{before:{money:10,readAt:1000,token:'secret-value',email:'secret-email'},after:{money:20,readAt:2000},changes:[{field:'money',before:10,after:20},{field:'token',before:'secret-value',after:'private'}]}});
 assert.match(html,/Dinheiro virtual/);assert.match(html,/10/);assert.match(html,/20/);assert.doesNotMatch(html,/secret-value|secret-email|private/);
});
test('autoopen review preserves documented arrays and rejects invalid float ranges before preview',async()=>{
 const parse=await loadComponent('/src/pages/SiteAutoOpenPage.jsx','parseAutoOpenDraft');
 const draft={favoriteLowFloats:true,favoriteHighFloats:false,favoriteCustomFloats:true,favoritePatterns:false,autosellActivated:false,autosellAmount:'12',autosellVariant:'tokens',customLowFloat:'0.01',customHighFloat:'0.99',customSelectedFloats:'0.1, 0.25',patternBlacklist:'pattern-one\npattern-two',activePresetId:'preset'};
 const result=parse(draft);assert.deepEqual(result.config.customSelectedFloats,[0.1,0.25]);assert.deepEqual(result.config.patternBlacklist,['pattern-one','pattern-two']);assert.equal(result.activePresetId,'preset');assert.equal(result.config.autosellAmount,12);
 assert.throws(()=>parse({...draft,customLowFloat:1,customHighFloat:0}),/intervalo/);
 assert.throws(()=>parse({...draft,customSelectedFloats:'bad'}),/float personalizado/);
});
test('monthly pass renders observed points and free-premium rewards by tier',async()=>{
 const Content=await loadComponent('/src/pages/RewardsPage.jsx','MonthlyPassContent');
 const html=render(Content,{pass:{period:'2026-10',endsAt:'2099-11-01T00:00:00Z',points:100,tier:2,pointsToNextTier:50,isPremium:true,claimedFreeTiers:[1],claimablePremiumTiers:[2],track:[{tier:1,freeReward:'Caixas',premiumReward:'Tokens'},{tier:2,freeReward:'Dinheiro virtual',premiumReward:'Pontos'}]}});
 assert.match(html,/2026-10/);assert.match(html,/50/);assert.match(html,/Caixas/);assert.match(html,/Tokens/);assert.match(html,/Premium/);assert.match(html,/Recolhido/);assert.match(html,/Disponível/);
});
test('live encoded skill effects are decoded with unknown effects identified',async()=>{
 const effects=await loadComponent('/src/pages/SkillMapsPage.jsx','skillEffects');
 assert.equal(effects(['11;1','14;5','987;2']),'Dinheiro por clique: 1 · Geração do cofre por minuto: 5 · Efeito desconhecido (987): 2');
});
test('confirmation explicitly displays reset loss and account ownership',async()=>{
 const Dialog=await loadComponent('/src/pages/progressionShared.jsx','PreviewDialog');
 const html=render(Dialog,{accountLabel:'Conta A',preview:{title:'Preset',cost:100,refund:50,pointCost:2,loss:50,steps:[],warnings:[]},pending:false,onClose(){},onConfirm(){}});
 assert.match(html,/Conta A/);assert.match(html,/Perda virtual do reset/);assert.match(html,/Confirmar alteração/);assert.match(html,/aria-modal="true"/);
});
test('stop remains independent while confirmation waits and double confirmation is excluded',async()=>{
 const {createScopedActions}=await import('../src/pages/progressionHelpers.js');
 const actions=createScopedActions();actions.setScope('a');let release,writes=0,stops=0;
 const pending=actions.run('action',()=>{writes++;return new Promise(resolve=>release=resolve);});
 await actions.run('action',()=>{writes++;});assert.equal(writes,1);
 await actions.run('stop',async()=>{stops++;return {state:'stopping'};});assert.equal(stops,1);release({state:'confirmed'});await pending;
 await actions.run('action',async()=>{writes++;});assert.equal(writes,2);
});
test('late confirmation callbacks cannot update the newly selected account',async()=>{
 const {createScopedActions}=await import('../src/pages/progressionHelpers.js');
 const actions=createScopedActions();actions.setScope('a');let release,updates=[];
 const pending=actions.run('action',()=>new Promise(resolve=>release=resolve),{onSuccess:value=>updates.push(value)});
 actions.setScope('b');await actions.run('action',async()=> 'B',{onSuccess:value=>updates.push(value)});release('A');await pending;assert.deepEqual(updates,['B']);
});
test('autoopen observed configuration and reviewed changes use human labels',async()=>{
 const Table=await loadComponent('/src/pages/progressionShared.jsx','ChangesTable');
 const html=render(Table,{changes:[{field:'favoriteLowFloats',before:false,after:true},{field:'customLowFloat',before:0,after:0.1}]});
 assert.match(html,/Marcar floats baixos como favoritos/);assert.doesNotMatch(html,/favoriteLowFloats|customLowFloat/);
});
test('skill review stays locked when balances or requirements are unavailable',async()=>{
 const {skillAvailability}=await import('../src/pages/progressionHelpers.js');const skill={id:'a1',cost:0,requiredPrevSkillId:null,nextSkillIds:[]};
 const data={ownedIds:[],map:{requiredRankId:1,skills:[skill]},rank:3,money:0,skillPoints:1};
 assert.equal(skillAvailability({...data,money:null},skill).canBuy,false);assert.equal(skillAvailability({...data,map:{...data.map,requiredRankId:null}},skill).canBuy,false);
 const premier={...data,map:{...data.map,requiredPremierId:2},premierRank:1};assert.equal(skillAvailability(premier,skill).canBuy,false);
});
test('pass tracks show decoded server effects and explicitly unknown effects instead of codes',async()=>{
 const Content=await loadComponent('/src/pages/RewardsPage.jsx','MonthlyPassContent');
 const html=render(Content,{pass:{points:100,track:[{tier:1,freeReward:'11;1',freeEffects:[{type:11,amount:1,description:'Dinheiro por clique'}],premiumReward:'987;2',premiumEffects:[{type:987,amount:2,description:'Efeito desconhecido (987)'}]}]}});
 assert.match(html,/Dinheiro por clique/);assert.match(html,/Efeito desconhecido \(987\)/);assert.doesNotMatch(html,/11;1|987;2/);
});

test('Premier-only maps use their verified requirement and retain the Premier lock',async()=>{const {skillAvailability}=await import('../src/pages/progressionHelpers.js');const skill={id:'f1',cost:10,requiredPrevSkillId:null,nextSkillIds:[]},data={map:{skills:[skill],requiredRankId:null,requiredPremierId:2,rankRequirementOptional:true},ownedIds:[],rank:18,premierRank:7,money:100,skillPoints:1};assert.equal(skillAvailability(data,skill).canBuy,true);assert.equal(skillAvailability({...data,premierRank:1},skill).canBuy,false);assert.equal(skillAvailability({...data,map:{...data.map,rankRequirementOptional:false}},skill).canBuy,false);});
