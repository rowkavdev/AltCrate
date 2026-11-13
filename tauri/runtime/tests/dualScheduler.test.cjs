const test = require('node:test');
const assert = require('node:assert/strict');
const { createScheduler } = require('../engine/scheduler.cjs');
const { createClickCoordinator } = require('../engine/clickCoordinator.cjs');
const { createAccountQueue } = require('../engine/accountQueue.cjs');

test('case and money schedulers share the observed combined limit', async () => {
  let saved = {};
  const coordinator = createClickCoordinator({ store: { load: async () => saved, save: async (value) => { saved = structuredClone(value); } }, now: () => 1000 });
  const queue = createAccountQueue();
  const calls = [];
  const apiForAccount = () => ({
    snapshot: async () => ({ money: 0, casesTotal: 0 }),
    generate: async (clicks) => { calls.push(['case', clicks]); return { ok: true, status: 200, awardedCount: 1 }; },
    clickMoney: async (clicks) => { calls.push(['money', clicks]); return { ok: true, status: 200 }; },
  });
  const options = { apiForAccount, coordinator, accountQueue: queue, now: () => 1000, sleep: async () => {} };
  const cases = createScheduler({ ...options, defaultKind: 'case' });
  const money = createScheduler({ ...options, defaultKind: 'money' });
  await Promise.all([
    cases.start({ accounts: [{ id: 'a' }], clicks: 1000, kind: 'case', maxRequests: 1, delayMs: 1000, concurrency: 1 }),
    money.start({ accounts: [{ id: 'a' }], clicks: 1000, kind: 'money', maxRequests: 1, delayMs: 1000, concurrency: 1 }),
  ]);
  assert.deepEqual(calls.sort(), [['case', 1000], ['money', 900]]);
  assert.equal(saved.budgets.case.used, 1000);
  assert.equal(saved.budgets.money.used, 900);
  assert.equal(saved.combined.used, 1900);
});

test('case HTTP 429 makes money wait for the same server deadline', async () => {
  let time = 1000;
  let saved = {};
  const coordinator = createClickCoordinator({ store: { load: async () => saved, save: async (value) => { saved = structuredClone(value); } }, now: () => time });
  const options = {
    coordinator, now: () => time, sleep: async (ms) => { time += ms; },
    apiForAccount: () => ({ snapshot: async () => ({ money: 0, casesTotal: 0 }), generate: async () => ({ status: 429, ok: false, retryAfter: '4' }), clickMoney: async () => ({ status: 200, ok: true }) }),
  };
  const cases = createScheduler({ ...options, defaultKind: 'case' });
  const money = createScheduler({ ...options, defaultKind: 'money' });
  await cases.start({ accounts: [{ id: 'a' }], clicks: 1000, kind: 'case', maxRequests: 1, delayMs: 1000, concurrency: 1 });
  const deadline = saved.cooldownUntil;
  await money.start({ accounts: [{ id: 'a' }], clicks: 1000, kind: 'money', maxRequests: 1, delayMs: 1000, concurrency: 1 });
  assert.ok(time >= deadline);
  assert.equal(money.status().succeeded, 1);
});
