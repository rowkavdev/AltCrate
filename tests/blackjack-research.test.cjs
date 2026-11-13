const test=require('node:test'),assert=require('node:assert/strict');
const c=(rank,suit='S')=>({rank,suit});
const ctx=(phase,round,profit=null,extra={})=>({connected:true,tokens:1000,events:{blackjackTableState:{tableId:'t',phase,roundNumber:round,minBet:1,maxBet:1000,dealerCards:[c('K'),c('7')],seats:[{mine:true,status:phase==='betting'?'betting':'result',bet:10,netProfit:profit,hands:phase==='betting'?[]:[{cards:[c('K'),c('9')],bet:10,status:'stand'}]}],...extra}}});
test('progression follows only own confirmed rounds once, retains ties and rounds halves down',async()=>{
  const {createBlackjackAutoRunner}=await import('../src/blackjackAuto.js');
  const bets=[];const runner=createBlackjackAutoRunner({send:async(a,p)=>{if(a==='bet')bets.push(p.bet);return true;}});
  runner.start('r',5,{progression:'win-double-loss-half'});
  await runner.observe(ctx('result',3,10)); // result before this run is irrelevant
  await runner.observe(ctx('betting',3));
  await runner.observe(ctx('result',4,5));await runner.observe(ctx('result',4,5));
  await runner.observe(ctx('betting',4));await runner.observe(ctx('result',5,-10));
  await runner.observe(ctx('betting',5));await runner.observe(ctx('result',6,-5));
  await runner.observe(ctx('betting',6));await runner.observe(ctx('result',7,0));
  await runner.observe(ctx('betting',7));
  assert.deepEqual(bets,[5,10,5,2,2]);
});
test('progression respects table minimum, maximum, funds, stop and a missing previous result',async()=>{
  const {createBlackjackAutoRunner}=await import('../src/blackjackAuto.js');
  const bets=[];const reasons=[];
  const runner=createBlackjackAutoRunner({send:async(a,p)=>{bets.push(p.bet);return true;},onStop:r=>reasons.push(r)});
  runner.start('r',5,{progression:'win-double-loss-half'});
  await runner.observe(ctx('betting',0,null,{minBet:2,maxBet:6}));
  await runner.observe(ctx('result',1,5,{minBet:2,maxBet:6}));
  await runner.observe(ctx('betting',1,null,{minBet:2,maxBet:6}));
  await runner.observe(ctx('result',2,-6,{minBet:2,maxBet:6}));
  await runner.observe(ctx('betting',2,null,{minBet:2,maxBet:6}));
  await runner.observe(ctx('result',3,-3,{minBet:2,maxBet:6}));
  await runner.observe({...ctx('betting',3,null,{minBet:2,maxBet:6}),tokens:1});
  assert.deepEqual(bets,[5,6,3]);assert.equal(runner.active,false);assert.match(reasons[0],/Saldo insuficiente/);
  runner.start('r2',5,{progression:'win-double-loss-half'});
  await runner.observe(ctx('betting',4));await runner.observe(ctx('betting',5));
  assert.equal(runner.active,false);assert.match(reasons[1],/resultado/);
  await runner.observe(ctx('result',6,5));assert.equal(bets.length,4);
});
test('shoe tracker refuses unknown beginnings, resets at an observed shuffle and deduplicates split cards',async()=>{
  const {createShoeTracker}=await import('../src/blackjackResearch.js');
  const tracker=createShoeTracker();
  const base={tableId:'t',shuffleCount:2,roundNumber:4,phase:'result',dealerHoleCardHidden:false,dealerCards:[c('K'),c('6')],seats:[{hands:[{cards:[c('8'),c('8','D')]}]}]};
  assert.equal(tracker.observe(base).usable,false);
  tracker.observe({...base,phase:'betting',shuffleCount:3,roundNumber:4,dealerCards:[],seats:[]});
  const acting={...base,phase:'acting',shuffleCount:3,roundNumber:5,dealerHoleCardHidden:true,dealerCards:[c('K')],seats:[{hands:[{cards:[c('8'),c('8','D')]}]}]};
  let state=tracker.observe(acting);assert.equal(state.usable,true);assert.equal(state.observed,3);assert.equal(state.remaining,309);
  assert.equal(tracker.observe(acting).observed,3);
  state=tracker.observe({...acting,seats:[{hands:[{cards:[c('8'),c('2')]},{cards:[c('8','D'),c('K','D')]}]}]});
  assert.equal(state.observed,5);assert.equal(state.counts[7],22);assert.equal(state.runningCount,-1);
  tracker.observe({...base,shuffleCount:3,roundNumber:7}); // skipped round invalidates coverage
  assert.equal(tracker.snapshot().usable,false);
  tracker.observe({...base,phase:'betting',shuffleCount:4,roundNumber:7,dealerCards:[],seats:[]});
  assert.equal(tracker.snapshot().usable,true);assert.equal(tracker.snapshot().observed,0);
  tracker.invalidate('disconnect');assert.equal(tracker.snapshot().usable,false);
  tracker.observe({...base,phase:'betting',shuffleCount:5,roundNumber:7,dealerCards:[],seats:[]});
  assert.equal(tracker.snapshot().usable,true);
  tracker.observe({...base,shuffleCount:5,roundNumber:8,visibleCardsComplete:false});
  assert.equal(tracker.snapshot().usable,false);
});
test('payout audit separates exact 3:2 from truncation evidence without declaring a server rule',async()=>{
  const {analyzeBlackjackPayouts}=await import('../src/blackjackResearch.js');
  const rows=[1,2,3].map((bet,index)=>({accountId:'a',tableId:'t',roundNumber:index+1,netProfit:bet,hands:[{cards:[c('A'),c('J')],result:'blackjack',bet,payout:[2,5,7][index]}]}));
  rows.push(rows[0],{...rows[0],roundNumber:4,hands:[{...rows[0].hands[0],result:'win'}]});
  const out=analyzeBlackjackPayouts(rows);assert.equal(out.naturals,3);assert.equal(out.exact,1);assert.equal(out.short,2);assert.equal(out.shortfall,1);assert.equal(out.floorCompatible,3);
});
test('finite shoe solver accounts for hidden-hole exclusion and discards an incomplete calculation',async()=>{
  const {finiteShoeExpectedValues}=await import('../src/blackjackFinite.js');
  // Three unseen cards: A, 6, ten. Against ten after a negative peek the
  // hole must be 6 or ten. Player 20 therefore wins against 16 (draw A ->17)
  // or pushes against 20: stand EV 0.5. Without peek the ace is natural: 0.
  const counts=[1,0,0,0,0,1,0,0,0,1];
  const result=finiteShoeExpectedValues({cards:['K','Q'],dealer:'10',counts,canDouble:true},{maxNodes:50000,maxMs:500});
  assert.equal(result.complete,true);assert.ok(Math.abs(result.peek.stand-.5)<1e-10);assert.ok(Math.abs(result.noPeek.stand)<1e-10);
  assert.ok(Math.abs(result.peek.double)<1e-10);assert.ok(Math.abs(result.noPeek.double+2/3)<1e-10);
  const aborted=finiteShoeExpectedValues({cards:['5','6'],dealer:'6',counts:Array(10).fill(24),canDouble:true},{maxNodes:1,maxMs:500});
  assert.equal(aborted.complete,false);assert.equal(aborted.peek,undefined);
});
test('known finite composition can change hard twelve versus four from stand to hit',async()=>{
  const {finiteShoeExpectedValues,chooseFiniteMove}=await import('../src/blackjackFinite.js');
  const counts=[0,0,0,0,0,0,8,0,0,0];
  const result=finiteShoeExpectedValues({cards:['10','2'],dealer:'4',counts,canDouble:false});
  assert.equal(result.complete,true);assert.equal(result.peek.stand,-1);assert.equal(result.peek.hit,1);assert.equal(chooseFiniteMove(result,'stand'),'hit');
});
test('a result received while another request is pending still updates the next bet once',async()=>{
  const {createBlackjackAutoRunner}=await import('../src/blackjackAuto.js');
  const bets=[];const runner=createBlackjackAutoRunner({send:async(a,p)=>{bets.push(p.bet);return true;}});
  runner.start('r',5,{progression:'win-double-loss-half'});
  await runner.observe(ctx('betting',3));
  await runner.observe({...ctx('result',4,5),pending:true});
  await runner.observe(ctx('betting',4));assert.deepEqual(bets,[5,10]);
  // Socket result and next betting state may arrive within one React render.
  runner.recordResult(ctx('result',5,-10).events.blackjackTableState);
  await runner.observe(ctx('betting',5));assert.deepEqual(bets,[5,10,5]);
});
test('socket and export retain the shuffle boundary and selected mathematical/progression evidence',async()=>{
  const {safeState}=require('../electron/socketGames.cjs');
  const {safeAuditRound}=require('../electron/blackjackAudit.cjs');
  assert.equal(safeState('blackjack','blackjackTableState',{tableId:'t',roundNumber:1,shuffleCount:3,dealer:{cards:['6S']},seats:[]},'a').shuffleCount,3);
  assert.equal(safeState('blackjack','blackjackTableState',{shuffleCount:-1},'a').shuffleCount,null);
  const row=safeAuditRound({shuffleCount:3,actions:[{action:'play',decisionEngine:'finite-shoe',math:{remaining:290,runningCount:2,shuffleCount:3,complete:true,chosenEv:.2},progression:'win-double-loss-half'}]});
  assert.equal(row.shuffleCount,3);assert.equal(row.actions[0].decisionEngine,'finite-shoe');assert.equal(row.actions[0].math.remaining,290);
  assert.equal(row.actions[0].progression,'win-double-loss-half');
});
test('finite choice respects unresolved split EV and requires improvement under both peek rules',async()=>{
  const {chooseFiniteMove}=await import('../src/blackjackFinite.js');
  assert.equal(chooseFiniteMove({complete:true,peek:{hit:.2,stand:.1},noPeek:{hit:-.1,stand:0}},'stand'),'stand');
  assert.equal(chooseFiniteMove({complete:true,peek:{hit:.2,stand:.1},noPeek:{hit:.1,stand:0}},'stand'),'hit');
  assert.equal(chooseFiniteMove({complete:true,peek:{hit:.2},noPeek:{hit:.2}},'split'),'split');
});
test('fresh private-table origin requires an explicit create, round zero, empty cards and a positive shuffle counter',async()=>{
 const {createShoeTracker}=await import('../src/blackjackResearch.js');
 const empty={tableId:'fresh',shuffleCount:1,roundNumber:0,phase:'betting',dealerCards:[],seats:[]};
 const unknown=createShoeTracker();assert.equal(unknown.observe(empty).usable,false);
 const tracker=createShoeTracker();tracker.beginCreation();const first=tracker.observe(empty);assert.equal(first.usable,true);assert.equal(first.origin,'new-private-table');
 const acting={...empty,roundNumber:1,phase:'acting',dealerHoleCardHidden:true,dealerCards:[c('6')],seats:[{hands:[{cards:[c('8'),c('8','D')]}]}]};
 assert.equal(tracker.observe(acting).observed,3);tracker.invalidate('disconnect');assert.equal(tracker.observe(acting).usable,false);
 const resumed=createShoeTracker();resumed.beginCreation();assert.equal(resumed.observe({...empty,roundNumber:3}).usable,false);
 const failed=createShoeTracker();failed.beginCreation();failed.cancelCreation();assert.equal(failed.observe(empty).usable,false);
});
test('engine coverage distinguishes actual finite commands, reference and specific fallback reasons',async()=>{
 const {summarizeEngineCoverage}=await import('../src/blackjackResearch.js');
 const row={accountId:'a',tableId:'t',roundNumber:1,actions:[{action:'bet'},{action:'play',decisionEngine:'finite-shoe',math:{complete:true}},{action:'play',decisionEngine:'table'},{action:'play',decisionEngine:'table',math:{complete:false,reason:'coverage'}}]};
 assert.deepEqual(summarizeEngineCoverage([row,row]),{plays:3,computed:1,reference:1,fallback:1,reasons:{coverage:1}});
});
