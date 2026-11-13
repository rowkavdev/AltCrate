const test = require('node:test');
const assert = require('node:assert/strict');
const { createClickCoordinator } = require('../engine/clickCoordinator.cjs');

test('remaining clicks keep their real reset deadline across restart', async () => {
  let saved = {}, time = 1000;
  const store = {load:async()=>saved,save:async value=>{saved=structuredClone(value);}};
  const c = createClickCoordinator({store,now:()=>time});
  await c.reserve('case',999,()=>true,'a');
  const reopened = createClickCoordinator({store,now:()=>time});
  assert.equal((await reopened.status('a')).caseResetAt,311000);
  time=311000;
  assert.equal((await reopened.status('a')).caseResetAt,0);
});

test('new route members inherit persisted shared deadlines without copying account-only holds', async () => {
  let saved = {};
  const store = { load: async () => saved, save: async value => { saved = structuredClone(value); } };
  const c = createClickCoordinator({ store, now: () => 1000 });
  await c.limitRoute('direct', 61000, ['a']);
  await c.limit(91000, 'a');
  await c.inheritRoute('direct', 'new');
  assert.equal(await c.cooldown('new'), 61000);
  assert.equal(await c.cooldown(), 0);
  assert.equal(await c.inheritRoute('another-route', 'other'), 0);
  assert.equal(await c.cooldown('other'), 0);
  const reopened = createClickCoordinator({ store, now: () => 1000 });
  await reopened.inheritRoute('direct', 'later');
  assert.equal(await reopened.cooldown('later'), 61000);
  assert.equal((await reopened.reserve('case', 950, () => true, 'later')).clicks, 0);
});

test('a route group hold persists atomically without pausing another route or resetting reservations', async () => {
  let saved = {}, writes = 0;
  const store = { load: async () => saved, save: async value => { saved = structuredClone(value); writes++; } };
  const coordinator = createClickCoordinator({ store, now: () => 1000 });
  await coordinator.reserve('case', 950, () => true, 'a');
  await coordinator.reserve('money', 500, () => true, 'b');
  writes = 0;
  await coordinator.limitAccounts(61000, ['a', 'b']);
  assert.equal(writes, 1);
  assert.equal(await coordinator.cooldown(), 0);
  assert.equal(await coordinator.cooldown('a'), 61000);
  assert.equal(await coordinator.cooldown('b'), 61000);
  assert.equal((await coordinator.reserve('case', 950, () => true, 'c')).clicks, 950);
  const restarted = createClickCoordinator({ store, now: () => 1000 });
  assert.equal(await restarted.cooldown('b'), 61000);
  assert.equal((await restarted.status('a')).caseUsed, 950);
});

test('an account server pause leaves other scopes sendable and survives restart',async()=>{
  let saved={},time=1000;
  const store={load:async()=>saved,save:async value=>{saved=structuredClone(value);}};
  const c=createClickCoordinator({store,now:()=>time});
  await c.reserve('money',950,()=>true,'a');
  await c.limit(10000,'a');
  assert.equal(await c.cooldown(),0);assert.equal(await c.cooldown('a'),10000);
  assert.equal((await c.availability('case','a')).cooldownUntil,10000);
  assert.equal((await c.reserve('case',950,()=>true,'a')).cooldownUntil,10000);
  assert.equal((await c.reserve('case',950,()=>true,'a')).clicks,0);
  assert.equal((await c.reserve('case',950,()=>true,'b')).clicks,950);
  const reopened=createClickCoordinator({store,now:()=>time});
  const status=await reopened.statusForAccounts(['a','b']);
  assert.equal(status.cooldownUntil,0);assert.equal(status.accountBudgets.a.cooldownUntil,10000);assert.equal(status.accountBudgets.b.cooldownUntil,0);
  await reopened.limit(5000);
  assert.equal(await reopened.cooldown('a'),10000);assert.equal(await reopened.cooldown('b'),5000);
  time=5000;assert.equal(await reopened.cooldown('b'),0);assert.equal(await reopened.cooldown('a'),10000);
});

test('simultaneous reservations share one persisted state', async () => {
  let saved = {};
  const coordinator = createClickCoordinator({
    store: { load: async () => saved, save: async (value) => { await Promise.resolve(); saved = structuredClone(value); } },
    now: () => 1000,
  });
  const results = await Promise.all(Array.from({ length: 5 }, () => coordinator.reserve('money', 1000)));
  assert.deepEqual(results.map((r) => r.clicks), [1000, 900, 0, 0, 0]);
  assert.equal(saved.budgets.money.used, 1900);
  assert.equal((await coordinator.reserve('case', 1000)).clicks, 0);
  assert.equal(saved.budgets.case.used, 0);
  assert.equal(saved.combined.used, 1900);
});

test('429 cooldown affects both modes and survives restart', async () => {
  let saved = {};
  let time = 1000;
  const store = { load: async () => saved, save: async (value) => { saved = structuredClone(value); } };
  const coordinator = createClickCoordinator({ store, now: () => time });
  await coordinator.limit(5000);
  assert.equal((await coordinator.reserve('case', 1000)).clicks, 0);
  assert.equal((await createClickCoordinator({ store, now: () => time }).reserve('money', 1000)).clicks, 0);
  time = 5000;
  assert.equal((await coordinator.reserve('money', 1000)).clicks, 1000);
});

test('coordinator reports current shared usage after the window rolls over', async () => {
  let time = 1000;
  let saved = {};
  const coordinator = createClickCoordinator({ store: { load: async () => saved, save: async (value) => { saved = structuredClone(value); } }, now: () => time });
  await coordinator.reserve('case', 800);
  const during = await coordinator.status();
  assert.equal(during.caseUsed, 800);
  assert.equal(during.combinedUsed, 800);
  assert.equal(during.caseRemaining, 1600);
  time += 310000;
  const after = await coordinator.status();
  assert.equal(after.caseUsed, 0);
  assert.equal(after.combinedUsed, 0);
});

test('account budgets accumulate independently, persist and still share a server cooldown',async()=>{
  let saved={},time=1000;
  const store={load:async()=>saved,save:async value=>{saved=structuredClone(value);}};
  const c=createClickCoordinator({store,now:()=>time});
  for(const id of ['a','b']){c.activate('case',id);c.activate('money',id);}
  const turns=await Promise.all(['a','b'].map(id=>c.reserve('case',950,()=>true,id)));
  assert.deepEqual(turns.map(turn=>turn.clicks),[950,950]);
  for(const id of ['a','b'])assert.equal((await c.reserve('money',950,()=>true,id)).clicks,950);
  assert.equal((await c.statusForAccounts(['a','b'])).combinedUsed,3800);
  const reopened=createClickCoordinator({store,now:()=>time});
  assert.equal((await reopened.status('a')).combinedUsed,1900);
  assert.equal((await reopened.reserve('money',1,()=>true,'b')).clicks,0);
  await reopened.limit(5000);
  assert.equal((await reopened.reserve('case',1000,()=>true,'a')).clicks,0);
  assert.equal((await reopened.reserve('case',1000,()=>true,'b')).clicks,0);
  time=5000;
  assert.equal((await reopened.reserve('case',1000,()=>true,'b')).clicks,0);
  time=311000;
  assert.equal((await reopened.reserve('case',1000,()=>true,'b')).clicks,1000);
});

test('a short server pause never replenishes live account budgets, including after restart',async()=>{
  let saved={},time=1000;
  const store={load:async()=>saved,save:async value=>{saved=structuredClone(value);}};
  const c=createClickCoordinator({store,now:()=>time});
  await c.reserve('money',1000,()=>true,'a');
  await c.reserve('money',800,()=>true,'b');
  await c.limit(21000);
  time=21000;
  const reopened=createClickCoordinator({store,now:()=>time});
  assert.equal((await reopened.reserve('money',1000,()=>true,'a')).clicks,900);
  assert.equal((await reopened.status('b')).moneyUsed,800);
  assert.equal((await reopened.reserve('money',1000,()=>true,'a')).clicks,0);
});

test('migration conservatively retains an old unassigned reservation in each new account budget',async()=>{
  let saved={budgets:{money:{windowStart:1000,used:1000}},combined:{windowStart:1000,used:1000}};
  const c=createClickCoordinator({store:{load:async()=>saved,save:async value=>{saved=structuredClone(value);}},now:()=>2000});
  assert.equal((await c.reserve('money',1000,()=>true,'new-account')).clicks,900);
  assert.equal((await c.status('new-account')).moneyUsed,1900);
});
