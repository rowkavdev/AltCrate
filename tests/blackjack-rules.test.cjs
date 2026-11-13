const test=require('node:test'),assert=require('node:assert/strict');
test('server rule allowlist excludes credentials and refuses invalid values',async()=>{
 const {safeState}=require('../electron/socketGames.cjs');
 const out=safeState('blackjack','blackjackConfig',{minBet:1,maxBet:99,rules:{deckCount:6,blackjackPayout:1.5,maxHandsPerSeat:4,dealerStandsOnSoft17:true,doubleAfterSplit:false,token:'private',peek:false,shuffleSecret:'secret'}},'a');
 assert.deepEqual(out.rules,{dealerStandsOnSoft17:true,doubleAfterSplit:false,deckCount:6,maxHandsPerSeat:4,blackjackPayout:1.5});
 assert.deepEqual(safeState('blackjack','blackjackConfig',{deckCount:900,maxHandsPerSeat:10,blackjackPayout:'1.5'},'a').rules,{});
});
test('announced conflicting rules stop automation rather than silently applying the old table',async()=>{
 const {nextBlackjackCommand}=await import('../src/blackjackAuto.js');
 assert.match(nextBlackjackCommand({connected:true,events:{blackjackConfig:{rules:{dealerStandsOnSoft17:false}}}}).stop,/regras/);
});
test('seat state retains already finished hands, shared bankroll and the active hand',async()=>{
 const {jointStateForSeat,resolveBlackjackRules}=await import('../src/blackjackRules.js');
 const c=rank=>({rank,suit:'S'});
 const table={dealerCards:[c('6')],seats:[{mine:true,activeHandIndex:1,hands:[{cards:[c('K'),c('8')],bet:10,status:'stand'},{cards:[c('5'),c('6')],bet:5,status:'playing'}]}]};
 const state=jointStateForSeat(table,{counts:Array(10).fill(24)},15,true,false,resolveBlackjackRules().rules);
 assert.equal(state.availableUnits,3);assert.equal(state.hands[0].betUnits,2);assert.equal(state.activeHandIndex,1);assert.equal(state.hands[0].status,'stand');
});
test('mathematical fallback reason and full-seat scope survive sanitized export',()=>{
 const {safeAuditRound}=require('../electron/blackjackAudit.cjs');
 const row=safeAuditRound({actions:[{action:'play',math:{complete:false,reason:'coverage',scope:'whole-seat',ruleSource:'public-client',token:'private'}}]});
 assert.equal(row.actions[0].math.reason,'coverage');assert.equal(row.actions[0].math.scope,'whole-seat');assert.equal(row.actions[0].math.token,undefined);
});
test('offline environment uses expected returns on fixed ordered cards, split aces and dealer peek',async()=>{
 const {simulateRound,pairedSummary}=await import('../scripts/compare-blackjack-engines.mjs');
 assert.equal(simulateRound([10,10,6,10,10]).net,1); // player20; dealer bust
 assert.equal(simulateRound([1,10,9,10]).net,1.5); // natural
 assert.equal(simulateRound([8,8,1,10],{peek:true}).net,-1); // dealer natural, no split
 assert.equal(simulateRound([1,1,6,10,10,10,10]).net,2); // ordinary split ace wins
 const s=pairedSummary([{net:1,stake:1},{net:-1,stake:1}],[{net:1,stake:1},{net:1,stake:1}]);
 assert.equal(s.pairedDifferencePerInitialUnit,1);assert.ok(s.approximate95PercentCI[0]<1&&s.approximate95PercentCI[1]>1);
});
