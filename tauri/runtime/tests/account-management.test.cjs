'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createAccountRegistry}=require('../engine/accounts.cjs');
const {registerAccountWorkspaceIpc}=require('../engine/accountWorkspaceIpc.cjs');
const {createAccountWorkspace}=require('../engine/accountWorkspace.cjs');
test('renaming persists the label while retaining account identity, session partition and protected credentials after reimport and restart',async()=>{
 let saved=[{id:'a',label:'Old',partition:'persist:caseclicker-fixture',email:'fixture@example.invalid',protectedPassword:'encrypted-fixture',addedAt:'2026-10-01T00:00:00Z'}];
 const storage={load:async()=>structuredClone(saved),save:async value=>{saved=structuredClone(value);}},registry=createAccountRegistry(storage);
 const before=structuredClone(saved[0]),result=await registry.rename('a','  Principal  ');assert.equal(result.label,'Principal');assert(!('protectedPassword' in result));assert.deepEqual(saved[0],{...before,label:'Principal'});
 await registry.importAccounts({accounts:[{email:'fixture@example.invalid'}]},{seal(){throw Error('not expected');}});assert.equal(saved[0].label,'Principal');
 const restarted=createAccountRegistry(storage);assert.equal((await restarted.list())[0].label,'Principal');assert.deepEqual(await restarted.credentials('a',{open:value=>value}),{email:'fixture@example.invalid',password:'encrypted-fixture'});
});
test('invalid, duplicate and failed label updates preserve the stored account',async()=>{
 const initial=[{id:'a',label:'Alpha',partition:'persist:caseclicker-a'},{id:'b',label:'Beta',partition:'persist:caseclicker-b'}];let fail=false,saves=0;
 const registry=createAccountRegistry({load:async()=>structuredClone(initial),save:async()=>{saves++;if(fail)throw Error('Storage failure');}});
 for(const label of ['', ' ', 'X'.repeat(41),'Bad\nname','\x7f'])await assert.rejects(registry.rename('a',label));
 await assert.rejects(registry.rename('a','BETA'),/existe/);await assert.rejects(registry.rename('unknown','New'),/encontrada/);assert.equal(saves,0);
 fail=true;await assert.rejects(registry.rename('a','New'),/Storage/);assert.equal((await registry.list())[0].label,'Alpha');
});
test('workspace rename is routed through the trusted callback and rejects unexpected data',async()=>{
 const handlers={},seen=[],event={sender:'trusted'};const service={read:async()=>({groups:[]})};registerAccountWorkspaceIpc({ipcMain:{handle:(name,fn)=>handlers[name]=fn},service,renameAccount:async(...args)=>seen.push(args)});
 assert.deepEqual(await handlers['workspace:command'](event,'renameAccount',{id:'a',label:'Principal'}),{groups:[]});assert.deepEqual(seen,[[event,{id:'a',label:'Principal'}]]);
 await assert.rejects(handlers['workspace:command'](event,'renameAccount',{id:'a',label:'New',token:'forbidden'}));assert.equal(seen.length,1);
});
test('pagination applies filters before slicing, clamps empty last pages and leaves source order intact',async()=>{
 const {accountListView}=await import('../../casepilot/apps/web/src/accountList.js');
 const accounts=Array.from({length:51},(_,index)=>({id:'a'+(index+1),label:'Conta '+(index+1),email:`fixture${index+1}@example.invalid`,session:{reusable:index%2===0}}));const workspace={groups:[{id:'g',name:'Farm principal'}],accountGroups:Object.fromEntries(accounts.filter((_,i)=>i<21).map(account=>[account.id,'g']))};
 const second=accountListView(accounts,workspace,{page:2,pageSize:10});assert.equal(second.rows[0].id,'a11');assert.equal(second.pages,6);assert.equal(second.total,51);
 const filtered=accountListView(accounts,workspace,{page:9,pageSize:10,groupId:'g',status:'ready'});assert.equal(filtered.total,11);assert.equal(filtered.page,2);assert.equal(filtered.rows[0].id,'a21');
 assert.equal(accountListView(accounts,workspace,{query:'farm principal'}).total,21);assert.equal(accountListView(accounts,workspace,{query:'fixture51@'}).rows[0].id,'a51');
 assert.equal(accountListView([{id:'pending',label:'Pending',session:{reusable:true,validationPending:true}}],workspace,{status:'ready'}).total,0);
 assert.deepEqual(accountListView(accounts,workspace,{query:'not found',page:6}).rows,[]);assert.equal(accounts[0].id,'a1');
});
test('page selection preserves hidden selected accounts and group removal only removes their membership',async()=>{
 const {togglePageSelection}=await import('../../casepilot/apps/web/src/accountList.js');assert.deepEqual(togglePageSelection(['hidden'],['a','b'],true),['hidden','a','b']);assert.deepEqual(togglePageSelection(['hidden','a'],['a','b'],false),['hidden']);
 let saved;const accounts=[{id:'a'},{id:'b'}],workspace=createAccountWorkspace({load:async()=>null,save:async value=>saved=structuredClone(value),listAccounts:async()=>accounts});await workspace.assignAccounts({groupId:'farmer',accountIds:['a','b']});await workspace.deleteGroup({id:'farmer'});assert.deepEqual(saved.accountGroups,{});assert.equal(accounts.length,2);
});
