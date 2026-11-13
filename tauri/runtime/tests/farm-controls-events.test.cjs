const test=require('node:test');
const assert=require('node:assert/strict');
const {createFarmOrchestrator}=require('../engine/farmOrchestrator.cjs');
const {createClickCoordinator}=require('../engine/clickCoordinator.cjs');
const {createAccountQueue}=require('../engine/accountQueue.cjs');
const {createRemoteFarm}=require('../engine/remoteFarm.cjs');
const {registerFarmIpc}=require('../engine/farmIpc.cjs');

async function harness({saveGate}={}){
 let persisted={},budget={};const events=[],handlers=new Map(),gameCalls=[];
 const local=createFarmOrchestrator({accounts:[{id:'a'},{id:'b'}],apiForAccount:()=>{gameCalls.push('api');throw Error('No game operation is authorized');},coordinator:createClickCoordinator({store:{load:async()=>budget,save:async value=>{budget=structuredClone(value);}}}),accountQueue:createAccountQueue(),snapshots:{read:async()=>{throw Error('No game read is needed');}},stateStore:{load:async()=>persisted,save:async value=>{await saveGate?.();persisted=structuredClone(value);}}});
 const farm=createRemoteFarm({local,readConfig:async()=>({enabled:false}),writeConfig:async()=>{},preparePayload:async()=>{throw Error('No transfer is needed');}});
 await farm.ready();registerFarmIpc({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},farm,emit:event=>events.push(event)});
 return {farm,events,handlers,gameCalls,saved:()=>persisted};
}

test('saved account modes publish canonical state immediately without waiting for polling',async()=>{
 const h=await harness();const modes={case:false,money:true,vault:false};
 const result=await h.handlers.get('farm:modes')(null,'a',modes);
 assert.deepEqual(h.saved().accounts.a.modes,modes);
 assert.equal(h.events.length,1,'The real IPC must publish the state the renderer subscribes to');
 assert.equal(h.events[0].type,'account-configured');assert.equal(h.events[0].accountId,'a');
 assert.equal(h.events[0].status.execution.kind,'local');assert.deepEqual(result,h.events[0].status);
 assert.deepEqual(result.accounts.find(a=>a.id==='a').modes,modes);
 assert.deepEqual(result.accounts.find(a=>a.id==='b').modes,{case:true,money:true,vault:true});
 assert.deepEqual(h.gameCalls,[]);
});
test('pause and resume publish committed state through the same IPC event path',async()=>{
 const h=await harness();await h.handlers.get('farm:pause')(null,'a');
 assert.equal(h.events.length,1);assert.equal(h.events[0].type,'account-paused');assert.equal(h.events[0].status.accounts.find(a=>a.id==='a').paused,true);assert.equal(h.saved().accounts.a.paused,true);
 await h.handlers.get('farm:resume')(null,'a');assert.equal(h.events.length,2);assert.equal(h.events[1].type,'account-resumed');assert.equal(h.events[1].status.accounts.find(a=>a.id==='a').paused,false);assert.equal(h.saved().accounts.a.paused,false);assert.deepEqual(h.gameCalls,[]);
});
test('mode changes publish only after persistence and invalid controls never publish success',async()=>{
 let release,entered;const saving=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
 const h=await harness({saveGate:()=>{entered();return gate;}});
 const command=h.handlers.get('farm:modes')(null,'a',{case:false,money:false,vault:false});await saving;assert.equal(h.events.length,0);release();await command;assert.equal(h.events.length,1);
 await assert.rejects(()=>h.handlers.get('farm:modes')(null,'missing',{case:true,money:true,vault:true}),/inválidos/);assert.equal(h.events.length,1);
 await assert.rejects(()=>h.handlers.get('farm:modes')(null,'a',{case:'yes',money:true,vault:true}),/inválidos/);assert.equal(h.events.length,1);
});
test('remote control replies without worker events still publish the canonical server state',async()=>{
 let status={phase:'idle',accounts:[{id:'a',modes:{case:true,money:true,vault:true}}]};const events=[],handlers=new Map();
 const farm=createRemoteFarm({local:{},readConfig:async()=>({enabled:true,profile:{host:'fixture.example',name:'Fixture'}}),writeConfig:async()=>{},rpc:async request=>{if(request.op==='modes')status={...status,accounts:[{id:'a',modes:request.modes}]};return {status,events:[]};}});
 await farm.ready();registerFarmIpc({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},farm,emit:event=>events.push(event)});
 const result=await handlers.get('farm:modes')(null,'a',{case:false,money:true,vault:false});assert.equal(events.length,1);assert.equal(events[0].status.execution.kind,'server');assert.deepEqual(result,events[0].status);assert.equal(result.accounts[0].modes.case,false);
});
