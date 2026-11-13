const test=require('node:test'),assert=require('node:assert/strict');
test('opening preferences default off and persist only the explicit boolean choice',async()=>{
 const {createAppPreferences}=require('../electron/appPreferences.cjs');let saved;
 const preferences=createAppPreferences({load:async()=>null,save:async value=>{saved=value;}});await preferences.ready();assert.deepEqual(preferences.read(),{enableSiteOpening:false});
 await preferences.update({enableSiteOpening:true});assert.deepEqual(saved,{enableSiteOpening:true});assert.equal(preferences.read().enableSiteOpening,true);
 const restarted=createAppPreferences({load:async()=>saved,save:async()=>{}});await restarted.ready();assert.equal(restarted.read().enableSiteOpening,true);
 for(const patch of [{enableSiteOpening:'true'},{enableSiteOpening:1},{enabled:true},{enableSiteOpening:true,path:'/bad'}])await assert.rejects(preferences.update(patch));
 const copy=preferences.read();copy.enableSiteOpening=false;assert.equal(preferences.read().enableSiteOpening,true);
});
test('failed preference writes preserve the old value and concurrent changes retain their order',async()=>{
 const {createAppPreferences}=require('../electron/appPreferences.cjs');let fail=true,saved;
 const preferences=createAppPreferences({load:async()=>({enableSiteOpening:'yes'}),save:async value=>{if(fail)throw Error('disk');saved=value;}});await preferences.ready();assert.equal(preferences.read().enableSiteOpening,false);
 await assert.rejects(preferences.update({enableSiteOpening:true}),/disk/);assert.equal(preferences.read().enableSiteOpening,false);fail=false;
 await Promise.all([preferences.update({enableSiteOpening:true}),preferences.update({enableSiteOpening:false})]);assert.deepEqual(saved,{enableSiteOpening:false});
});
test('opening page is excluded from navigation until enabled, while rewards stay available',async()=>{
 const {visiblePages}=await import('../src/workspaceNavigation.js');assert.equal(visiblePages().some(p=>p.id==='autoopen'),false);assert.equal(visiblePages().some(p=>p.id==='rewards'),true);
 assert.equal(visiblePages({enableSiteOpening:true}).find(p=>p.id==='autoopen').title,'Preferências de abertura');
});
