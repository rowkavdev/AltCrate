const test=require('node:test');
const assert=require('node:assert/strict');
const {createAccountRegistry}=require('../engine/accounts.cjs');
function registry(){let saved=[];const store=createAccountRegistry({load:async()=>saved,save:async value=>{saved=structuredClone(value);}});return {store,read:()=>saved};}
const row=(suffix='',password='test-only-secret')=>({label:`player${suffix}@example.com`,email:`player${suffix}@example.com`,password,status:'login_verified'});
const protector={seal:value=>Buffer.from(value).toString('base64')};
test('imports recovery envelope with isolated sessions and no credentials in public results',async()=>{
 const {store,read}=registry();
 assert.equal(typeof store.importAccounts,'function');
 const result=await store.importAccounts({accounts:[row(),row('+1'),row('+2',null)]},protector);
 assert.deepEqual({added:result.added,updated:result.updated,withoutPassword:result.withoutPassword},{added:3,updated:0,withoutPassword:1});
 const listed=await store.list();assert.equal(new Set(listed.map(a=>a.partition)).size,3);
 assert.equal(listed[0].email,'player@example.com');assert.equal(listed[0].hasPassword,true);assert.equal(listed[2].hasPassword,false);
 assert.equal(JSON.stringify(listed).includes('test-only-secret'),false);assert.equal(JSON.stringify(result).includes('protectedPassword'),false);
 assert.equal(JSON.stringify(read()).includes('test-only-secret'),false);assert.equal(read()[0].status,undefined);
});
test('reimport updates credentials without replacing existing session or duplicating accounts',async()=>{
 const {store}=registry();assert.equal(typeof store.importAccounts,'function');
 const original=await store.add('player@example.com','persist:caseclicker-existing');
 await store.importAccounts({accounts:[row()]},protector);
 const result=await store.importAccounts({accounts:[row('','changed-test-only-secret')]},protector);
 assert.equal(result.added,0);assert.equal(result.updated,1);const [account]=await store.list();assert.equal(account.id,original.id);assert.equal(account.partition,original.partition);
 const credentials=await store.credentials(account.id,{open:value=>Buffer.from(value,'base64').toString()});assert.equal(credentials.password,'changed-test-only-secret');
 await store.importAccounts({accounts:[row('',null)]},protector);assert.equal((await store.credentials(account.id,{open:value=>Buffer.from(value,'base64').toString()})).password,'changed-test-only-secret');
});
test('malformed files, duplicate addresses and account overflow are rejected before saving',async()=>{
 const {store,read}=registry();assert.equal(typeof store.importAccounts,'function');
 for(const value of [{accounts:[]},{accounts:[row(),{email:'broken',password:'test'}]},{accounts:[row(),row()]},{accounts:[row('',42)]},{accounts:Array.from({length:101},(_,i)=>row('+'+i))}])await assert.rejects(()=>store.importAccounts(value,protector));
 assert.deepEqual(read(),[]);
 await store.add('Other name','persist:caseclicker-existing');
 await assert.rejects(()=>store.importAccounts({accounts:Array.from({length:100},(_,i)=>row('+'+i))},protector),/100/);assert.equal(read().length,1);
});
test('encryption failure leaves every account unchanged',async()=>{
 const {store,read}=registry();assert.equal(typeof store.importAccounts,'function');
 await assert.rejects(()=>store.importAccounts({accounts:[row(),row('+1')]},{seal:()=>{throw Error('Protection unavailable');}}),/Protection/);
 assert.deepEqual(read(),[]);
});
