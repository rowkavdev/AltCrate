const test=require('node:test'),assert=require('node:assert/strict');
const only=(rank,n=80)=>Array.from({length:10},(_,i)=>i===rank-1?n:0);
test('pre-bet sampling uses removal, bounds uncertainty and discards incomplete estimates',async()=>{
 const {estimatePreBetEdge}=await import('../strategy/blackjackEdge.js');
 const pushes=estimatePreBetEdge({counts:only(10),stakeUnit:2},{samples:1024,maxMs:1000});
 assert.equal(pushes.complete,true);assert.equal(pushes.peek.mean,0);assert.equal(pushes.noPeek.mean,0);assert.ok(pushes.lowerBound<0);
 const losing=estimatePreBetEdge({counts:only(5),stakeUnit:2},{samples:1024,maxMs:1000});
 assert.equal(losing.complete,true);assert.equal(losing.peek.mean,-2);assert.equal(losing.noPeek.mean,-2);
 const incomplete=estimatePreBetEdge({counts:[24,24,24,24,24,24,24,24,24,96],stakeUnit:2},{samples:60000,maxMs:0});
 assert.equal(incomplete.complete,false);assert.equal(incomplete.lowerBound,undefined);
});
test('favorable synthetic shoes can have a positive conservative estimate under both peek interpretations',async()=>{
 const {estimatePreBetEdge}=await import('../strategy/blackjackEdge.js');
 const out=estimatePreBetEdge({counts:[20,0,0,0,0,0,0,0,0,80],stakeUnit:2},{samples:16000,maxMs:3000});
 assert.equal(out.complete,true);assert.ok(out.lowerBound>0);assert.equal(out.assumptions.payout,'floor-3:2');
});
test('stake policy increases only on completed positive estimates and reserves all split/double costs',async()=>{
 const {planAdvantageStake}=await import('../strategy/blackjackEdge.js');
 const context={tokens:10000,minBet:1,maxBet:5000000,ceiling:1000};
 const baseline=planAdvantageStake(context,null);assert.equal(baseline.amount,2);assert.equal(baseline.reason,'minimum');
 const stake=planAdvantageStake(context,{complete:true,lowerBound:.08,secondMoment:1.5});
 assert.equal(stake.amount,132);assert.equal(stake.reason,'edge');assert.ok(stake.amount*8<=context.tokens);
 assert.equal(planAdvantageStake(context,{complete:false,lowerBound:1,secondMoment:1}).amount,2);
 assert.equal(planAdvantageStake(context,{complete:true,lowerBound:-.001,secondMoment:1}).amount,2);
 assert.equal(planAdvantageStake({...context,tokens:100},{complete:true,lowerBound:1,secondMoment:1}).amount,12);
 assert.equal(planAdvantageStake({...context,ceiling:1},null).amount,1);
 assert.equal(planAdvantageStake({...context,tokens:.5},null).amount,null);
 assert.equal(planAdvantageStake({...context,tokens:3},null).reserveCovered,false);
});
test('bankroll planning does not exceed the user ceiling or table limits',async()=>{
 const {planAdvantageStake}=await import('../strategy/blackjackEdge.js');
 const edge={complete:true,lowerBound:.2,secondMoment:1};
 assert.equal(planAdvantageStake({tokens:10000,minBet:3,maxBet:7,ceiling:100},edge).amount,6);
 assert.equal(planAdvantageStake({tokens:10000,minBet:3,maxBet:7,ceiling:3},edge).amount,3);
 assert.equal(planAdvantageStake({tokens:10000,minBet:3,maxBet:7,ceiling:2},edge).amount,null);
});
