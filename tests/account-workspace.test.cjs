const test=require('node:test'),assert=require('node:assert/strict');
// Missing persistence, permissive validation, pre-save commits, or concurrent stale snapshots break these contracts.
let createAccountWorkspace;
try { ({createAccountWorkspace}=require('../electron/accountWorkspace.cjs')); } catch {}
function fixture(options={}) {
 let stored=null,accounts=[{id:'a',label:'A',cookie:'never'},{id:'b',label:'B'}],sequence=0;
 const service=createAccountWorkspace({load:async()=>stored,save:async value=>{stored=structuredClone(value);},listAccounts:async()=>accounts,idFactory:()=>`custom-${++sequence}`,...options});
 return {service,saved:()=>stored,accounts};
}
test('workspace seeds persistent default groups without writing account credentials',async()=>{
 assert.equal(typeof createAccountWorkspace,'function');
 const f=fixture();const value=await f.service.ready();
 assert.deepEqual(value.groups.map(g=>g.name),['Farmer','Trader','Storage','Principal']);
 assert.deepEqual(f.saved().groups,value.groups);assert.equal(JSON.stringify(f.saved()).includes('never'),false);
});
test('ordered groups and one association per account survive reload; deletion only unassigns accounts',async()=>{
 const f=fixture();await f.service.ready();await f.service.createGroup({name:'Extra'});await f.service.updateGroup({id:'custom-1',name:'Arquivo'});
 await f.service.assignAccounts({groupId:'custom-1',accountIds:['a','b']});await f.service.assignAccounts({groupId:'farmer',accountIds:['b']});
 const ids=(await f.service.read()).groups.map(g=>g.id).reverse();await f.service.reorderGroups({groupIds:ids});
 const restored=fixture({load:async()=>f.saved()}).service;await restored.ready();assert.deepEqual((await restored.read()).groups.map(g=>g.id),ids);
 assert.deepEqual(await restored.selectGroup({groupId:'custom-1'}),{groupId:'custom-1',accountIds:['a']});
 await f.service.deleteGroup({id:'custom-1'});assert.deepEqual((await f.service.read()).accountGroups,{b:'farmer'});assert.equal(f.accounts.length,2);
});
test('validation rejects duplicate names, bad reorder and unknown account or group without saving',async()=>{
 const f=fixture();await f.service.ready();const before=structuredClone(f.saved());
 for(const run of [()=>f.service.createGroup({name:' farmer '}),()=>f.service.createGroup({name:''}),()=>f.service.reorderGroups({groupIds:['farmer']}),()=>f.service.assignAccounts({groupId:'missing',accountIds:['a']}),()=>f.service.assignAccounts({groupId:'farmer',accountIds:['missing']}),()=>f.service.assignAccounts({groupId:'farmer',accountIds:['a','a']})])await assert.rejects(run);
 assert.deepEqual(f.saved(),before);
});
test('failed save does not publish state and later commands recover',async()=>{
 let fail=false;const writes=[];const f=fixture({save:async value=>{if(fail)throw Error('disk');writes.push(structuredClone(value));}});await f.service.ready();fail=true;
 await assert.rejects(()=>f.service.createGroup({name:'Falhou'}),/disk/);assert.equal((await f.service.read()).groups.length,4);fail=false;await f.service.createGroup({name:'Guardado'});assert.equal((await f.service.read()).groups.at(-1).name,'Guardado');assert.equal(writes.length,2);
});
test('concurrent commands serialize state writes and return independent snapshots',async()=>{
 let active=0,max=0;const f=fixture({save:async()=>{active++;max=Math.max(active,max);await new Promise(r=>setTimeout(r,5));active--;}});await f.service.ready();
 await Promise.all([f.service.createGroup({name:'Um'}),f.service.createGroup({name:'Dois'})]);const value=await f.service.read();assert.equal(max,1);assert.equal(value.groups.length,6);value.groups.length=0;assert.equal((await f.service.read()).groups.length,6);
});
test('local profiles retain only validated operational configuration and load without changing account state',async()=>{
 const f=fixture();await f.service.ready();const config={farm:{case:true,money:false,vault:true},targetCase:'c'.repeat(24),itemRules:[{name:'AK-47 | Blue',action:'storage',destinationAccountId:'b',storageUnitId:'d'.repeat(24)}],destinations:[{accountId:'b',storageUnitId:'d'.repeat(24)}]};
 await f.service.saveProfile({name:'Arquivo',config});const before=structuredClone(f.saved());const profile=await f.service.loadProfile({id:'custom-1'});assert.deepEqual(profile.config,config);profile.config.farm.case=false;assert.equal((await f.service.loadProfile({id:'custom-1'})).config.farm.case,true);assert.deepEqual(f.saved(),before);
 await f.service.saveProfile({id:'custom-1',name:'Renomeado',config:{farm:{case:false,money:true,vault:false}}});assert.equal((await f.service.read()).profiles.length,1);await f.service.deleteProfile({id:'custom-1'});assert.equal((await f.service.read()).profiles.length,0);
});
test('profiles reject secrets, site preferences, skills, invalid rules and destinations',async()=>{
 const f=fixture();await f.service.ready();for(const config of [{cookie:'secret'},{skills:{a:1}},{enableSiteOpening:true},{farm:{case:'yes'}},{targetCase:'bad'},{itemRules:[{name:'A',action:'sell',token:'secret'}]},{itemRules:[{name:'A',action:'storage',destinationAccountId:'b',storageUnitId:'bad'}]},{destinations:[{accountId:'unknown'}]}])await assert.rejects(()=>f.service.saveProfile({name:'Bad',config}));assert.equal((await f.service.read()).profiles.length,0);
});
test('removed accounts are excluded from group selection and dangling profile destinations block loading',async()=>{
 const f=fixture();await f.service.ready();await f.service.assignAccounts({groupId:'farmer',accountIds:['a']});await f.service.saveProfile({name:'Move',config:{destinations:[{accountId:'a'}]}});f.accounts.splice(0,1);assert.deepEqual((await f.service.selectGroup({groupId:'farmer'})).accountIds,[]);await assert.rejects(()=>f.service.loadProfile({id:'custom-1'}),/conta/i);
});
test('unknown persisted schema or malformed profile fails visibly without overwriting saved data',async()=>{
 let writes=0;for(const saved of [{version:99},{version:1,groups:[{id:'g',name:'G'}],accountGroups:{},profiles:[{id:'p',name:'Bad',config:{cookie:'secret'}}]}]){
 const f=fixture({load:async()=>saved,save:async()=>{writes++;}});await assert.rejects(()=>f.service.ready());}assert.equal(writes,0);
});
