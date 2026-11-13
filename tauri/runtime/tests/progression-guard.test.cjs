const test=require('node:test'),assert=require('node:assert/strict');
test('unknown progression results block unrelated mutations after the active lease ends',()=>{
 const {createProgressionGuard}=require('../engine/progressionGuard.cjs');
 let busy=1,pending=false;
 const guard=createProgressionGuard({converterGuard:()=>{},getBusy:()=>busy,getService:()=>({hasPending:()=>pending})});
 assert.throws(guard,/progressão/);busy=0;pending=true;assert.throws(guard,/progressão/);
 pending=false;assert.doesNotThrow(guard);
});
test('progression confirmation cannot race a pre-existing write or login but verification can enter after it ends',()=>{
 const {createProgressionEntryGuard}=require('../engine/progressionGuard.cjs');
 let otherWork=true;
 const guard=createProgressionEntryGuard({converterGuard:()=>{},hasOtherWork:()=>otherWork});
 assert.throws(guard,/outra operação/);otherWork=false;assert.doesNotThrow(guard);
});
test('account sessions cannot change during an active confirmation but can be repaired after it ends',()=>{
 const {createProgressionAccountGuard}=require('../engine/progressionGuard.cjs');
 let busy=1;
 const guard=createProgressionAccountGuard({getBusy:()=>busy});
 assert.throws(guard,/alterar contas/);busy=0;assert.doesNotThrow(guard);
});
