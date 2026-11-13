const test=require('node:test'),assert=require('node:assert/strict');
const {createLoginProbe}=require('../engine/accountLogin.cjs');
test('security wait never makes session requests that delay the enabled login button',async()=>{
 assert.equal(typeof createLoginProbe,'function');let validations=0;const probe=createLoginProbe({automatic:true,step:async()=> 'challenge',validate:async()=>{validations++;},now:()=>0});
 for(let i=0;i<8;i++)assert.equal((await probe.check()).step,'challenge');assert.equal(validations,0);
});
test('submits first, validates immediately, then throttles session polling to once per second',async()=>{
 assert.equal(typeof createLoginProbe,'function');let time=0;const calls=[];let submitted=false;
 const probe=createLoginProbe({automatic:true,step:async submit=>{calls.push('step');assert.equal(submit,!submitted);if(!submitted){submitted=true;return 'submitted';}return 'waiting';},validate:async()=>{calls.push('validate');return {ok:true};},now:()=>time});
 assert.equal((await probe.check()).response.ok,true);assert.deepEqual(calls,['step','validate']);
 time=250;assert.equal((await probe.check()).response,undefined);assert.deepEqual(calls,['step','validate','step']);
 time=1000;assert.equal((await probe.check()).response.ok,true);assert.equal(calls.filter(x=>x==='validate').length,2);
});
test('manual login and navigation still validate while an error never triggers more requests',async()=>{
 assert.equal(typeof createLoginProbe,'function');let validations=0;
 for(const [automatic,stage,expected] of [[false,'manual',true],[true,'other-page',true],[true,'failed',false]]){
 const probe=createLoginProbe({automatic,step:async()=>stage,validate:async()=>{validations++;return 'response';},now:()=>0});const result=await probe.check();assert.equal(result.response==='response',expected);
 }
 assert.equal(validations,2);
});
