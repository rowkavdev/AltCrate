const test=require('node:test'),assert=require('node:assert/strict');
test('expected return favors stand on 20, hit on hard 16 against ten and double on 11 against six',async()=>{
  const {blackjackExpectedValues}=await import('../strategy/blackjackEv.js');
  const twenty=blackjackExpectedValues({cards:['K','Q'],dealer:'6',canDouble:true});
  assert.ok(twenty.peek.stand>twenty.peek.hit);assert.ok(twenty.peek.stand>twenty.peek.double);
  const sixteen=blackjackExpectedValues({cards:['9','7'],dealer:'10',canDouble:true});
  assert.ok(sixteen.peek.hit>sixteen.peek.stand);assert.ok(sixteen.peek.hit>sixteen.peek.double);
  const eleven=blackjackExpectedValues({cards:['5','6'],dealer:'6',canDouble:true});
  assert.ok(eleven.peek.double>eleven.peek.hit);assert.ok(eleven.peek.double>eleven.peek.stand);
});
test('dealer distributions preserve probability mass and distinguish blackjack peek assumptions',async()=>{
  const {dealerDistribution}=await import('../strategy/blackjackEv.js');
  const d=dealerDistribution('A',false),peek=dealerDistribution('A',true);
  assert.ok(Math.abs(d.blackjack-4/13)<1e-10);assert.equal(peek.blackjack,0);
  assert.ok(Math.abs(Object.values(d).reduce((a,b)=>a+b,0)-1)<1e-10);
  assert.ok(Math.abs(Object.values(peek).reduce((a,b)=>a+b,0)-1)<1e-10);
});
test('mathematical check rejects a worse AI choice, retains split reference and never invents unknown-card EVs',async()=>{
  const {validateLocalProposal,blackjackExpectedValues}=await import('../strategy/blackjackEv.js');
  const state={cards:['9','7'],dealer:'10',canDouble:true,canSplit:false};
  assert.equal(validateLocalProposal(state,'hit','stand').move,'hit');
  assert.equal(validateLocalProposal(state,'hit','hit').move,'hit');
  assert.equal(validateLocalProposal({cards:['8','8'],dealer:'10',canDouble:true,canSplit:true},'split','double').move,'split');
  assert.equal(blackjackExpectedValues({...state,dealer:'?'}),null);
});
