const { test } = require('node:test');
const assert = require('node:assert/strict');

test('Blackjack stats count each confirmed account round once', async () => {
  const { addBlackjackResult, summarizeBlackjackResults } = await import('../src/blackjackStats.js');
  let state = { rounds: {}, byAccount: {} };
  state = addBlackjackResult(state, 'a', { tableId: 'table1', roundNumber: 4, phase: 'result', seats: [{ mine: true, bet: 10, netProfit: 15, hands: [{ result: 'blackjack' }] }] });
  state = addBlackjackResult(state, 'a', { tableId: 'table1', roundNumber: 4, phase: 'result', seats: [{ mine: true, bet: 10, netProfit: 15, hands: [{ result: 'blackjack' }] }] });
  state = addBlackjackResult(state, 'a', { tableId: 'table1', roundNumber: 5, phase: 'result', seats: [{ mine: true, bet: 10, netProfit: -10, hands: [{ result: 'lose' }] }] });
  state = addBlackjackResult(state, 'b', { tableId: 'table2', roundNumber: 2, phase: 'result', seats: [{ mine: true, bet: 20, netProfit: 0, hands: [{ result: 'push' }] }] });
  assert.deepEqual(state.byAccount.a, { won: 15, lost: 10, positive: 1, negative: 1, ties: 0 });
  assert.deepEqual(state.byAccount.b, { won: 0, lost: 0, positive: 0, negative: 0, ties: 1 });
  assert.deepEqual(summarizeBlackjackResults(state), { won: 15, lost: 10, net: 5, positive: 1, negative: 1, ties: 1 });
});

test('Blackjack stats ignore unconfirmed, other-account and pre-result states', async () => {
  const { addBlackjackResult } = await import('../src/blackjackStats.js');
  let state = { rounds: {}, byAccount: {} };
  state = addBlackjackResult(state, 'a', { tableId: 'table1', roundNumber: 1, phase: 'acting', seats: [{ mine: true, bet: 10, netProfit: 5 }] });
  state = addBlackjackResult(state, 'a', { tableId: 'table1', roundNumber: 1, phase: 'result', seats: [{ mine: false, bet: 10, netProfit: 5 }] });
  state = addBlackjackResult(state, 'a', { tableId: 'table1', roundNumber: 1, phase: 'result', seats: [{ mine: true, bet: 10, netProfit: null, hands: [{ result: 'win' }] }] });
  assert.deepEqual(state.byAccount, {});
});

test('group bet eligibility checks each account table and balance', async () => {
  const { eligibleBlackjackBet } = await import('../src/blackjackStats.js');
  const table = { phase: 'betting', minBet: 1, maxBet: 5000, seats: [{ mine: true, status: 'betting' }] };
  assert.equal(eligibleBlackjackBet({ connected: true, table, tokens: 50, pending: false }, 10), true);
  assert.equal(eligibleBlackjackBet({ connected: true, table, tokens: 5, pending: false }, 10), false);
  assert.equal(eligibleBlackjackBet({ connected: false, table, tokens: 50, pending: false }, 10), false);
  assert.equal(eligibleBlackjackBet({ connected: true, table: { ...table, phase: 'acting' }, tokens: 50, pending: false }, 10), false);
  assert.equal(eligibleBlackjackBet({ connected: true, table, tokens: 50, pending: false }, 1.5), false);
});
