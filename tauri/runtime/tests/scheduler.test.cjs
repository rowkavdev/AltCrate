const test = require('node:test');
const assert = require('node:assert/strict');
const { createScheduler, parseRetryAfter } = require('../engine/scheduler.cjs');

test('Retry-After accepts seconds and dates, with a safe fallback', () => {
  const now = Date.parse('2026-10-08T12:00:00Z');
  assert.equal(parseRetryAfter('3', now), 3000);
  assert.equal(parseRetryAfter('0', now), 1000);
  assert.equal(parseRetryAfter('Thu, 08 Oct 2026 12:00:04 GMT', now), 4000);
  assert.equal(parseRetryAfter('nonsense', now), 300000);
});

test('scheduler keeps requests bounded and distributes work across accounts', async () => {
  let now = 0;
  const starts = [];
  const scheduler = createScheduler({
    apiForAccount: (account) => ({
      snapshot: async () => ({ money: 0, tokens: 0, inventoryCount: 0, casesTotal: 0, cases: [] }),
      generate: async () => { starts.push(account.id); return { status: 200, ok: true, awardedCount: 1, caseName: 'Alpha' }; },
    }),
    now: () => now,
    sleep: async (ms) => { now += ms; },
    emit: () => {},
  });
  const final = await scheduler.start({ accounts: [{ id: 'a' }, { id: 'b' }], clicks: 3, maxRequests: 2, delayMs: 1000, concurrency: 2 });
  assert.deepEqual(starts.sort(), ['a', 'a', 'b', 'b']);
  assert.equal(final.phase, 'complete');
  assert.equal(final.sent, 4);
});

test('429 from one account delays the next account globally', async () => {
  let now = 0;
  const started = [];
  const events = [];
  const scheduler = createScheduler({
    apiForAccount: (account) => ({
      snapshot: async () => ({ money: 0, tokens: 0, inventoryCount: 0, casesTotal: 0, cases: [] }),
      generate: async () => {
        started.push({ id: account.id, time: now });
        return account.id === 'a'
          ? { status: 429, ok: false, retryAfter: '4', awardedCount: 0 }
          : { status: 200, ok: true, awardedCount: 1 };
      },
    }),
    now: () => now,
    sleep: async (ms) => { now += ms; },
    emit: (event) => events.push(event),
  });
  await scheduler.start({ accounts: [{ id: 'a' }, { id: 'b' }], clicks: 3, maxRequests: 1, delayMs: 1000, concurrency: 1 });
  assert.equal(started[0].id, 'a');
  assert.equal(started[1].id, 'b');
  assert.ok(started[1].time - started[0].time >= 4000);
  assert.ok(events.some((event) => event.type === 'cooldown'));
});

test('stop prevents another request after the current one', async () => {
  let calls = 0;
  let scheduler;
  scheduler = createScheduler({
    apiForAccount: () => ({
      snapshot: async () => ({ money: 0, tokens: 0, inventoryCount: 0, casesTotal: 0, cases: [] }),
      generate: async () => { calls++; scheduler.stop(); return { status: 200, ok: true, awardedCount: 1 }; },
    }),
    now: () => Date.now(),
    sleep: async () => {},
    emit: () => {},
  });
  const final = await scheduler.start({ accounts: [{ id: 'a' }], clicks: 3, maxRequests: 5, delayMs: 1000, concurrency: 1 });
  assert.equal(calls, 1);
  assert.equal(final.phase, 'stopped');
});

test('adaptive continuous mode starts without an arbitrary delay and keeps running until stopped', async () => {
  let time = 0;
  let calls = 0;
  let scheduler;
  scheduler = createScheduler({
    apiForAccount: () => ({
      snapshot: async () => ({ casesTotal: calls }),
      generate: async () => { calls++; if (calls === 21) scheduler.stop(); return { status: 200, ok: true, awardedCount: 1 }; },
    }),
    now: () => time,
    sleep: async (ms) => { time += ms; }, emit: () => {},
  });
  const result = await scheduler.start({ accounts: [{ id: 'a' }], clicks: 1000, continuous: true, adaptive: true, concurrency: 1 });
  assert.equal(result.sent, 21);
  assert.equal(result.phase, 'stopped');
  assert.equal(result.intervalMs, 0);
});

test('money mode splits requests and waits before the known window limit', async () => {
  let time = 1000;
  let saved = {};
  const calls = [];
  let scheduler;
  scheduler = createScheduler({
    apiForAccount: () => ({
      snapshot: async () => ({ money: calls.reduce((sum, n) => sum + n, 0), casesTotal: 0 }),
      clickMoney: async (clicks) => { calls.push(clicks); return { ok: true, status: 200 }; },
    }),
    now: () => time,
    sleep: async (ms) => { time += ms; },
    budgetStore: { load: async () => saved, save: async (state) => { saved = structuredClone(state); } },
    emit: (event) => { if (event.type === 'budget-wait') scheduler.stop(); },
  });
  const result = await scheduler.start({ accounts: [{ id: 'a' }], clicks: 1000, kind: 'money', continuous: true, adaptive: true, concurrency: 1 });
  assert.deepEqual(calls, [1000, 900]);
  assert.equal(result.failed, 0);
  assert.equal(saved.budgets.money.used, 1900);
});
