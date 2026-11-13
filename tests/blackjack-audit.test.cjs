const test = require('node:test');
const assert = require('node:assert/strict');
const { createBlackjackAudit, assertCurrentBlackjackAction } = require('../electron/blackjackAudit.cjs');
const card = rank => ({ rank, suit:'S' });
const table = () => ({ tableId:'t1',roundNumber:2,phase:'acting',dealerCards:[card('K')],seats:[{mine:true,turnId:'turn1',activeHandIndex:0,bet:10,hands:[{status:'playing',bet:10,cards:[card('10'),card('6')]}]}] });

test('queued actions reject changed turns, rounds, expired deadlines and illegal double/split', () => {
  const t=table();
  assert.doesNotThrow(()=>assertCurrentBlackjackAction(t,'play',{move:'hit',turnId:'turn1',tableId:'t1',roundNumber:2},100));
  assert.throws(()=>assertCurrentBlackjackAction(t,'play',{move:'hit',turnId:'old'},100),/vez mudou/);
  assert.throws(()=>assertCurrentBlackjackAction(t,'play',{move:'hit',turnId:'turn1',roundNumber:1},100),/ronda mudou/);
  t.seats[0].actionDeadlineAt=100;
  assert.throws(()=>assertCurrentBlackjackAction(t,'play',{move:'hit',turnId:'turn1'},100),/prazo/);
  delete t.seats[0].actionDeadlineAt;
  t.seats[0].hands[0].cards.push(card('2'));
  assert.throws(()=>assertCurrentBlackjackAction(t,'play',{move:'double',turnId:'turn1'},100),/Dobrar/);
});

test('audit links actual sent moves, observed transitions and server outcomes without secrets', () => {
  let clock=1000;
  const audit=createBlackjackAudit({now:()=>clock});
  const t=table();
  audit.observe('local1',t);
  audit.command('local1','play',{move:'hit',turnId:'turn1',source:'auto',tokensAtDecision:20},t);
  clock+=120;
  t.seats[0].hands[0].cards.push(card('2'));
  audit.observe('local1',t);
  audit.command('local1','play',{move:'stand',turnId:'turn1',source:'auto',tokensAtDecision:20},t);
  clock+=80;
  t.phase='result';t.seats[0].netProfit=-10;t.seats[0].hands[0].status='stand';t.seats[0].hands[0].result='lose';t.dealerCards.push(card('Q'));t.dealerValue=20;
  t.secret='credential';t.seats[0].userId='private-user';
  audit.observe('local1',t);
  const row=audit.history('local1')[0];
  assert.equal(row.netProfit,-10);
  assert.equal(row.actions.length,2);
  assert.equal(row.actions[0].transitionMs,120);
  assert.equal(row.actions[1].transitionMs,80);
  assert.deepEqual(row.actions[0].cards,[card('10'),card('6')]);
  assert.equal(row.reason,'dealer-higher');
  assert.equal(JSON.stringify(row).includes('credential'),false);
  assert.equal(JSON.stringify(row).includes('private-user'),false);
  const copy=audit.history('local1');copy[0].actions.length=0;
  assert.equal(audit.history('local1')[0].actions.length,2);
});

test('audit marks a passed turn without an app action and never invents a result', () => {
  const audit=createBlackjackAudit();const t=table();
  audit.observe('local1',t);t.phase='dealer';t.seats[0].hands[0].status='stand';audit.observe('local1',t);
  assert.equal(audit.history('local1')[0].turnsWithoutCommand,1);
  assert.equal(audit.history('local1')[0].netProfit,null);
});
test('AI proposal and actual engine survive export without arbitrary model payloads',()=>{
  const audit=createBlackjackAudit();const t=table();
  audit.command('local','play',{move:'hit',source:'auto',decisionEngine:'table-compare',aiMove:'stand',aiLatencyMs:28,apiKey:'secret'},t);
  const action=audit.history()[0].actions[0];
  assert.equal(action.decisionEngine,'table-compare');assert.equal(action.aiMove,'stand');assert.equal(action.aiLatencyMs,28);
  assert.equal(JSON.stringify(action).includes('secret'),false);
});

test('site betting windows keep the previous round number; audit attaches the bet to the next hand and preserves final cards',()=>{
  let time=1000;const audit=createBlackjackAudit({now:()=>time});
  const t=table();t.roundNumber=0;t.phase='betting';t.seats[0].status='betting';t.seats[0].hands=[];
  audit.observe('a',t);audit.command('a','bet',{bet:10,source:'auto'},t);
  time+=70;t.roundNumber=1;t.phase='acting';t.seats[0].status='playing';t.seats[0].hands=[{status:'playing',cards:[card('K'),card('8')],bet:10}];audit.observe('a',t);
  audit.command('a','play',{move:'stand',source:'auto'},t);
  time+=60;t.phase='result';t.dealerCards=[card('K'),card('Q')];t.dealerValue=20;t.seats[0].netProfit=-10;t.seats[0].hands[0].status='stand';t.seats[0].hands[0].result='lose';audit.observe('a',t);
  t.phase='betting';t.dealerCards=[];t.seats[0].hands=[];t.seats[0].status='betting';t.seats[0].netProfit=null;audit.observe('a',t);audit.command('a','bet',{bet:10,source:'auto'},t);
  const rows=audit.history('a');assert.equal(rows.length,2);
  const first=rows.find(r=>r.roundNumber===1),second=rows.find(r=>r.roundNumber===2);
  assert.equal(first.phase,'result');assert.equal(first.netProfit,-10);assert.equal(first.dealerCards.length,2);assert.equal(first.hands[0].cards.length,2);
  assert.deepEqual(first.actions.map(a=>a.action),['bet','play']);assert.equal(first.actions[0].transitionMs,70);
  assert.deepEqual(second.actions.map(a=>a.action),['bet']);assert.equal(second.netProfit,null);
});

test('advantage sizing metadata is preserved without arbitrary data or credentials',()=>{
 const {safeAuditRound}=require('../electron/blackjackAudit.cjs');
 const row=safeAuditRound({actions:[{action:'bet',progression:'edge',bet:12,betting:{policy:'edge',complete:true,reason:'edge',lowerBound:.03,meanPeek:.06,meanNoPeek:.05,samples:60000,confidence:.99,unit:2,ceiling:1000,reserveCovered:true,remaining:240,shuffleCount:2,origin:'observed-renewal',token:'secret',counts:[1,2,3]}}]});
 assert.equal(row.actions[0].progression,'edge');assert.equal(row.actions[0].betting.lowerBound,.03);assert.equal(row.actions[0].betting.reserveCovered,true);assert.equal(row.actions[0].betting.token,undefined);assert.equal(row.actions[0].betting.counts,undefined);
});
