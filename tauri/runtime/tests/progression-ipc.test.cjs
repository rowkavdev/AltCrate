const test=require('node:test'),assert=require('node:assert/strict');
test('progression bridge registers only named operations and serializes confirmed mutations',async()=>{
 const {registerProgressionIpc}=require('../engine/progressionIpc.cjs');
 const handlers=new Map(),calls=[];
 const service=Object.fromEntries(['rewards','missions','skills','presets','autoOpen','prepare','confirm','verify','stop','status','diagnostics'].map(name=>[name,async(...args)=>{calls.push({name,args});return {name};}]));
 let leases=0;
 registerProgressionIpc({ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},service,runMutation:async fn=>{leases++;return fn();}});
 assert.equal(handlers.size,11);
 assert.deepEqual(await handlers.get('progression:rewards')({},'a'),{name:'rewards'});
 await handlers.get('progression:prepare')({},'a','reward',{id:14.71});
 await handlers.get('progression:confirm')({},'preview');
 assert.equal(leases,1);assert.deepEqual(calls[1],{name:'prepare',args:['a','reward',{id:14.71}]});
 assert.equal(handlers.has('progression:request'),false);
 await assert.rejects(async()=>handlers.get('progression:confirm')({},''),/Identificador/);
});

test('preset comparison validates an account while the static preset list remains backward compatible',async()=>{const {registerProgressionIpc}=require('../engine/progressionIpc.cjs');const handlers=new Map(),calls=[];const service={presets:()=>['static'],presetCatalog:async id=>{calls.push(id);return {accountId:id,presets:[]};}};registerProgressionIpc({ipcMain:{handle:(n,f)=>handlers.set(n,f)},service});assert.deepEqual(await handlers.get('progression:presets')({}),['static']);assert.equal((await handlers.get('progression:presets')({},'a')).accountId,'a');assert.deepEqual(calls,['a']);await assert.rejects(async()=>handlers.get('progression:presets')({},''),/Identificador/);});
