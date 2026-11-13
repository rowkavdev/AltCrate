const test=require('node:test'),assert=require('node:assert/strict');
const {createProgressionService}=require('../electron/progression.cjs');
const missionId='abcddcba-1234-4567-890a-abcdef123456';
const instant=Date.parse('2026-10-14T12:00:00Z');
const config={favoriteLowFloats:true,favoriteHighFloats:false,favoriteCustomFloats:false,favoritePatterns:false,autosellActivated:false,autosellAmount:5000,autosellVariant:'money',customLowFloat:0,customHighFloat:1,customSelectedFloats:[],patternBlacklist:[]};
function fixture({intercept,enabled=true,mutationGuard}={}){
 const calls=[],state={enabled,identity:'account',missions:[{id:missionId,goal:'clickedCases',currentAmount:25000,targetAmount:25000,maxAmount:25000,redeemed:false,isRedeemable:true,duration:'week',validTill:'2026-10-20T00:00:00Z'}],pass:{period:'2026-10',endsAt:'2026-11-01T00:00:00Z',points:45,tier:3,isPremium:true,claimedFreeTiers:[],claimedPremiumTiers:[],claimableFreeTiers:[2],claimablePremiumTiers:[2,3],track:[{tier:2,freeReward:'1;20000',premiumReward:'25;1500'},{tier:3,freeReward:null,premiumReward:'10;25000'}]}};
 const response=(body,status=200)=>({status,ok:status>=200&&status<300,headers:{get:()=>null},json:async()=>structuredClone(body)});
 const fetcher=async(path,init)=>{
  const method=init.method,body=init.body?JSON.parse(init.body):null;calls.push({path,method,body});
  const custom=await intercept?.(path,init,state,response);if(custom)return custom;
  if(path==='/api/auth/token')return response({token:'h.'+Buffer.from(JSON.stringify({id:state.identity})).toString('base64url')+'.s'});
  if(path==='/api/missions'&&method==='DELETE'){state.missions.find(m=>m.id===body.id).redeemed=true;state.pass.points+=25;return response({rewardStrings:['money 100'],passProgress:true});}
  if(path==='/api/missions')return response(state.missions);
  if(path==='/api/monthlyPass'&&method==='POST'){const key=body.track==='free'?'Free':'Premium';state.pass['claimed'+key+'Tiers'].push(body.tier);state.pass['claimable'+key+'Tiers']=state.pass['claimable'+key+'Tiers'].filter(t=>t!==body.tier);return response({claimed:[body]});}
  if(path==='/api/monthlyPass')return response(state.pass);
  if(path==='/api/user/autoOpen/config')return response(config);
  if(path==='/api/user/autoOpen/presets')return response([]);
  throw Error('Unexpected fixture request: '+path);
 };
 state.time=instant;
 const service=createProgressionService({listAccounts:async()=>[{id:'a'}],fetchForAccount:()=>fetcher,now:()=>state.time,siteOpeningEnabled:()=>state.enabled,mutationGuard:mutationGuard?()=>mutationGuard(state):undefined});
 return {state,calls,service};
}
const writes=f=>f.calls.filter(c=>c.method!=='GET');
test('mission claim is reviewed, sends DELETE with its exact ID once and verifies redeemed state',async()=>{
 const f=fixture(),p=await f.service.prepare('a','mission',{id:missionId});assert.equal(writes(f).length,0);assert.equal(p.steps[0].passPoints,25);
 const r=await f.service.confirm(p.previewId);assert.equal(r.state,'completed');assert.equal(r.verified,true);assert.deepEqual(writes(f),[{path:'/api/missions',method:'DELETE',body:{id:missionId}}]);
 assert.equal((await f.service.confirm(p.previewId)).operationId,r.operationId);assert.equal(writes(f).length,1);
 await assert.rejects(f.service.prepare('a','mission',{id:missionId}),/elegível|recolhida/);
});
test('expired, incomplete and unavailable missions cannot be claimed',async()=>{
 const f=fixture();f.state.missions[0].isRedeemable=false;await assert.rejects(f.service.prepare('a','mission',{id:missionId}),/elegível/);
 f.state.missions[0].isRedeemable=true;f.state.missions[0].currentAmount=1;await assert.rejects(f.service.prepare('a','mission',{id:missionId}),/elegível/);
 f.state.missions[0].currentAmount=25000;f.state.missions[0].validTill='2026-10-13T00:00:00Z';await assert.rejects(f.service.prepare('a','mission',{id:missionId}),/expir|elegível/);assert.equal(writes(f).length,0);
});
test('pass claims preserve free and premium tracks and only allow server-listed rewards',async()=>{
 for(const track of ['free','premium']){const f=fixture(),p=await f.service.prepare('a','pass',{tier:2,track});assert.equal(writes(f).length,0);assert.equal(p.steps[0].period,'2026-10');assert.equal((await f.service.confirm(p.previewId)).verified,true);assert.deepEqual(writes(f),[{path:'/api/monthlyPass',method:'POST',body:{tier:2,track}}]);}
 const f=fixture();f.state.pass.isPremium=false;await assert.rejects(f.service.prepare('a','pass',{tier:2,track:'premium'}),/Premium|elegível/);await assert.rejects(f.service.prepare('a','pass',{tier:3,track:'free'}),/elegível|recompensa/);assert.equal(writes(f).length,0);
});
test('claim payloads reject extra fields, unvalidated IDs, strings for tiers and premium activation',async()=>{
 const f=fixture();for(const [kind,payload]of [['mission',{id:missionId,url:'/bad'}],['mission',{id:'../bad'}],['pass',{tier:'2',track:'free'}],['pass',{tier:2,track:'all'}],['pass',{tier:2,track:'free',redeemProPass:true}]])await assert.rejects(f.service.prepare('a',kind,payload));assert.equal(writes(f).length,0);
});
test('mission eligibility and pass period are rechecked after the preview',async()=>{
 const f=fixture(),p=await f.service.prepare('a','mission',{id:missionId});f.state.missions[0].redeemed=true;await assert.rejects(f.service.confirm(p.previewId),/elegível|recolhida/);assert.equal(writes(f).length,0);
 const g=fixture(),q=await g.service.prepare('a','pass',{tier:2,track:'free'});g.state.pass.period='2026-11';await assert.rejects(g.service.confirm(q.previewId),/alter|período/);assert.equal(writes(g).length,0);
});
test('an ambiguous mission claim blocks repeats until its redeemed state is read back',async()=>{
 const f=fixture({intercept:async(path,init,state)=>{if(path==='/api/missions'&&init.method==='DELETE'){state.missions[0].redeemed=true;throw Error('timeout');}}}),p=await f.service.prepare('a','mission',{id:missionId}),r=await f.service.confirm(p.previewId);
 assert.equal(r.state,'unconfirmed');assert.equal(f.service.hasPending(),true);assert.equal((await f.service.verify(r.operationId)).verified,true);assert.equal(writes(f).length,1);
});
test('missing mission or a different pass period is never treated as confirmed collection',async()=>{
 const f=fixture({intercept:async(path,init,state,response)=>{if(path==='/api/missions'&&init.method==='DELETE'){state.missions=[];return response({});}}}),p=await f.service.prepare('a','mission',{id:missionId}),r=await f.service.confirm(p.previewId);assert.equal(r.state,'unconfirmed');assert.equal((await f.service.verify(r.operationId)).verified,false);assert.equal(writes(f).length,1);
 const g=fixture({intercept:async(path,init,state)=>{if(path==='/api/monthlyPass'&&init.method==='POST')state.pass.period='2026-11';}}),q=await g.service.prepare('a','pass',{tier:2,track:'free'}),s=await g.service.confirm(q.previewId);assert.equal(s.state,'unconfirmed');assert.equal(writes(g).length,1);
});
test('disabled opening preferences reject reads and writes but mission claims remain available',async()=>{
 const f=fixture({enabled:false});await assert.rejects(f.service.autoOpen('a'),/Definições|desativad/);await assert.rejects(f.service.prepare('a','autoopen',{config,activePresetId:null}),/Definições|desativad/);assert.equal(writes(f).length,0);
 assert.equal((await f.service.confirm((await f.service.prepare('a','mission',{id:missionId})).previewId)).verified,true);
 const g=fixture(),p=await g.service.prepare('a','autoopen',{config:{...config,autosellAmount:6000}});g.state.enabled=false;await assert.rejects(g.service.confirm(p.previewId),/Definições|desativad/);assert.equal(writes(g).length,0);
});
test('mission and pass deadlines are checked immediately before sending after the final awaits',async()=>{
 for(const kind of ['mission','pass']){
  const f=fixture({mutationGuard:state=>{state.time+=2000;}});
  if(kind==='mission')f.state.missions[0].validTill=new Date(instant+1000).toISOString();else f.state.pass.endsAt=new Date(instant+1000).toISOString();
  const p=await f.service.prepare('a',kind,kind==='mission'?{id:missionId}:{tier:2,track:'free'}),r=await f.service.confirm(p.previewId);
  assert.equal(writes(f).length,0);assert.equal(r.state,'failed');assert.match(r.message,/expir/);assert.equal(f.service.hasPending(),false);
 }
});
test('disabling opening preferences during final checks prevents an unsent configuration write',async()=>{
 const f=fixture({mutationGuard:state=>{state.enabled=false;}}),p=await f.service.prepare('a','autoopen',{config:{...config,autosellAmount:6000}}),r=await f.service.confirm(p.previewId);
 assert.equal(r.state,'failed');assert.equal(writes(f).length,0);assert.equal(f.service.hasPending(),false);
});
