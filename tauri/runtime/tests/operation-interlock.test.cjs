const test=require('node:test'),assert=require('node:assert/strict');
let createOperationInterlock;try{({createOperationInterlock}=require('../engine/operationInterlock.cjs'));}catch{}
test('pending mutations stay locked across awaits and release after failure',async()=>{
  assert.equal(typeof createOperationInterlock,'function');let reply;
  const interlock=createOperationInterlock(()=>{});const task=interlock.run(()=>new Promise((_,reject)=>{reply=reject;}));
  assert.equal(interlock.busy(),true);reply(Error('Rejected'));await assert.rejects(task);assert.equal(interlock.busy(),false);
});
test('converter exclusion runs before the other mutation can send',async()=>{
  assert.equal(typeof createOperationInterlock,'function');let calls=0;
  const interlock=createOperationInterlock(()=>{throw Error('Conversor ativo');});
  await assert.rejects(interlock.run(()=>{calls++;}),/Conversor/);assert.equal(calls,0);assert.equal(interlock.busy(),false);
});
