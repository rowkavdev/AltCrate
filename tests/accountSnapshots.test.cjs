const test = require('node:test');
const assert = require('node:assert/strict');
const { createAccountSnapshots } = require('../electron/accountSnapshots.cjs');

test('farm baselines and confirmations read the requested resource fresh without a full-account sweep',async()=>{
  let money=10,casesTotal=5;const calls=[];
  const reader=createAccountSnapshots({apiForAccount:()=>({snapshot:async()=>{calls.push('full');return {money,casesTotal};},farmSnapshot:async(kind,previous)=>{calls.push(kind);return {...previous,[kind==='money'?'money':'casesTotal']:kind==='money'?money:casesTotal};}})});
  const account={id:'a'};
  const first=await reader.readForFarm(account,'money');
  money=20;reader.invalidate('a');
  const after=await reader.readForFarm(account,'money',first);
  assert.equal(after.money,20);assert.equal(after.casesTotal,5);
  casesTotal=9;
  const next=await reader.readForFarm(account,'case');
  assert.equal(next.casesTotal,9);assert.equal(next.money,20);
  assert.deepEqual(calls,['full','money','case']);
  reader.invalidateForEvent({type:'inventory-action',accountId:'a'});
  await reader.readForFarm(account,'case');
  assert.equal(calls.at(-1),'full','other mutations require a new complete baseline');
});

test('a partial farm read cannot mark unrelated fields fresh for an ordinary refresh',async()=>{
  const calls=[];
  const reader=createAccountSnapshots({apiForAccount:()=>({snapshot:async()=>{calls.push('full');return {money:10,casesTotal:5};},farmSnapshot:async(kind,previous)=>{calls.push(kind);return {...previous,money:20};}})});
  await reader.readForFarm({id:'a'},'money');
  await reader.readForFarm({id:'a'},'money');
  await reader.read({id:'a'});
  assert.deepEqual(calls,['full','money','full']);
});

test('a hundred account snapshots never exceed four reads in flight', async () => {
  let active = 0;
  let peak = 0;
  const reader = createAccountSnapshots({ apiForAccount: (account) => ({ snapshot: async () => {
    active++;
    peak = Math.max(peak, active);
    await Promise.resolve();
    active--;
    return { id: account.id };
  } }), maxConcurrent: 4 });
  const results = await Promise.all(Array.from({ length: 100 }, (_, index) => reader.read({ id: `a${index}` })));
  assert.equal(results.length, 100);
  assert.equal(peak, 4);
});

test('duplicate reads coalesce and cached reads expire after thirty seconds', async () => {
  let time = 1000;
  let calls = 0;
  const reader = createAccountSnapshots({ now: () => time, apiForAccount: () => ({ snapshot: async () => ({ count: ++calls }) }) });
  const [first, duplicate] = await Promise.all([reader.read({ id: 'a' }), reader.read({ id: 'a' })]);
  assert.deepEqual([first.count, duplicate.count, calls], [1, 1, 1]);
  time += 29999;
  assert.equal((await reader.read({ id: 'a' })).count, 1);
  time++;
  assert.equal((await reader.read({ id: 'a' })).count, 2);
});

test('failed and invalidated snapshots get a new read', async () => {
  let calls = 0;
  const reader = createAccountSnapshots({ apiForAccount: () => ({ snapshot: async () => {
    calls++;
    if (calls === 1) throw new Error('offline');
    return { count: calls };
  } }) });
  await assert.rejects(() => reader.read({ id: 'a' }), /offline/);
  assert.equal((await reader.read({ id: 'a' })).count, 2);
  reader.invalidate('a');
  assert.equal((await reader.read({ id: 'a' })).count, 3);
  reader.remove('a');
  assert.equal((await reader.read({ id: 'a' })).count, 4);
});

test('a stale completion cannot replace a newer fresh snapshot', async () => {
  let resolveOld;
  let calls = 0;
  const reader = createAccountSnapshots({ apiForAccount: () => ({ snapshot: () => {
    calls++;
    return calls === 1 ? new Promise((resolve) => { resolveOld = resolve; }) : Promise.resolve({ value: 'new' });
  } }) });
  const old = reader.read({ id: 'a' });
  await Promise.resolve();
  const fresh = await reader.read({ id: 'a' }, { fresh: true });
  assert.deepEqual(fresh, { value: 'new' });
  resolveOld({ value: 'old' });
  await old;
  assert.deepEqual(await reader.read({ id: 'a' }), { value: 'new' });
});

test('farm results retain their fresh cache while other mutations invalidate affected accounts',async()=>{
  const counts=new Map();
  const reader=createAccountSnapshots({apiForAccount:account=>({snapshot:async()=>{const count=(counts.get(account.id)||0)+1;counts.set(account.id,count);return {money:count};}})});
  await reader.read({id:'a'});await reader.read({id:'b'});
  reader.invalidate('a');
  await reader.read({id:'a'},{fresh:true});
  reader.invalidateForEvent({type:'request',accountId:'a'});
  assert.equal((await reader.read({id:'a'})).money,2,'a confirmed farm event does not trigger a duplicate API read');
  reader.invalidateForEvent({type:'inventory-action',accountId:'a',destinationAccountId:'b'});
  assert.equal((await reader.read({id:'a'})).money,3);assert.equal((await reader.read({id:'b'})).money,2);
});

test('a queued balance read checks shared cooldown before it starts',async()=>{
  let until=0,release;const calls=[];
  const reader=createAccountSnapshots({maxConcurrent:1,now:()=>1000,coordinator:{cooldown:async()=>until},apiForAccount:account=>({snapshot:async()=>{calls.push(account.id);if(account.id==='a')await new Promise(resolve=>{release=resolve;});return {money:0};}})});
  const first=reader.read({id:'a'});
  for(let i=0;i<10&&!release;i++)await new Promise(setImmediate);
  const queued=reader.read({id:'b'});const rejected=assert.rejects(queued,error=>error.code==='FARM_COOLDOWN');
  until=5000;release();await first;await rejected;
  assert.deepEqual(calls,['a']);
});
