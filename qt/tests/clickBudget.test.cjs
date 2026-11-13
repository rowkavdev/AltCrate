const test = require('node:test');
const assert = require('node:assert/strict');
const { WINDOW_MS, availability, reserve, afterLimit, cleanState } = require('../engine/clickBudget.cjs');

test('case budget splits the final batch then waits before a 429', () => {
  let state = {};
  for (const expected of [1000, 1000, 400]) {
    const result = reserve(state, 'case', 1000, 1000);
    assert.equal(result.clicks, expected);
    state = result.state;
  }
  const blocked = reserve(state, 'case', 1000, 1000);
  assert.equal(blocked.clicks, 0);
  assert.equal(blocked.waitUntil, 1000 + WINDOW_MS);
  assert.equal(reserve(state, 'case', 1000, 1000 + WINDOW_MS).clicks, 1000);
});

test('money waits when case clicks have filled the observed combined window', () => {
  let state = reserve({}, 'case', 1000, 1000).state;
  state = reserve(state, 'case', 1000, 1000).state;
  state = reserve(state, 'case', 400, 1000).state;
  assert.equal(availability(state, 'case', 1000).remaining, 0);
  assert.equal(availability(state, 'money', 1000).remaining, 0);
  assert.equal(reserve(state, 'money', 1000, 1000).clicks, 0);
  state = reserve(state, 'money', 1000, 1000 + WINDOW_MS).state;
  assert.equal(reserve(state, 'money', 1000, 1000 + WINDOW_MS).clicks, 900);
  assert.equal(availability(state, 'case', 1000 + WINDOW_MS).remaining, 900);
});

test('legacy reservation migrates into the operation that made it', () => {
  const legacy = { windowStart: 1000, used: 2400, kind: 'case', cooldownUntil: 0 };
  const state = cleanState(legacy);
  assert.equal(state.budgets.case.used, 2400);
  assert.equal(state.budgets.money.used, 0);
  assert.equal(availability(legacy, 'money', 2000).remaining, 0);
});

test('server cooldown pauses both kinds until its deadline', () => {
  const state = afterLimit({ budgets: { case: { windowStart: 1000, used: 2000 } } }, 301000);
  assert.equal(reserve(state, 'case', 1000, 300999).clicks, 0);
  assert.equal(reserve(state, 'money', 1000, 300999).clicks, 0);
  assert.equal(reserve(state, 'money', 1000, 301000).clicks, 0);
  assert.equal(reserve(state, 'money', 1000, 311000).clicks, 1000);
});
