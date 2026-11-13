const test=require('node:test'),assert=require('node:assert/strict');
let registerAccountWorkspaceIpc;try{({registerAccountWorkspaceIpc}=require('../engine/accountWorkspaceIpc.cjs'));}catch{}
test('workspace IPC accepts only local workspace commands and rejects inherited methods',async()=>{
 assert.equal(typeof registerAccountWorkspaceIpc,'function');const {createAccountWorkspace}=require('../engine/accountWorkspace.cjs');let saved;
 const service=createAccountWorkspace({load:async()=>null,save:async value=>{saved=value;},listAccounts:async()=>[{id:'a'}]});const handlers={};registerAccountWorkspaceIpc({ipcMain:{handle:(key,fn)=>{handlers[key]=fn;}},service});
 await handlers['workspace:command']({},'assignAccounts',{accountIds:['a'],groupId:'farmer'});assert.equal(saved.accountGroups.a,'farmer');assert.deepEqual((await handlers['workspace:command']({},'selectGroup',{groupId:'farmer'})).accountIds,['a']);
 await assert.rejects(()=>handlers['workspace:command']({},'constructor',{}));assert.equal((await handlers['workspace:read']({})).groups.length,4);
});
