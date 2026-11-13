const test=require('node:test'),assert=require('node:assert/strict'),{inventoryFixture}=require('./helpers/inventory-fixture.cjs'),{createInventoryActions}=require('../engine/inventoryActions.cjs');
let registerInventoryActionsIpc;try{({registerInventoryActionsIpc}=require('../engine/inventoryActionsIpc.cjs'));}catch{}
test('IPC rejects missing account forged preview and oversized identifiers',async t=>{
 assert.equal(typeof registerInventoryActionsIpc,'function');const f=await inventoryFixture(t),service=createInventoryActions(f.deps),handlers=new Map();registerInventoryActionsIpc({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},service});
 await assert.rejects(handlers.get('inventory-action:prepare')({}, {kind:'sell',ref:{...f.ref,accountId:'unknown'}}),/Conta/);
 await assert.rejects(handlers.get('inventory-action:confirm')({},'forged'),/revisão/i);
 await assert.rejects(async()=>handlers.get('inventory-action:confirm')({},'x'.repeat(1000)),/inválid/i);
 const p=await handlers.get('inventory-action:prepare')({}, {kind:'sell',ref:f.ref});await handlers.get('inventory-action:confirm')({},p.previewId);assert.equal(service.blocksAccount('source'),false);assert.equal(f.state.mutations.length,1);
});
test('IPC exposes guarded continuation for storage moves',async t=>{
 const f=await inventoryFixture(t),service=createInventoryActions(f.deps),handlers=new Map();registerInventoryActionsIpc({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},service});
 assert.equal(typeof handlers.get('inventory-action:resume'),'function');
 await assert.rejects(handlers.get('inventory-action:resume')({},'missing'),/encontrado/i);
 await assert.rejects(async()=>handlers.get('inventory-action:resume')({},'x'.repeat(1000)),/inválid/i);
});
