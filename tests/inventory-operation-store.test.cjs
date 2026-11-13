const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
let createInventoryOperationStore;try{({createInventoryOperationStore}=require('../electron/inventoryOperationStore.cjs'));}catch{}
test('journal survives simultaneous writes and retains sending intent without secrets',async t=>{
 assert.equal(typeof createInventoryOperationStore,'function');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cp-journal-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const filePath=path.join(dir,'ops.json');
 const store=createInventoryOperationStore({filePath});await store.load();await Promise.all([store.put({operationId:'one',stage:'sending',kind:'sell',ref:{accountId:'a'},token:'fixture-secret'}),store.put({operationId:'two',stage:'watching',tradeId:'a'.repeat(24)})]);
 const reloaded=createInventoryOperationStore({filePath});await reloaded.load();assert.equal((await reloaded.get('one')).stage,'sending');assert.equal((await reloaded.list()).length,2);assert.equal((await fs.readFile(filePath,'utf8')).includes('fixture-secret'),false);assert.equal((await fs.stat(filePath)).mode&0o777,0o600);
});
test('corrupt journal is rejected rather than silently replaced',async t=>{
 assert.equal(typeof createInventoryOperationStore,'function');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cp-journal-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const filePath=path.join(dir,'ops.json');await fs.writeFile(filePath,'invalid');await assert.rejects(createInventoryOperationStore({filePath}).load());
});
