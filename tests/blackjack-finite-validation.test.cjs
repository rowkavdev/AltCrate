const test=require('node:test'),assert=require('node:assert/strict');
// Independent sampled dealing validates stand/double against exact removal.
// Seeded, offline, no future order is passed to the decision engine.
test('finite stand and double values agree with independently sampled hidden-hole dealing',async()=>{
 const {finiteShoeExpectedValues:f}=await import('../src/blackjackFinite.js');
 let seed=271828;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const total=ns=>{let n=ns.reduce((a,b)=>a+b,0);return ns.includes(1)&&n+10<=21?n+10:n;};
 for(const fixture of [{cards:['10','10'],values:[10,10],up:6},{cards:['10','6'],values:[10,6],up:10}]){
  const initial=[24,24,24,24,24,24,24,24,24,96];for(const n of [...fixture.values,fixture.up])initial[n-1]--;
  const exact=f({cards:fixture.cards,dealer:String(fixture.up),counts:initial,canDouble:true},{maxMs:1000,maxNodes:2000000});assert.equal(exact.complete,true);
  for(const peek of [true,false])for(const move of ['stand','double']){
   let sum=0;
   for(let trial=0;trial<40000;trial++){
    const counts=initial.slice();const draw=exclude=>{let mass=counts.reduce((a,b,i)=>a+(i===exclude?0:b),0),target=random()*mass;for(let i=0;i<10;i++)if(i!==exclude){target-=counts[i];if(target<0){counts[i]--;return i+1;}}throw new Error('Draw');};
    const forbidden=peek&&fixture.up===10?0:peek&&fixture.up===1?9:-1;
    const hole=draw(forbidden),dealer=[fixture.up,hole],hand=fixture.values.slice();let bet=1;
    if(move==='double'){bet=2;hand.push(draw(-1));}
    let result;
    if(total(hand)>21)result=-bet;
    else if(total(dealer)===21)result=-bet;
    else {while(total(dealer)<17)dealer.push(draw(-1));const p=total(hand),d=total(dealer);result=d>21||p>d?bet:p===d?0:-bet;}
    sum+=result;
   }
   assert.ok(Math.abs(sum/40000-exact[peek?'peek':'noPeek'][move])<.025,`${fixture.cards}/${fixture.up} ${peek} ${move}`);
  }
 }
});
