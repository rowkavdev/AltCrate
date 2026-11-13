const { test } = require('node:test');
const assert = require('node:assert/strict');

const card = (rank, suit = 'S') => ({ rank, suit });
const table = (phase, seat, extra = {}) => ({ tableId: 'table1', code: 'ABC123', roundNumber: 4, phase, minBet: 1, maxBet: 100, seats: [seat], ...extra });

test('auto Blackjack plans one private setup action, bet and move from server state', async () => {
  const { nextBlackjackCommand } = await import('../src/blackjackAuto.js');
  assert.deepEqual(nextBlackjackCommand({ connected: true, events: {}, tokens: 50, amount: 10 }), { key: 'create', action: 'create', payload: {} });
  const emptySeat = table('betting', null);
  assert.deepEqual(nextBlackjackCommand({ connected: true, events: { blackjackTableState: emptySeat }, tokens: 50, amount: 10 }), { key: 'table1:sit', action: 'sit', payload: { tableId: 'table1', code: 'ABC123', seatIndex: 0 } });
  const betting = table('betting', { mine: true, status: 'betting' });
  assert.deepEqual(nextBlackjackCommand({ connected: true, events: { blackjackTableState: betting }, tokens: 50, amount: 10 }), { key: 'table1:4:bet', action: 'bet', payload: { bet: 10 } });
  const acting = table('acting', { mine: true, status: 'playing', turnId: 'turn1', activeHandIndex: 0, bet: 10, hands: [{ status: 'playing', bet: 10, cards: [card('9'), card('4', 'D')] }] }, { dealerCards: [card('2', 'C')] });
  assert.deepEqual(nextBlackjackCommand({ connected: true, events: { blackjackTableState: acting }, tokens: 30, amount: 10 }), { key: 'table1:4:turn1:0:9S,4D', action: 'play', payload: { move: 'stand', turnId: 'turn1' } });
});

test('auto Blackjack uses available moves and stops for an unaffordable next bet', async () => {
  const { nextBlackjackCommand } = await import('../src/blackjackAuto.js');
  const pair = table('acting', { mine: true, status: 'playing', turnId: 'turn2', activeHandIndex: 0, bet: 10, hands: [{ status: 'playing', bet: 10, cards: [card('8'), card('8', 'D')] }] }, { dealerCards: [card('10', 'C')] });
  assert.equal(nextBlackjackCommand({ connected: true, events: { blackjackTableState: pair }, tokens: 20, amount: 10 }).payload.move, 'split');
  assert.equal(nextBlackjackCommand({ connected: true, events: { blackjackTableState: pair }, tokens: 0, amount: 10 }).payload.move, 'hit');
  assert.deepEqual(nextBlackjackCommand({ connected: true, events: { blackjackTableState: table('betting', { mine: true, status: 'betting' }) }, tokens: 0.36, amount: 10 }), { stop: 'Saldo insuficiente para apostar 10 tokens.' });
  assert.equal(nextBlackjackCommand({ connected: true, events: { blackjackTableState: table('result', { mine: true, status: 'result' }) }, tokens: 50, amount: 10 }), null);
});

test('auto Blackjack runner sends once per state, follows new cards and stops on request failure', async () => {
  const { createBlackjackAutoRunner } = await import('../src/blackjackAuto.js');
  const sent = [], stopped = [];
  const runner = createBlackjackAutoRunner({ send: async (action, payload) => { sent.push([action, payload]); return true; }, onStop: (reason) => stopped.push(reason) });
  runner.start('run1', 10);
  const betting = { connected: true, events: { blackjackTableState: table('betting', { mine: true, status: 'betting' }) }, tokens: 50, amount: 10 };
  await runner.observe(betting);
  await runner.observe(betting);
  assert.deepEqual(sent, [['bet', { bet: 10 }]]);
  const acting = { connected: true, events: { blackjackTableState: table('acting', { mine: true, status: 'playing', turnId: 'turn1', activeHandIndex: 0, bet: 10, hands: [{ status: 'playing', bet: 10, cards: [card('10'), card('6', 'D')] }] }, { dealerCards: [card('10', 'C')] }) }, tokens: 40, amount: 10 };
  await runner.observe(acting);
  await runner.observe(acting);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1], ['play', { move: 'hit', turnId: 'turn1' }]);
  const changed = structuredClone(acting);
  changed.events.blackjackTableState.seats[0].hands[0].cards.push(card('2', 'H'));
  await runner.observe(changed);
  assert.equal(sent.length, 3);
  runner.stop();
  await runner.observe({ ...betting, events: { blackjackTableState: table('betting', { mine: true, status: 'betting' }, { roundNumber: 5 }) } });
  assert.equal(sent.length, 3);
  assert.deepEqual(stopped, []);
});

test('runner stops if server state never confirms a sent action', async () => {
  const { createBlackjackAutoRunner } = await import('../src/blackjackAuto.js');
  let now = 1000;
  const stopped = [];
  const runner = createBlackjackAutoRunner({ send: async () => true, onStop: (reason) => stopped.push(reason), now: () => now });
  runner.start('run1', 10);
  const betting = { connected: true, events: { blackjackTableState: table('betting', { mine: true, status: 'betting' }) }, tokens: 50, amount: 10 };
  await runner.observe(betting);
  now += 16000;
  await runner.observe(betting);
  assert.deepEqual(stopped, ['Sem confirmação do servidor após 15 segundos.']);
  assert.equal(runner.active, false);
});

test('runner stops after a rejected command and never retries the same round', async () => {
  const { createBlackjackAutoRunner } = await import('../src/blackjackAuto.js');
  const sent = [], stopped = [];
  const runner = createBlackjackAutoRunner({ send: async (action) => { sent.push(action); return false; }, onStop: (reason) => stopped.push(reason) });
  runner.start('run1', 5);
  const context = { connected: true, events: { blackjackTableState: table('betting', { mine: true, status: 'betting' }) }, tokens: 50 };
  await runner.observe(context);
  await runner.observe(context);
  assert.deepEqual(sent, ['bet']);
  assert.equal(runner.active, false);
  assert.match(stopped[0], /recusou/);
});

test('balance update after a sent bet does not stop before the table confirms it', async () => {
  const { createBlackjackAutoRunner } = await import('../src/blackjackAuto.js');
  const stopped = [];
  const runner = createBlackjackAutoRunner({ send: async () => true, onStop: (reason) => stopped.push(reason) });
  runner.start('run1', 10);
  const before = { connected: true, events: { blackjackTableState: table('betting', { mine: true, status: 'betting' }) }, tokens: 10 };
  await runner.observe(before);
  await runner.observe({ ...before, tokens: 0 });
  assert.equal(runner.active, true);
  assert.deepEqual(stopped, []);
  const nextRound = { connected: true, events: { blackjackTableState: table('betting', { mine: true, status: 'betting' }, { roundNumber: 5 }) }, tokens: 0 };
  await runner.observe(nextRound);
  assert.equal(runner.active, false);
  assert.match(stopped[0], /Saldo insuficiente/);
});

test('an expiring clock cannot erase the pending server confirmation watchdog',async()=>{
  const {createBlackjackAutoRunner}=await import('../src/blackjackAuto.js');
  let time=1000;const stopped=[];
  const runner=createBlackjackAutoRunner({send:async()=>true,now:()=>time,onStop:reason=>stopped.push(reason)});
  runner.start('run',10);
  const context={connected:true,tokens:100,events:{blackjackTableState:table('acting',{mine:true,turnId:'turn1',activeHandIndex:0,actionDeadlineAt:6000,hands:[{status:'playing',bet:10,cards:[card('10'),card('6')]}]},{dealerCards:[card('10')]})}};
  await runner.observe(context);time=5500;await runner.observe(context);time=17000;await runner.observe(context);
  assert.equal(runner.active,false);
  assert.match(stopped[0],/Sem confirmação/);
});

test('advantage sizing uses the ceiling as a bound, awaits a funded plan and never doubles after a result',async()=>{
 const {createBlackjackAutoRunner}=await import('../src/blackjackAuto.js');
 const sent=[],stakes=[];
 const context=(round,tokens=100)=>({connected:true,tokens,events:{blackjackTableState:{tableId:'edge',phase:'betting',roundNumber:round,minBet:1,maxBet:10000,shuffleCount:1,seats:[{mine:true,status:'betting',hands:[]}]}}});
 const runner=createBlackjackAutoRunner({send:async(a,p)=>{sent.push({a,p});return true;},chooseBet:async(c,options)=>{assert.equal(options.ceiling,1000);return {amount:2,reason:'minimum',reserveCovered:true};},onStake:s=>stakes.push(s)});
 runner.start('r',1000,{progression:'edge'});await runner.observe(context(0));
 runner.recordResult({tableId:'edge',phase:'result',roundNumber:1,seats:[{mine:true,netProfit:2,hands:[{}]}]});
 await runner.observe(context(1,102));assert.deepEqual(sent.map(s=>s.p.bet),[2,2]);assert.equal(sent[0].p.progression,'edge');assert.equal(stakes.at(-1).amount,2);
});
test('stopping while the advantage estimate is pending prevents a bet',async()=>{
 const {createBlackjackAutoRunner}=await import('../src/blackjackAuto.js');let resolve;const sent=[];
 const runner=createBlackjackAutoRunner({send:async(a,p)=>{sent.push(p);return true;},chooseBet:()=>new Promise(r=>resolve=r)});
 const c={connected:true,tokens:100,events:{blackjackTableState:{tableId:'t',phase:'betting',roundNumber:0,minBet:1,maxBet:1000,seats:[{mine:true,status:'betting',hands:[]}]}}};
 runner.start('r',1000,{progression:'edge'});const pending=runner.observe(c);assert.equal(typeof resolve,'function');runner.stop();resolve({amount:2});await pending;assert.equal(sent.length,0);
});
test('a balance change during estimation discards the old stake and plans again',async()=>{
 const {createBlackjackAutoRunner}=await import('../src/blackjackAuto.js');let resolve,calls=0;const sent=[];
 const runner=createBlackjackAutoRunner({send:async(a,p)=>{sent.push(p);return true;},chooseBet:c=>{calls++;return calls===1?new Promise(r=>resolve=r):Promise.resolve({amount:2,reason:'minimum',reserveCovered:true});}});
 const c={connected:true,tokens:100,events:{blackjackTableState:{tableId:'t',phase:'betting',roundNumber:0,minBet:1,maxBet:1000,shuffleCount:1,seats:[{mine:true,status:'betting',hands:[]}]}}};
 runner.start('r',1000,{progression:'edge'});const pending=runner.observe(c);await runner.observe({...c,tokens:50});resolve({amount:10,reason:'minimum'});await pending;
 assert.equal(calls,2);assert.deepEqual(sent.map(p=>p.bet),[2]);
});
