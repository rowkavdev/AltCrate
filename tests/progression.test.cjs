const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createAccountQueue}=require('../electron/accountQueue.cjs');
let mod;try{mod=require('../electron/progression.cjs');}catch{}
const NAMES=['Dust II','Mirage','Inferno','Ancient','Anubis','Cobblestone'];
const config=()=>({favoriteLowFloats:true,favoriteHighFloats:true,favoriteCustomFloats:false,favoritePatterns:true,autosellActivated:false,autosellAmount:5000,autosellVariant:'money',customLowFloat:0.00001,customHighFloat:0.99999,customSelectedFloats:[],patternBlacklist:[]});
function fixture(options={}){
 const calls=[],events=[],state={identity:'person',money:100000000,skillPoints:1000,rank:20,owned:[],reward:1.5,config:config(),activePresetId:null,...options.state};
 const maps=Object.fromEntries(NAMES.map((name,i)=>[name,{name,requiredRankId:0,image:'/map.png',skills:[{id:'abcdef'[i]+'1',name:'Root',cost:10,requiredPrevSkillId:null,nextSkillIds:['abcdef'[i]+'2'],rewards:['11;0.1'],waypointX:5,waypointY:10},{id:'abcdef'[i]+'2',name:'Child',cost:20,requiredPrevSkillId:'abcdef'[i]+'1',nextSkillIds:[],rewards:['15;1'],waypointX:10,waypointY:20}]}]));
 const response=(body,status=200)=>({ok:status>=200&&status<300,status,headers:{get:()=> '2'},json:async()=>structuredClone(body),text:async()=>JSON.stringify(body)});
 const fetcher=async(path,opts={})=>{
  calls.push({path,method:opts.method||'GET',body:opts.body?JSON.parse(opts.body):null});
  if(options.intercept){const result=await options.intercept(path,opts,state,response);if(result)return result;}
  if(path==='/api/auth/token')return response({token:'h.'+Buffer.from(JSON.stringify({id:state.identity})).toString('base64url')+'.s'});
  if(path==='/api/me')return response({...state,email:'hidden@example.com',token:'hidden'});
  if(path==='/api/rewards'&&opts.method==='POST'){state.reward=2.5;return response({name:'Reward'});}
  if(path==='/api/rewards')return response({nextClickReward:state.reward===null?null:{reward:{id:state.reward,requiredClicks:10,rewardString:'11;0.1'},isRedeemable:true,currentClicks:10}});
  if(path==='/api/missions')return response([{_id:'mission',goal:'clicks',currentAmount:2,targetAmount:10,redeemed:false}]);
  if(path==='/api/monthlyPass')return response({points:23,tier:2,token:'hidden',rewards:[{id:1,claimed:false}]});
  if(path==='/api/cases')return response([{_id:'box',amount:12}]);
  if(path.startsWith('/skillmaps/')){const name=path.endsWith('de_dust_2')?'Dust II':decodeURIComponent(path.slice('/skillmaps/'.length));const html='<script id="__NEXT_DATA__" type="application/json">'+JSON.stringify({props:{pageProps:{skillmap:JSON.stringify(maps[name]),skillIds:JSON.stringify(state.owned)}}})+'</script>';return {...response(null),text:async()=>html};}
  if(path==='/api/skill'){const body=JSON.parse(opts.body),node=maps[body.mapName].skills.find(s=>s.id===body.skillId);if(opts.method==='POST'){state.owned.push(body.skillId);state.skillPoints--;state.money-=node.cost;}else{state.owned=state.owned.filter(x=>x!==body.skillId);state.skillPoints++;state.money+=node.cost/2;}return response({});}
  if(path==='/api/user/autoOpen/presets')return response([{_id:'preset',name:'Site',config:config()}]);
  if(path==='/api/user/autoOpen/config'&&opts.method==='PUT'){const b=JSON.parse(opts.body);state.config=b.config;state.activePresetId=b.activePresetId;return response({});}
  if(path==='/api/user/autoOpen/config')return response({...state.config,activePresetId:state.activePresetId});
  throw Error('Unknown fixture request '+path);
 };
 return {calls,state,maps,events,response,fetcher,service(){assert.equal(typeof mod?.createProgressionService,'function','Progression service is implemented');return mod.createProgressionService({listAccounts:async()=>[{id:'a'},{id:'b'}],fetchForAccount:()=>fetcher,accountQueue:createAccountQueue(),emit:e=>events.push(e),...options.dependencies});}};
}
test('reads fractional reward ids and only selected mission/pass/diagnostic fields',async()=>{
 const f=fixture(),s=f.service(),r=await s.rewards('a');assert.equal(r.tracks[0].id,1.5);assert.equal(r.tracks[0].eligible,true);assert.equal(r.tracks[0].progress,1);
 const m=await s.missions('a');assert.equal(m.missions[0].progress,0.2);assert.equal(m.pass.points,23);assert.equal(JSON.stringify(m).includes('hidden'),false);
 const d=await s.diagnostics('a');assert.equal(d.after.money,100000000);assert.equal(d.after.casesTotal,12);assert.equal(JSON.stringify(d).includes('hidden'),false);f.state.money--;assert.equal((await s.diagnostics('a')).changes.find(x=>x.field==='money').after,99999999);
});
test('reads all six live maps and marks prerequisites/owned nodes',async()=>{
 const f=fixture({state:{owned:['a1']}}),s=f.service();for(const name of NAMES){const r=await s.skills('a',name);assert.equal(r.map.name,name);assert.equal(r.map.skills.length,2);assert.equal(r.skillPoints,1000);}
 assert.equal((await s.skills('a','Dust II')).map.skills[1].available,true);await assert.rejects(s.skills('a','Other'),/Mapa/);
});
test('offline presets extract exact ids without executing supplied script or silently resetting',async()=>{
 const f=fixture(),s=f.service(),p=s.presets();assert.equal(p.find(x=>x.id==='f27f31MaxCasesBuild').skillIds.length,54);assert.equal(p.find(x=>x.id==='imageBuild').skillIds.length,54);assert.equal(p.length,6);assert.ok(p.every(x=>!x.description.includes('33.3%')));
 await assert.rejects(s.prepare('a','skill-preset',{presetId:'sellMap',reset:false}),/explícit/);
});
test('fractional reward confirmation posts numeric id and verifies the next track',async()=>{
 const f=fixture(),s=f.service(),p=await s.prepare('a','reward',{id:1.5});p.steps.length=0;const result=await s.confirm(p.previewId);assert.equal(result.verified,true);assert.equal(result.state,'completed');assert.deepEqual(f.calls.find(x=>x.method==='POST').body,{id:1.5});assert.equal((await s.confirm(p.previewId)).operationId,result.operationId);
});
test('skill buys require fresh prerequisites/points/money/rank and sales refuse owned children',async()=>{
 const f=fixture(),s=f.service();await assert.rejects(s.prepare('a','skill-buy',{mapName:'Dust II',skillId:'a2'}),/Depend/);f.state.skillPoints=0;await assert.rejects(s.prepare('a','skill-buy',{mapName:'Dust II',skillId:'a1'}),/Pontos/);f.state.skillPoints=10;f.state.money=1;await assert.rejects(s.prepare('a','skill-buy',{mapName:'Dust II',skillId:'a1'}),/Saldo/);f.state.money=100;f.maps['Dust II'].requiredRankId=21;await assert.rejects(s.prepare('a','skill-buy',{mapName:'Dust II',skillId:'a1'}),/nível/);f.maps['Dust II'].requiredRankId=0;f.state.owned=['a1','a2'];await assert.rejects(s.prepare('a','skill-sell',{mapName:'Dust II',skillId:'a1'}),/Depend/);
 const p=await s.prepare('a','skill-sell',{mapName:'Dust II',skillId:'a2'});assert.equal(p.refund,10);assert.equal((await s.confirm(p.previewId)).verified,true);assert.deepEqual(f.state.owned,['a1']);
});
test('invalid payloads, arbitrary endpoints, stale review and changed identity never mutate',async()=>{
 let time=1;const f=fixture({dependencies:{now:()=>time}}),s=f.service();for(const [kind,payload]of [['reward',{id:'1.5'}],['reward',{id:1.5,url:'/bad'}],['skill-buy',{mapName:'Dust II',skillId:'a1',reset:true}],['autoopen',{config:{...config(),endpoint:'/bad'}}]])await assert.rejects(s.prepare('a',kind,payload));
 const p=await s.prepare('a','reward',{id:1.5});f.state.identity='other';await assert.rejects(s.confirm(p.previewId),/sessão/);f.state.identity='person';const q=await s.prepare('a','reward',{id:1.5});time+=300001;await assert.rejects(s.confirm(q.previewId),/expir/);assert.equal(f.calls.filter(x=>x.method==='POST').length,0);
});
test('auto-open compares documented fields, requires fresh review and verifies saved settings',async()=>{
 const f=fixture(),s=f.service(),r=await s.autoOpen('a');assert.equal(r.presets[0].id,'preset');const p=await s.prepare('a','autoopen',{config:{...r.config,autosellAmount:6000},activePresetId:'preset'});assert.ok(p.changes.some(x=>x.field==='autosellAmount'));const result=await s.confirm(p.previewId);assert.equal(result.verified,true);assert.equal(f.state.config.autosellAmount,6000);
 const q=await s.prepare('a','autoopen',{config:{...f.state.config,autosellAmount:7000},activePresetId:'preset'});f.state.config.autosellAmount=500;await assert.rejects(s.confirm(q.previewId),/alter/);
});
test('timeout mutation is sent once, blocks account and only verify can clear it',async()=>{
 let timeout=true;const f=fixture({intercept:async(path,opts,state)=>{if(path==='/api/skill'&&opts.method==='POST'&&timeout){timeout=false;state.owned.push('a1');throw Error('timeout');}}}),s=f.service();const p=await s.prepare('a','skill-buy',{mapName:'Dust II',skillId:'a1'}),r=await s.confirm(p.previewId);assert.equal(r.state,'unconfirmed');await assert.rejects(s.prepare('a','reward',{id:1.5}),/pendente/);const v=await s.verify(r.operationId);assert.equal(v.verified,true);assert.equal(f.calls.filter(x=>x.method==='POST').length,1);
});
test('successful response without observed membership blocks and does not repeat mutation',async()=>{
 const f=fixture({intercept:async(path,opts,state,response)=>path==='/api/skill'&&opts.method==='POST'?response({}):null}),s=f.service();const p=await s.prepare('a','skill-buy',{mapName:'Dust II',skillId:'a1'}),r=await s.confirm(p.previewId);assert.equal(r.state,'unconfirmed');assert.equal((await s.verify(r.operationId)).state,'unconfirmed');assert.equal(f.calls.filter(x=>x.method==='POST').length,1);
});
test('429 stops once and applies the coordinator deadline',async()=>{
 const limits=[];const f=fixture({intercept:async(path,opts,state,response)=>path==='/api/skill'&&opts.method==='POST'?response({},429):null,dependencies:{coordinator:{cooldown:async()=>0,limit:async(...args)=>limits.push(args)}}}),s=f.service();const p=await s.prepare('a','skill-buy',{mapName:'Dust II',skillId:'a1'});assert.equal((await s.confirm(p.previewId)).state,'failed');assert.equal(limits.length,1);assert.equal(f.calls.filter(x=>x.method==='POST').length,1);
});
test('explicit reset sells leaves before parents and can stop between verified steps',async()=>{
 const f=fixture({state:{owned:['a1','a2']}}),s=f.service();const p=await s.prepare('a','skill-preset',{presetId:'sellMap',reset:true});assert.equal(p.refund,15);assert.equal(p.loss,15);assert.deepEqual(p.steps.map(x=>x.skillId),['a2','a1']);let stopped=false;f.events.push=event=>{if(event.completed===1&&!stopped){stopped=true;s.stop('a');}return 0;};const r=await s.confirm(p.previewId);assert.equal(r.state,'stopped');assert.deepEqual(f.state.owned,['a1']);assert.equal(f.calls.filter(x=>x.method==='DELETE').length,1);
});
test('malformed live schemas never fall back to script costs',async()=>{
 const f=fixture(),s=f.service();f.maps['Dust II'].skills[0].cost=null;await assert.rejects(s.skills('a','Dust II'),/inválid/);await assert.rejects(s.prepare('a','skill-buy',{mapName:'Dust II',skillId:'a1'}),/inválid/);assert.equal(f.calls.filter(x=>x.method==='POST').length,0);
});
test('monthly pass exposes tier arrays/track but no private fields',async()=>{
 const f=fixture({intercept:async(path,opts,state,response)=>path==='/api/monthlyPass'?response({period:'2026-10',endsAt:'2026-11-01T00:00:00Z',points:23,tier:2,pointsToNextTier:7,maxPoints:100,totalTiers:10,pointsPerTier:10,isPremium:true,claimedFreeTiers:[1],claimedPremiumTiers:[],claimableFreeTiers:[2],claimablePremiumTiers:[2],proFreePassAvailable:false,track:[{tier:1,freeReward:'11;1',premiumReward:null,userId:'hidden'}],userId:'hidden'}):null}),s=f.service(),r=await s.missions('a');assert.deepEqual(r.pass.claimableFreeTiers,[2]);assert.equal(r.pass.track[0].freeReward,'11;1');assert.equal(r.pass.endsAt,'2026-11-01T00:00:00Z');assert.equal(JSON.stringify(r).includes('hidden'),false);
});
test('Premier requirement blocks purchases when rank is missing or below live map requirement',async()=>{
 const f=fixture(),s=f.service();f.maps['Dust II'].requiredPremierId=3;await assert.rejects(s.prepare('a','skill-buy',{mapName:'Dust II',skillId:'a1'}),/Premier/);f.state.premierRank={id:2};await assert.rejects(s.prepare('a','skill-buy',{mapName:'Dust II',skillId:'a1'}),/Premier/);f.state.premierRank={id:3};assert.equal((await s.skills('a','Dust II')).map.skills[0].available,true);assert.equal((await s.confirm((await s.prepare('a','skill-buy',{mapName:'Dust II',skillId:'a1'})).previewId)).verified,true);
});
function presetMaps(f,preset){for(const [i,name]of NAMES.entries()){const ids=preset.skillIds.filter(id=>id[0]==='abcdef'[i]);f.maps[name].skills=ids.map((id,index)=>({id,name:id,cost:10,requiredPrevSkillId:ids[index-1]||null,nextSkillIds:ids[index+1]?[ids[index+1]]:[],rewards:['11;0.1'],waypointX:1,waypointY:1}));}}
test('multi-map preset adds only missing nodes in prerequisite order without implicit sales',async()=>{
 const f=fixture(),s=f.service(),preset=s.presets().find(x=>x.id==='f27f31MaxCasesBuild');presetMaps(f,preset);f.state.owned=[preset.skillIds[0]];const p=await s.prepare('a','skill-preset',{presetId:preset.id});assert.equal(p.steps.length,53);assert.ok(p.steps.every(x=>x.kind==='skill-buy'));const r=await s.confirm(p.previewId);assert.equal(r.state,'completed');assert.equal(r.completed,53);assert.equal(f.state.owned.length,54);assert.equal(f.calls.some(x=>x.method==='DELETE'),false);
});
test('preset missing live prerequisite is unavailable and partial rejection stops later actions',async()=>{
 let sends=0;const f=fixture({intercept:async(path,opts,state,response)=>{if(path==='/api/skill'&&opts.method==='POST'&&++sends===2)return response({},400);}}),s=f.service(),preset=s.presets().find(x=>x.id==='imageBuild');presetMaps(f,preset);const node=f.maps.Cobblestone.skills[1],parent=node.requiredPrevSkillId;node.requiredPrevSkillId='f999';await assert.rejects(s.prepare('a','skill-preset',{presetId:preset.id}),/Depend/);node.requiredPrevSkillId=parent;const p=await s.prepare('a','skill-preset',{presetId:preset.id}),r=await s.confirm(p.previewId);assert.equal(r.state,'failed');assert.equal(r.completed,1);assert.equal(f.state.owned.length,1);assert.equal(sends,2);
});
test('fresh eligibility and mutation guard changes prevent sends even after a valid preview',async()=>{
 let blocked=false;const f=fixture({dependencies:{mutationGuard:async()=>{if(blocked)throw Error('Farm ativo');}}}),s=f.service(),p=await s.prepare('a','skill-buy',{mapName:'Dust II',skillId:'a1'});f.state.money=1;await assert.rejects(s.confirm(p.previewId),/Saldo/);f.state.money=100;const q=await s.prepare('a','skill-buy',{mapName:'Dust II',skillId:'a1'});blocked=true;assert.equal((await s.confirm(q.previewId)).state,'failed');assert.equal(f.calls.filter(x=>x.method==='POST').length,0);
});
test('account switches retain the preview account and separate diagnostic snapshots',async()=>{
 const a=fixture(),b=fixture({state:{identity:'other',money:50}}),s=a.service();const multi=mod.createProgressionService({listAccounts:async()=>[{id:'a'},{id:'b'}],fetchForAccount:account=>account.id==='a'?a.fetcher:b.fetcher,accountQueue:createAccountQueue()});const p=await multi.prepare('a','reward',{id:1.5});assert.equal((await multi.diagnostics('b')).after.money,50);assert.equal((await multi.confirm(p.previewId)).accountId,'a');assert.equal(a.state.reward,2.5);assert.equal(b.state.reward,1.5);assert.equal((await multi.diagnostics('a')).before,null);
});
test('concurrent confirmations serialize safely even when an external account queue is absent',async()=>{
 const f=fixture({dependencies:{accountQueue:undefined}}),s=f.service(),p=await s.prepare('a','reward',{id:1.5}),q=await s.prepare('a','reward',{id:1.5});await Promise.allSettled([s.confirm(p.previewId),s.confirm(q.previewId)]);assert.equal(f.calls.filter(x=>x.method==='POST').length,1);
});
test('transport timeout aborts a hanging mutation and retains an unconfirmed operation',async()=>{
 let signal;const f=fixture({dependencies:{requestTimeoutMs:10},intercept:async(path,opts)=>{if(path==='/api/skill'&&opts.method==='POST'){signal=opts.signal;return new Promise(()=>{});}}}),s=f.service(),p=await s.prepare('a','skill-buy',{mapName:'Dust II',skillId:'a1'});const result=await s.confirm(p.previewId);assert.equal(result.state,'unconfirmed');assert.equal(signal.aborted,true);assert.equal(f.calls.filter(x=>x.method==='POST').length,1);
});
test('stop requested during confirmation preflight prevents the first mutation',async()=>{
 let waiting=false,release,entered;const paused=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});const f=fixture({intercept:async(path,opts)=>{if(waiting&&path==='/api/auth/token'){waiting=false;entered();await paused;}}}),s=f.service(),p=await s.prepare('a','skill-buy',{mapName:'Dust II',skillId:'a1'});waiting=true;const confirmation=s.confirm(p.previewId);await started;s.stop('a');release();const result=await confirmation;assert.equal(result.state,'stopped');assert.equal(result.completed,0);assert.equal(f.calls.filter(x=>x.method==='POST').length,0);
});
test('internal pending accessor stays true until an ambiguous mutation is verified',async()=>{
 const f=fixture({intercept:async(path,opts,state)=>{if(path==='/api/skill'&&opts.method==='POST'){state.owned.push('a1');throw Error('timeout');}}}),s=f.service();assert.equal(typeof s.hasPending,'function');assert.equal(s.hasPending(),false);const p=await s.prepare('a','skill-buy',{mapName:'Dust II',skillId:'a1'}),r=await s.confirm(p.previewId);assert.equal(s.hasPending(),true);await s.verify(r.operationId);assert.equal(s.hasPending(),false);
});
test('a reviewed operation that expires while waiting in the account queue sends nothing',async()=>{
 let time=0,release,entered;const wait=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});const f=fixture({dependencies:{now:()=>time,accountQueue:{run:async(accountId,work)=>{entered();await wait;return work();}}}}),s=f.service(),p=await s.prepare('a','reward',{id:1.5}),confirmation=s.confirm(p.previewId);await started;time=300001;release();await assert.rejects(confirmation,/expir/);assert.equal(f.calls.filter(x=>x.method==='POST').length,0);
});
test('a review that expires during the final mutation guard sends nothing',async()=>{
 let time=0;const f=fixture({dependencies:{now:()=>time,mutationGuard:async()=>{time=300001;}}}),s=f.service(),p=await s.prepare('a','reward',{id:1.5}),r=await s.confirm(p.previewId);assert.equal(r.state,'failed');assert.match(r.message,/expir/);assert.equal(f.calls.filter(x=>x.method==='POST').length,0);
});
test('live reward counters without current prefix retain observed progress and Portuguese labels',async()=>{
 const pairs=[['nextOpenedCasesReward','requiredOpenedCases','openedCases','Caixas abertas'],['nextInventoryValueReward','requiredInventoryValue','inventoryValue','Valor do inventário'],['nextCoinflipsReward','requiredCoinflips','coinflips','Coinflip'],['nextUpgradesReward','requiredUpgrades','upgrades','Upgrades'],['nextCasebattlesReward','requiredCasebattles','casebattles','Batalhas de caixas'],['nextMembershipTimeReward','requiredMembershipTime','membership','Tempo de membro'],['nextClickReward','requiredClicks','clicks','Cliques'],['nextJackpotReward','requiredJackpots','jackpots','Jackpot'],['nextTradeUpReward','requiredTradeUps','tradeUps','Trade-ups'],['nextSkinCollectionReward','requiredSkinCollections','skinCollections','Coleções de skins'],['nextDicesReward','requiredDices','dices','Dados'],['nextMissionReward','requiredMissions','missions','Missões'],['nextGuessTheRankReward','requiredGuessTheRanks','guessTheRanks','Adivinhar o rank'],['nextBlackjackReward','requiredBlackjacks','blackjacks','Blackjack'],['nextCrashReward','requiredCrashes','crashes','Crash']];
 const body=Object.fromEntries(pairs.map(([key,required,counter],index)=>[key,{reward:{id:index+1.5,[required]:100,rewardString:'10;300'},isRedeemable:false,[counter]:25}]));body.nextRankReward=null;body.nextPlinkoReward=null;body.nextPremierReward={reward:{id:20.5,requiredPremierId:7.1,rewardString:'1;5000000'},isRedeemable:false};
 const f=fixture({intercept:async(path,opts,state,response)=>path==='/api/rewards'?response(body):null}),s=f.service(),r=await s.rewards('a');for(const [key,field,counter,title]of pairs){const t=r.tracks.find(x=>x.key===key);assert.equal(t.title,title);assert.equal(t.current,25);assert.equal(t.target,100);assert.equal(t.progress,0.25);assert.equal(typeof t.requirement[0].label,'string');assert.equal(t.requirement[0].field,field);}
 for(const key of ['nextRankReward','nextPlinkoReward']){const t=r.tracks.find(x=>x.key===key);assert.equal(t.current,null);assert.equal(t.target,null);assert.equal(t.progress,null);assert.equal(t.complete,true);}
 const premier=r.tracks.find(x=>x.key==='nextPremierReward');assert.equal(premier.current,null);assert.equal(premier.progress,null);assert.equal(premier.target,7.1);
});
test('public client reward codes decode verified money knives tokens tickets credits and preserve parameters',async()=>{
 const body={nextClickReward:{reward:{id:1.5,requiredClicks:100,rewardString:'1;5000000,2;20,10;300,31;40,32;5,24;1;Restricted,99;4;unknown'},isRedeemable:true,clicks:100}};const f=fixture({intercept:async(path,opts,state,response)=>path==='/api/rewards'?response(body):null}),s=f.service(),r=await s.rewards('a'),effects=r.tracks[0].effects;assert.equal(effects[0].description,'Dinheiro virtual');assert.equal(effects[1].description,'Facas aleatórias');assert.equal(effects[2].description,'Tokens');assert.equal(effects[3].description,'Bilhetes de evento');assert.equal(effects[4].description,'Créditos da Armory');assert.deepEqual(effects[5].parameters,['Restricted']);assert.ok(effects[5].description.includes('Restricted'));assert.equal(effects[6].code,'99;4;unknown');assert.ok(effects[6].description.includes('99;4;unknown'));
});
test('public client vault counter and monthly pass descriptions decode without inventing unknown effects',async()=>{
 const f=fixture({intercept:async(path,opts,state,response)=>path==='/api/rewards'?response({nextVaultReward:{reward:{id:3.5,requiredVaultMoneyCollected:1000,rewardString:'13;100'},vaultMoneyCollected:500,isRedeemable:false}}):path==='/api/monthlyPass'?response({points:20,track:[{tier:1,freeReward:'10;300',premiumReward:'32;20'}]}):null}),s=f.service(),reward=(await s.rewards('a')).tracks[0];assert.equal(reward.current,500);assert.equal(reward.progress,0.5);assert.equal(reward.requirement[0].label,'Dinheiro virtual recolhido do cofre');const pass=(await s.missions('a')).pass;assert.equal(pass.track[0].freeEffects[0].description,'Tokens');assert.equal(pass.track[0].premiumEffects[0].description,'Créditos da Armory');
});


test('preset comparison reads all six maps without mutations or private profile fields',async()=>{
 const f=fixture({state:{casesPerClick:1}}),s=f.service(),raw=require('./fixtures/auto-skill-v17.json');for(const [name,nodes]of Object.entries(raw))f.maps[name].skills=nodes;
 const result=await s.presetCatalog('a');assert.equal(result.accountId,'a');assert.equal(result.presets.filter(p=>!p.resetOnly).length,5);assert.equal(result.presets.find(p=>p.id==='f27Build').summary.totalCost,1432270);assert.equal(f.calls.filter(c=>c.path.startsWith('/skillmaps/')).length,6);assert.ok(f.calls.every(c=>c.method==='GET'));assert.equal(JSON.stringify(result).includes('hidden'),false);
});
test('a changed identity during preset comparison does not expose another account result',async()=>{
 let pages=0;const f=fixture({intercept:async(path,opts,state)=>{if(path.startsWith('/skillmaps/')&&++pages===3)state.identity='changed-person';}}),s=f.service();await assert.rejects(s.presetCatalog('a'),/identidade/i);assert.ok(f.calls.every(c=>c.method==='GET'));
});

test('Premier-only map requirements permit qualified accounts without inventing a normal rank requirement',async()=>{
 const f=fixture({state:{premierRank:{id:2}}}),s=f.service();delete f.maps.Cobblestone.requiredRankId;f.maps.Cobblestone.requiredPremierId=2;const data=await s.skills('a','Cobblestone');assert.equal(data.map.rankRequirementOptional,true);assert.equal(data.map.skills[0].available,true);assert.equal((await s.prepare('a','skill-buy',{mapName:'Cobblestone',skillId:'f1'})).steps.length,1);f.state.premierRank={id:1};await assert.rejects(s.prepare('a','skill-buy',{mapName:'Cobblestone',skillId:'f1'}),/Premier/);f.maps.Cobblestone.requiredRankId=null;f.state.premierRank={id:7};await assert.rejects(s.prepare('a','skill-buy',{mapName:'Cobblestone',skillId:'f1'}),/nível/);
});
