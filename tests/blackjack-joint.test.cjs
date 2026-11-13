const test=require('node:test'),assert=require('node:assert/strict');
const only=(rank,n=12)=>Array.from({length:10},(_,i)=>i===rank-1?n:0);
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
test('joint split evaluation prices both hands, double after split, and available funds',async()=>{
 const {finiteShoeExpectedValues:f}=await import('../src/blackjackFinite.js');
 const state={cards:['2','2'],dealer:'9',counts:only(8),canDouble:true,canSplit:true,availableUnits:3,rules:{maxHandsPerSeat:2}};
 const full=f(state);assert.equal(full.complete,true);close(full.peek.split,4);
 const limited=f({...state,availableUnits:1});assert.equal(limited.complete,true);close(limited.peek.split,2);
 const noDas=f({...state,rules:{maxHandsPerSeat:2,doubleAfterSplit:false}});assert.equal(noDas.complete,true);close(noDas.peek.split,2);
});
test('split aces pay ordinary wins and a bad composition can override a reference split',async()=>{
 const {finiteShoeExpectedValues:f,chooseFiniteMove}=await import('../src/blackjackFinite.js');
 const aces=f({cards:['A','A'],dealer:'6',counts:only(10),canSplit:true,availableUnits:1});assert.equal(aces.complete,true);close(aces.peek.split,2);
 const eights=f({cards:['8','8'],dealer:'10',counts:only(10),canSplit:true,availableUnits:1});assert.equal(eights.complete,true);close(eights.peek.split,-2);assert.equal(chooseFiniteMove(eights,'split'),'stand');
});
test('existing split hands share the dealer and current decision is valued for the whole seat',async()=>{
 const {finiteShoeExpectedValues:f}=await import('../src/blackjackFinite.js');
 const out=f({cards:['10','6'],dealer:'7',counts:only(10),canDouble:true,availableUnits:1,activeHandIndex:0,hands:[{cards:['10','6'],betUnits:1,fromSplit:true,status:'playing'},{cards:['10','10'],betUnits:1,fromSplit:true,status:'stand'}]});
 assert.equal(out.complete,true);close(out.peek.stand,0);close(out.peek.double,-1);assert.equal(out.scope,'whole-seat');
});
test('rule changes and funds cannot reuse a cached result, and exhausted budgets never expose EV',async()=>{
 const {finiteShoeExpectedValues:f}=await import('../src/blackjackFinite.js');
 const s={cards:['2','2'],dealer:'9',counts:only(8),canDouble:true,canSplit:true,availableUnits:3,rules:{maxHandsPerSeat:2}};
 close(f(s).peek.split,4);close(f({...s,availableUnits:1}).peek.split,2);
 const incomplete=f({...s,counts:Array(10).fill(24)},{maxNodes:1});assert.equal(incomplete.complete,false);assert.equal(incomplete.peek,undefined);
});
test('resplitting shares the four-hand ceiling and one bankroll across all descendants',async()=>{
 const {finiteShoeExpectedValues:f}=await import('../src/blackjackFinite.js');
 const state={cards:['8','8'],dealer:'6',counts:only(8,20),canSplit:true,canDouble:true,availableUnits:3};
 close(f(state).peek.split,4);close(f({...state,rules:{maxHandsPerSeat:2}}).peek.split,2);close(f({...state,availableUnits:1}).peek.split,2);
});
test('completed exact values can apply small independently verified composition improvements',async()=>{
 const {chooseFiniteMove}=await import('../src/blackjackFinite.js');
 const result={complete:true,peek:{stand:-.21111530573872,hit:-.21036425799271},noPeek:{stand:-.21111530573872,hit:-.21036425799271}};
 assert.equal(chooseFiniteMove(result,'stand'),'hit');
 assert.equal(chooseFiniteMove({...result,noPeek:{stand:-.21111530573872,hit:-.22}},'stand'),'stand');
});
