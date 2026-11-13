const test=require('node:test'),assert=require('node:assert/strict');
let loadStorageDestinations,reviewRequestForFailedDeposit;test.before(async()=>{try{({loadStorageDestinations,reviewRequestForFailedDeposit}=await import('../src/storageDestinationPicker.js'));}catch{}});
test('picker binds same-name storages to their account IDs',async()=>{
 assert.equal(typeof loadStorageDestinations,'function');
 const accounts=[{id:'a',label:'Igual'},{id:'b',label:'Igual'}];
 const result=await loadStorageDestinations(accounts,async id=>[{id:'same',name:'Blue',count:id==='a'?1:2}]);
 assert.deepEqual(result.entries.map(e=>[e.accountId,e.storageId,e.count]),[['a','same',1],['b','same',2]]);
});
test('picker loads one hundred accounts progressively with at most four reads',async()=>{
 assert.equal(typeof loadStorageDestinations,'function');let active=0,peak=0,updates=0;
 const accounts=Array.from({length:100},(_,i)=>({id:'a'+i,label:'Conta '+i}));
 const result=await loadStorageDestinations(accounts,async id=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,1));active--;return [{id:'s'+id,name:'Storage'}];},{onUpdate:()=>updates++});
 assert.equal(result.entries.length,100);assert.ok(peak<=4);assert.ok(peak>1);assert.ok(updates>1);
});
test('partial failure preserves loaded storage choices',async()=>{
 assert.equal(typeof loadStorageDestinations,'function');
 const result=await loadStorageDestinations([{id:'a',label:'A'},{id:'b',label:'B'}],async id=>{if(id==='b')throw Error('sem sessão');return [{id:'s',name:'Blue'}];});
 assert.deepEqual(result.entries.map(e=>e.accountId),['a']);assert.equal(result.errors[0].accountId,'b');
});
test('HTTP 429 stops new reads until retry',async()=>{
 assert.equal(typeof loadStorageDestinations,'function');const calls=[];
 const result=await loadStorageDestinations(Array.from({length:20},(_,i)=>({id:'a'+i,label:'A'+i})),async id=>{calls.push(id);throw Error('HTTP 429');},{now:()=>1000});
 assert.ok(calls.length<=4);assert.equal(result.retryAt,301000);
});
test('reopened picker obeys shared cooldown without starting new reads',async()=>{
 let calls=0;const result=await loadStorageDestinations([{id:'a',label:'A'}],async()=>{calls++;return [];},{now:()=>1000,cooldown:async()=>61000});
 assert.equal(calls,0);assert.equal(result.retryAt,61000);assert.equal(result.loading,false);
});
test('closing picker ignores late results',async()=>{
 assert.equal(typeof loadStorageDestinations,'function');const abort=new AbortController(),updates=[];
 const result=await loadStorageDestinations([{id:'a',label:'A'},{id:'b',label:'B'}],async()=>{abort.abort();return [{id:'s',name:'Blue'}];},{signal:abort.signal,onUpdate:value=>updates.push(value)});
 assert.equal(result.cancelled,true);assert.equal(updates.length,0);
});
test('empty account stays visible as a completed account',async()=>{
 const result=await loadStorageDestinations([{id:'a',label:'A'}],async()=>[]);
 assert.deepEqual(result.completedAccountIds,['a']);assert.equal(result.entries.length,0);
});
test('failed deposit review starts from exact destination inventory item',()=>{
 assert.equal(typeof reviewRequestForFailedDeposit,'function');
 const operation={kind:'move-to-storage',state:'failed',accountId:'source',destinationAccountId:'destination',locationAccountId:'destination',destinationStorageUnitId:'b'.repeat(24),location:'inventory',item:{id:'a'.repeat(24),name:'Skin'}};
 assert.deepEqual(reviewRequestForFailedDeposit(operation),{kind:'move-to-storage',ref:{accountId:'destination',itemId:'a'.repeat(24),storageUnitId:null,page:1,name:'Skin'},destinationAccountId:'destination',destinationStorageUnitId:'b'.repeat(24)});
 assert.equal(reviewRequestForFailedDeposit({...operation,locationAccountId:'source'}),null);
});
