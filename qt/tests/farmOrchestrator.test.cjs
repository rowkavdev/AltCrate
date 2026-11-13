const test = require('node:test');
const assert = require('node:assert/strict');
const { createFarmOrchestrator } = require('../engine/farmOrchestrator.cjs');
const { createClickCoordinator } = require('../engine/clickCoordinator.cjs');
const { createAccountQueue } = require('../engine/accountQueue.cjs');

function harness(count, overrides = {}) {
  let time = 1000;
  let savedBudget = {};
  let savedFarm = {};
  const events = [];
  const accounts = Array.from({ length: count }, (_, index) => ({ id: `a${index}`, label: `Account ${index}` }));
  const calls = [];
  const coordinator = createClickCoordinator({ store: { load: async () => savedBudget, save: async (value) => { savedBudget = structuredClone(value); } }, now: () => time });
  const apiForAccount = (account) => ({
    snapshot: async () => ({ money: 0, casesTotal: 0, cases: [], vaultCapacity: null, vaultMoneyPerMinute: null, vaultLastCollected: null }),
    generate: async (clicks) => { calls.push({ id: account.id, kind: 'case', clicks, at: time }); return { ok: true, status: 200, awardedCount: 1 }; },
    clickMoney: async (clicks) => { calls.push({ id: account.id, kind: 'money', clicks, at: time }); return { ok: true, status: 200 }; },
    vaultSnapshot: async () => ({ money: 0, vaultCapacity: null, vaultMoneyPerMinute: null, vaultLastCollected: null, serverNow: null }),
    collectVault: async () => ({ ok: true, status: 200 }),
  });
  const options = {
    accounts, apiForAccount: (account) => options.customApi ? options.customApi(account) : apiForAccount(account), coordinator, accountQueue: createAccountQueue(),
    snapshots: { read: (account, settings) => options.customSnapshots ? options.customSnapshots.read(account, settings) : apiForAccount(account).snapshot(), invalidate: (id) => options.customSnapshots?.invalidate(id) },
    stateStore: { load: async () => savedFarm, save: async (value) => { savedFarm = structuredClone(value); } },
    now: () => time, sleep: async (ms) => { time += ms; options.onSleep?.(time); await Promise.resolve(); },
    emit: (event) => { events.push(event); options.onEvent?.(event); },
    maxInFlight: 1,
    ...overrides,
  };
  const farm = createFarmOrchestrator(options);
  return { farm, accounts, calls, events, coordinator, options, get time() { return time; }, get savedFarm() { return savedFarm; }, setTime(value) { time = value; } };
}

test('a configured proxy farm cannot start a direct burst when every proxy failed validation', async () => {
  const h = harness(51, { accountClickLimits: true, networkStatus: () => ({ configured: true, connections: 1, unavailableProxies: 8 }) });
  h.options.onEvent = event => { if (event.type === 'request') h.farm.stop(); };
  h.options.onSleep = time => { if (time > 10000) h.farm.stop(); };
  await h.farm.ready();
  assert.throws(() => h.farm.start(h.accounts.map(account => account.id)), /Nenhum proxy configurado está disponível/);
  assert.equal(h.calls.length, 0);
  assert.equal(h.events.some(event => event.type === 'farm-started'), false);
  assert.equal(h.farm.status().phase, 'idle');
});

test('case lots use each account percentage and leave incomplete-case clicks unspent', async () => {
  const percentages = [14.15, 22.15, 33.34, 33.33];
  const h = harness(4, { accountClickLimits: true, alignCaseClicks: true });
  h.options.customSnapshots = { read: async account => ({ money: 0, cases: [], casesTotal: 0, casesPerClick: percentages[Number(account.id.slice(1))] }), invalidate: () => {} };
  for (const account of h.accounts) await h.farm.setModes(account.id, { case: true, money: true, vault: false });
  h.options.onEvent = event => { if (event.type === 'request' && h.calls.length >= 8) h.farm.stop(); };
  await h.farm.start(h.accounts.map(account => account.id));
  assert.deepEqual(h.calls.filter(row => row.kind === 'case').map(row => row.clicks), [944, 950, 948, 948]);
  assert.equal(h.calls.filter(row => row.kind === 'money').every(row => row.clicks === 950), true);
  assert.deepEqual(h.farm.status().accounts.map(row => row.clicksPerCase), [8, 5, 3, 4]);
});

test('a case budget smaller than one whole case waits without consuming it or spinning', async () => {
  const h = harness(1, { accountClickLimits: true, alignCaseClicks: true });
  h.options.customSnapshots = { read: async () => ({ money: 0, cases: [], casesTotal: 0, casesPerClick: 14.15 }), invalidate: () => {} };
  await h.farm.setModes('a0', { case: true, money: true, vault: false });
  h.options.onSleep = time => { if (time > 2000) h.farm.stop(); };
  await h.farm.start(['a0']);
  assert.deepEqual(h.calls.map(row => row.clicks), [944, 950]);
  assert.equal((await h.coordinator.status('a0')).caseUsed, 944);
  assert.equal(h.farm.status().clicksAvailable, 0);
  assert.equal(h.farm.status().accounts[0].budget.waitUntil, 311000);
});

test('missing case percentage pauses only that account without guessing a click count', async () => {
  const h = harness(2, { accountClickLimits: true, alignCaseClicks: true });
  h.options.customSnapshots = { read: async account => ({ money: 0, cases: [], casesTotal: 0, casesPerClick: account.id === 'a0' ? null : 33.34 }), invalidate: () => {} };
  for (const account of h.accounts) await h.farm.setModes(account.id, { case: true, money: false, vault: false });
  h.options.onEvent = event => { if (event.type === 'request') h.farm.stop(); };
  h.options.onSleep = time => { if (time > 10000) h.farm.stop(); };
  await h.farm.start(['a0','a1']);
  assert.deepEqual(h.calls.map(row => row.id), ['a1']);
  assert.equal(h.farm.status().accounts[0].paused, true);
});

test('51 accounts keep their own case quantities when some accounts are limited', async () => {
  const h = harness(51, { accountClickLimits: true, alignCaseClicks: true });
  const percentages = [14.15, 22.15, 33.34];
  const posts = [];
  h.options.customSnapshots = { read: async account => ({ money:0, cases:[], casesTotal:0, casesPerClick:percentages[Number(account.id.slice(1)) % 3] }), invalidate: () => {} };
  h.options.customApi = account => ({ generate: async clicks => {
    posts.push({ id:account.id, clicks, at:h.time });
    return Number(account.id.slice(1)) < 10 ? { ok:false, status:429, retryAfter:'60' } : { ok:true, status:200 };
  } });
  for (const account of h.accounts) await h.farm.setModes(account.id, { case:true, money:false, vault:false });
  h.options.onEvent = event => { if (event.type === 'request' && posts.length === 51) h.farm.stop(); };
  await h.farm.start(h.accounts.map(account => account.id));
  assert.equal(new Set(posts.map(row => row.id)).size, 51);
  assert.ok(posts.every(row => row.clicks % Math.ceil(100 / percentages[Number(row.id.slice(1)) % 3]) === 0));
  assert.ok(posts[50].at - posts[0].at < 60000);
  assert.equal(await h.coordinator.cooldown(), 0);
});

test('an updated server percentage changes the next case lot', async () => {
  const h = harness(1, { accountClickLimits:true, alignCaseClicks:true });
  const quantities = [];
  let percentage = 33.34;
  h.options.customSnapshots = { read: async () => ({ money:0, cases:[], casesTotal:0, casesPerClick:percentage }), invalidate: () => {} };
  h.options.customApi = () => ({ generate: async clicks => { quantities.push(clicks); percentage=14.15; return { ok:true, status:200, casesPerClick:percentage }; } });
  await h.farm.setModes('a0', { case:true, money:false, vault:false });
  h.options.onEvent = event => { if (event.type === 'request' && quantities.length === 2) h.farm.stop(); };
  await h.farm.start(['a0']);
  assert.deepEqual(quantities, [999,1000]);
  assert.equal(h.farm.status().accounts[0].clicksPerCase, 8);
});

test('case lots preserve the site 120ms per-click pace independently for every account', async () => {
  const h = harness(2, { accountClickLimits:true, alignCaseClicks:true });
  h.options.customSnapshots = {read:async()=>({money:0,cases:[],casesTotal:0,casesPerClick:33.34}),invalidate:()=>{}};
  for (const account of h.accounts) await h.farm.setModes(account.id,{case:true,money:false,vault:false});
  h.options.onEvent = event => { if (event.type==='request' && h.calls.length===4) h.farm.stop(); };
  await h.farm.start(['a0','a1']);
  for (const id of ['a0','a1']) {
    const own = h.calls.filter(row=>row.id===id);
    assert.ok(own[1].at-own[0].at >= own[0].clicks*120);
  }
  assert.ok(h.calls[1].at-h.calls[0].at < 1000,'another account does not wait for the first account pace');
  const next = createFarmOrchestrator({...h.options,emit:()=>{}});
  await next.ready();
  assert.equal(next.status().accounts[0].caseNextAt,h.farm.status().accounts[0].caseNextAt);
  assert.ok(next.status().accounts[0].caseNextAt>h.time,'restart preserves the next account dispatch deadline');
});

test('steady case farming uses small complete-case lots for all 51 accounts', async () => {
  const percentages = [33.34,22.15,14.15,2.65];
  const expectedLots = [75,75,72,76];
  const h = harness(51, {accountClickLimits:true,alignCaseClicks:true,steadyCaseClicks:true,smoothClicks:true,maxInFlight:8});
  h.options.customSnapshots = {read:async account=>({money:0,cases:[],casesTotal:0,casesPerClick:percentages[Number(account.id.slice(1))%4]}),invalidate:()=>{}};
  for (const account of h.accounts) await h.farm.setModes(account.id,{case:true,money:false,vault:false});
  h.options.onEvent = event => { if (event.type==='request' && new Set(h.calls.map(row=>row.id)).size===51) h.farm.stop(); };
  await h.farm.start(h.accounts.map(account=>account.id));
  assert.equal(new Set(h.calls.map(row=>row.id)).size,51);
  assert.ok(h.calls.every(row=>row.clicks===expectedLots[Number(row.id.slice(1))%4]));
  assert.equal(h.farm.status().accounts[0].caseLotClicks,75);
  assert.equal(h.farm.status().accounts[0].caseLotIntervalMs,9688);
});

test('small case lots keep a continuous account pace across its quota window rollover', async () => {
  const h = harness(1,{accountClickLimits:true,alignCaseClicks:true,steadyCaseClicks:true});
  h.options.customSnapshots = {read:async()=>({money:0,cases:[],casesTotal:0,casesPerClick:33.34}),invalidate:()=>{}};
  await h.farm.setModes('a0',{case:true,money:false,vault:false});
  h.options.onEvent = event => { if (event.type==='request' && h.calls.length===34) h.farm.stop(); };
  await h.farm.start(['a0']);
  assert.ok(h.calls.every(row=>row.clicks===75));
  for (let i=1;i<h.calls.length;i++) {
    const gap=h.calls[i].at-h.calls[i-1].at;
    assert.ok(gap>=Math.ceil(310000*75/2400));
    assert.ok(gap<=11000,'a new quota window does not introduce a burst or a long stop');
  }
});
test('steady farming wakes at the account deadline without rounding it to another whole second',async()=>{
 const h=harness(1,{accountClickLimits:true,alignCaseClicks:true,steadyCaseClicks:true});
 h.options.customSnapshots={read:async()=>({money:0,cases:[],casesTotal:0,casesPerClick:33.34}),invalidate:()=>{}};
 await h.farm.setModes('a0',{case:true,money:false,vault:false});
 h.options.onEvent=e=>{if(e.type==='request'&&h.calls.length===2)h.farm.stop();};
 await h.farm.start(['a0']);assert.equal(h.calls[1].at-h.calls[0].at,9688);
});

test('a pending account request cannot hide the next ready account deadline in a free worker slot',async()=>{
 let releaseSlow;const slow=new Promise(resolve=>{releaseSlow=resolve;});const sleepers=[];
 const h=harness(2,{accountClickLimits:true,alignCaseClicks:true,steadyCaseClicks:true,maxInFlight:8,
  sleep:ms=>new Promise(resolve=>sleepers.push({ms,resolve}))});
 h.options.customSnapshots={read:async()=>({money:0,cases:[],casesTotal:0,casesPerClick:33.34}),invalidate:()=>{}};
 h.options.customApi=account=>({generate:async clicks=>{
  h.calls.push({id:account.id,clicks,at:h.time});
  if(account.id==='a0')await slow;
  return {ok:true,status:200};
 }});
 for(const account of h.accounts)await h.farm.setModes(account.id,{case:true,money:false,vault:false});
 const run=h.farm.start(['a0','a1']);
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 try{
  await flush();
  // Release only pacing/idle timers; the first account's accepted request stays pending.
  for(let step=0;step<30&&h.calls.filter(row=>row.id==='a1').length<2;step++){
   const waiter=sleepers.shift();if(!waiter)break;
   h.setTime(h.time+waiter.ms);waiter.resolve();await flush();
  }
  const fast=h.calls.filter(row=>row.id==='a1');
  assert.equal(fast.length,2,'the free slot must wake while the slow request remains pending');
  assert.equal(fast[1].at-fast[0].at,9688);
  assert.equal(h.calls.filter(row=>row.id==='a0').length,1,'an uncertain accepted request is never replayed');
 }finally{
  h.farm.stop();releaseSlow();for(const waiter of sleepers)waiter.resolve();await run;
 }
});

test('51-account steady farming continues new lots on 44 accounts while seven requests remain pending',async()=>{
 let releaseSlow;const slow=new Promise(resolve=>{releaseSlow=resolve;});const sleepers=[];
 const h=harness(51,{accountClickLimits:true,alignCaseClicks:true,steadyCaseClicks:true,smoothClicks:true,maxInFlight:8,
  sleep:ms=>new Promise(resolve=>sleepers.push({ms,resolve}))});
 h.options.customSnapshots={read:async()=>({money:0,cases:[],casesTotal:0,casesPerClick:33.34}),invalidate:()=>{}};
 h.options.customApi=account=>({generate:async clicks=>{
  h.calls.push({id:account.id,clicks,at:h.time});
  if(Number(account.id.slice(1))<7)await slow;
  return {ok:true,status:200};
 }});
 for(const account of h.accounts)await h.farm.setModes(account.id,{case:true,money:false,vault:false});
 const run=h.farm.start(h.accounts.map(a=>a.id));const flush=()=>new Promise(resolve=>setImmediate(resolve));
 const healthy=h.accounts.slice(7);const completed=()=>healthy.every(a=>h.calls.filter(c=>c.id===a.id).length>=2);
 try{
  await flush();
  for(let step=0;step<200&&!completed();step++){
   const waiter=sleepers.shift();if(!waiter)break;
   h.setTime(h.time+waiter.ms);waiter.resolve();await flush();
  }
  assert.ok(completed(),'all 44 healthy accounts must reach a second lot before any slow request returns');
  for(const account of healthy){const own=h.calls.filter(c=>c.id===account.id);assert.ok(own[1].at-own[0].at>=9688);}
  for(const account of h.accounts.slice(0,7))assert.equal(h.calls.filter(c=>c.id===account.id).length,1);
  assert.equal(h.farm.status().pace.clickIntervalMs,150);
 }finally{h.farm.stop();releaseSlow();for(const waiter of sleepers)waiter.resolve();await run;}
});

test('a boosted percentage above 100 uses one click per case instead of pausing the account', async () => {
  const h = harness(1,{accountClickLimits:true,alignCaseClicks:true,steadyCaseClicks:true});
  h.options.customSnapshots = {read:async()=>({money:0,cases:[],casesTotal:0,casesPerClick:105}),invalidate:()=>{}};
  await h.farm.setModes('a0',{case:true,money:false,vault:false});
  h.options.onEvent = event => {if(event.type==='request')h.farm.stop();};
  await h.farm.start(['a0']);
  assert.equal(h.farm.status().accounts[0].clicksPerCase,1);
  assert.deepEqual(h.calls.map(row=>row.clicks),[77]);
});

test('distributed pacing spreads 51 account lots across the budget window without lowering their batch size', async () => {
  const h = harness(51, { accountClickLimits: true, smoothClicks: true });
  h.options.onSleep = time => { if (time > 620000) h.farm.stop(); };
  for (const account of h.accounts) await h.farm.setModes(account.id, { case: true, money: true, vault: false });
  h.options.onEvent = event => { if (event.type === 'request' && h.calls.length === 102) h.farm.stop(); };
  await h.farm.start(h.accounts.map(account => account.id));
  assert.equal(h.calls.length, 102);
  assert.equal(new Set(h.calls.map(row => row.id)).size, 51);
  assert.equal(h.calls.every(row => row.clicks === 950), true);
  assert.ok(h.calls[101].at - h.calls[0].at >= 300000, 'full quotas are distributed over five minutes');
  assert.ok(h.calls[101].at - h.calls[0].at < 315000, 'pacing still uses the per-account capacity');
  assert.ok(h.calls.slice(1).every((row, index) => row.at - h.calls[index].at >= 3000));
});

test('a routed read limit pauses its route group while another route farms at the original pace', async () => {
  const h = harness(3, { accountClickLimits: true, limitGroup: async (until, id) => h.coordinator.limitAccounts(until, id === 'a0' ? ['a0', 'a1'] : [id]) });
  h.options.onSleep = time => { if (time > 62000) h.farm.stop(); };
  h.options.customSnapshots = { read: async account => {
    if (account.id === 'a0') throw Object.assign(Error('Too Many Requests'), { status: 429, retryAfter: '60' });
    return { money: 0, casesTotal: 0, cases: [] };
  } };
  for (const account of h.accounts) await h.farm.setModes(account.id, { case: true, money: false, vault: false });
  h.options.onEvent = event => { if (event.type === 'request') h.farm.stop(); };
  await h.farm.start(h.accounts.map(account => account.id));
  assert.ok(h.calls.length > 0 && h.calls.every(row => row.id === 'a2'));
  assert.ok(h.calls[0].at < 61000, 'another route proceeds before the refused route deadline');
  assert.equal(await h.coordinator.cooldown(), 0);
  assert.ok(await h.coordinator.cooldown('a1') > h.time);
  assert.equal(h.farm.status().pace.clickIntervalMs, 150);
});

test('account click limits keep two blocked accounts waiting while a third account farms immediately',async()=>{
  const h=harness(3,{accountClickLimits:true,verifyAccountLimits:true});const posts=[];
  h.options.customApi=account=>({generate:async clicks=>{posts.push({id:account.id,clicks,at:h.time});return account.id==='a2'?{ok:true,status:200}:{ok:false,status:429,retryAfter:'60'};}});
  for(const account of h.accounts)await h.farm.setModes(account.id,{case:true,money:false,vault:false});
  h.options.onEvent=event=>{if(event.type==='request'&&posts.length===3)h.farm.stop();};
  await h.farm.start(h.accounts.map(account=>account.id));
  assert.deepEqual(posts.map(post=>post.id),['a0','a1','a2']);
  assert.ok(posts[2].at<posts[0].at+60000);
  assert.equal(await h.coordinator.cooldown(),0);
  for(const id of ['a0','a1'])assert.ok(await h.coordinator.cooldown(id)>h.time);
  assert.equal(h.farm.status().limitCheck,null);
  assert.deepEqual(h.farm.status().pace,{clickIntervalMs:150,vaultIntervalMs:2000});
});

test('several account click limits never slow dispatch to healthy accounts',async()=>{
  const h=harness(5,{accountClickLimits:true});const posts=[];
  h.options.customApi=account=>({generate:async clicks=>{posts.push({id:account.id,clicks,at:h.time});return account.id==='a4'?{ok:true,status:200}:{ok:false,status:429,retryAfter:'60'};}});
  for(const account of h.accounts)await h.farm.setModes(account.id,{case:true,money:false,vault:false});
  h.options.onEvent=event=>{if(event.type==='request'&&posts.length===5)h.farm.stop();};
  await h.farm.start(h.accounts.map(account=>account.id));
  assert.deepEqual(posts.map(post=>post.id),['a0','a1','a2','a3','a4']);
  for(let index=1;index<posts.length;index++)assert.equal(posts[index].at-posts[index-1].at,150);
  assert.ok(posts[4].at<posts[0].at+60000);
  assert.equal(await h.coordinator.cooldown(),0);
  assert.equal(h.farm.status().pace.vaultIntervalMs,2000);
  assert.equal(h.farm.status().pace.clickIntervalMs,150);
});

test('45 limited accounts leave six healthy accounts running at the same pace across a 51-account queue',async()=>{
  const h=harness(51,{accountClickLimits:true});const posts=[];
  h.options.customApi=account=>({generate:async clicks=>{posts.push({id:account.id,clicks,at:h.time});return Number(account.id.slice(1))<45?{ok:false,status:429,retryAfter:'60'}:{ok:true,status:200};}});
  for(const account of h.accounts)await h.farm.setModes(account.id,{case:true,money:false,vault:false});
  h.options.onEvent=event=>{if(event.type==='request'&&posts.length===51)h.farm.stop();};
  await h.farm.start(h.accounts.map(account=>account.id));
  assert.equal(new Set(posts.map(post=>post.id)).size,51);
  for(let index=1;index<posts.length;index++)assert.equal(posts[index].at-posts[index-1].at,150);
  assert.equal(posts[50].at-posts[0].at,7500);
  assert.equal(h.farm.status().pace.clickIntervalMs,150);assert.equal(await h.coordinator.cooldown(),0);
});

test('account click policy still suspends all accounts on a limited read',async()=>{
  const h=harness(3,{accountClickLimits:true});const posts=[];
  h.options.customSnapshots={read:async()=>{throw Object.assign(Error('read limited'),{status:429,retryAfter:'60'});},invalidate(){}};
  h.options.customApi=account=>({generate:async clicks=>{posts.push(account.id);return {ok:true,status:200};}});
  for(const account of h.accounts)await h.farm.setModes(account.id,{case:true,money:false,vault:false});
  h.options.onEvent=event=>{if(event.type==='cooldown')h.farm.stop();};
  await h.farm.start(h.accounts.map(account=>account.id));
  assert.deepEqual(posts,[]);assert.ok(await h.coordinator.cooldown()>h.time);
});

test('upgrading the account click policy resets obsolete pacing once and preserves account budgets',async()=>{
  const h=harness(1,{accountClickLimits:true,stateStore:{load:async()=>({pace:{clickIntervalMs:8000,vaultIntervalMs:15000}}),save:async()=>{}}});
  await h.coordinator.reserve('money',950,()=>true,'a0');await h.farm.ready();
  assert.deepEqual(h.farm.status().pace,{clickIntervalMs:150,vaultIntervalMs:2000});
  assert.equal((await h.coordinator.status('a0')).moneyUsed,950);
  const resumed=harness(1,{accountClickLimits:true,stateStore:{load:async()=>({pace:{clickIntervalMs:4000,vaultIntervalMs:8000,limitPolicy:'account-clicks-v1'}}),save:async()=>{}}});
  await resumed.farm.ready();assert.deepEqual(resumed.farm.status().pace,{clickIntervalMs:4000,vaultIntervalMs:8000});
});

test('reopening removes the old account burst penalty while preserving deadlines and accepted work',async()=>{
  const h=harness(1,{accountClickLimits:true,stateStore:{load:async()=>({pace:{clickIntervalMs:8000,vaultIntervalMs:1458,limitPolicy:'account-clicks-v1',clickBurstGuarded:true}}),save:async()=>{}}});
  await h.coordinator.reserve('money',950,()=>true,'a0');await h.coordinator.limit(61000,'a0');await h.farm.ready();
  assert.deepEqual(h.farm.status().pace,{clickIntervalMs:150,vaultIntervalMs:1458});
  assert.equal((await h.coordinator.status('a0')).moneyUsed,950);assert.equal(await h.coordinator.cooldown('a0'),61000);
});

test('explicitly rejected account clicks preserve accepted budget and retry the same mode at the server deadline',async()=>{
  const h=harness(1,{accountClickLimits:true});const posts=[];let cases=0;
  h.options.customSnapshots={read:async()=>({money:0,casesTotal:cases,cases:[]}),invalidate(){}};
  h.options.customApi=()=>({generate:async clicks=>{posts.push({kind:'case',clicks,at:h.time});if(posts.length===1)return {ok:false,status:429,retryAfter:'2'};cases+=clicks;return {ok:true,status:200};},clickMoney:async clicks=>{posts.push({kind:'money',clicks,at:h.time});return {ok:true,status:200};}});
  await h.coordinator.reserve('money',950,()=>true,'a0');
  await h.farm.setModes('a0',{case:true,money:true,vault:false});
  h.options.onEvent=event=>{if(event.type==='request'&&posts.length===2)h.farm.stop();};
  await h.farm.start(['a0']);
  assert.deepEqual(posts.map(post=>[post.kind,post.clicks]),[['case',950],['case',950]]);
  assert.equal(posts[1].at,posts[0].at+2000);
  const budget=await h.coordinator.status('a0');assert.equal(budget.caseUsed,950);assert.equal(budget.moneyUsed,950);assert.equal(budget.combinedUsed,1900);
  assert.equal(h.farm.status().accounts[0].results.case,950);
});

test('accepted clicks with a failed confirmation keep their reservation and are never replayed',async()=>{
  const h=harness(1,{accountClickLimits:true});let reads=0;
  h.options.customSnapshots={read:async()=>{if(++reads===2)throw Error('confirmation unavailable');return {money:0,casesTotal:0};},invalidate(){}};
  await h.farm.setModes('a0',{case:true,money:false,vault:false});
  h.options.onEvent=event=>{if(event.type==='request')h.farm.stop();};
  await h.farm.start(['a0']);
  assert.equal(h.calls.length,1);assert.equal((await h.coordinator.status('a0')).caseUsed,1000);
  assert.equal(h.farm.status().accounts[0].results.unconfirmedRequests,1);
});

test('a network failure keeps an ambiguous click reservation until its normal expiry',async()=>{
  const h=harness(1,{accountClickLimits:true});let posts=0;
  h.options.customApi=()=>({generate:async()=>{posts++;throw Error('connection lost after send');}});
  await h.farm.setModes('a0',{case:true,money:false,vault:false});
  h.options.onEvent=event=>{if(event.type==='account-error')h.farm.stop();};
  await h.farm.start(['a0']);
  assert.equal(posts,1);assert.equal((await h.coordinator.status('a0')).caseUsed,1000);
});

test('stopping after a refusal keeps the server hold and persists the returned budget for restart',async()=>{
  const h=harness(1,{accountClickLimits:true});
  h.options.customApi=()=>({generate:async()=>({ok:false,status:429,retryAfter:'60'})});
  await h.farm.setModes('a0',{case:true,money:true,vault:false});
  h.options.onEvent=event=>{if(event.type==='cooldown')h.farm.stop();};
  await h.farm.start(['a0']);
  assert.equal(await h.coordinator.cooldown('a0'),61000);assert.equal((await h.coordinator.status('a0')).caseUsed,0);
  assert.equal(h.savedFarm.accounts.a0.nextClickMode,'case');assert.equal(h.savedFarm.pace.limitPolicy,'isolated-clicks-v2');
});

test('isolation retains the fast pace after restart and backs off only on a shared read limit',async()=>{
  const h=harness(1,{accountClickLimits:true,stateStore:{load:async()=>({pace:{clickIntervalMs:1000,vaultIntervalMs:4000,limitPolicy:'isolated-clicks-v2'}}),save:async()=>{}}});
  await h.farm.ready();assert.deepEqual(h.farm.status().pace,{clickIntervalMs:1000,vaultIntervalMs:4000});
  h.options.customSnapshots={read:async()=>{throw Object.assign(Error('read limited'),{status:429,retryAfter:'60'});},invalidate(){}};
  await h.farm.setModes('a0',{case:true,money:false,vault:false});
  h.options.onEvent=event=>{if(event.type==='cooldown')h.farm.stop();};
  await h.farm.start(['a0']);
  assert.equal(await h.coordinator.cooldown(),61000);assert.deepEqual(h.farm.status().pace,{clickIntervalMs:2000,vaultIntervalMs:8000});
});

test('a click 429 checks one equally-sized lot on another account, then continues on accepted scope',async()=>{
  const h=harness(3,{verifyAccountLimits:true});const posts=[];
  h.options.customApi=account=>({generate:async clicks=>{posts.push({id:account.id,clicks,at:h.time});return account.id==='a0'?{ok:false,status:429,retryAfter:'60'}:{ok:true,status:200};}});
  for(const account of h.accounts)await h.farm.setModes(account.id,{case:true,money:false,vault:false});
  h.options.onEvent=event=>{if(event.type==='request'&&posts.length===3)h.farm.stop();};
  await h.farm.start(h.accounts.map(account=>account.id));
  assert.deepEqual(posts.map(post=>post.id),['a0','a1','a2']);
  assert.equal(posts[1].clicks,posts[0].clicks);
  assert.ok(posts[2].at<posts[0].at+60000,'unlimited accounts do not wait for the blocked account');
  assert.equal(await h.coordinator.cooldown(),0);
  assert.ok(await h.coordinator.cooldown('a0')>h.time);
  assert.ok(h.events.some(event=>event.type==='cooldown'&&event.scope==='account'&&event.verifiedScope));
});

test('two accounts refusing the verification lot restore a shared pause before a third account reads',async()=>{
  const h=harness(3,{verifyAccountLimits:true});const posts=[],reads=[];
  h.options.customSnapshots={read:async account=>{reads.push(account.id);return {money:0,casesTotal:0};},invalidate(){}};
  h.options.customApi=account=>({generate:async clicks=>{posts.push({id:account.id,clicks,at:h.time});return {ok:false,status:429,retryAfter:'60'};}});
  for(const account of h.accounts)await h.farm.setModes(account.id,{case:true,money:false,vault:false});
  h.options.onEvent=event=>{if(event.type==='request'&&posts.length===2)h.farm.stop();};
  await h.farm.start(h.accounts.map(account=>account.id));
  assert.deepEqual(posts.map(post=>post.id),['a0','a1']);
  assert.deepEqual(reads,['a0','a1']);
  assert.ok(await h.coordinator.cooldown()>h.time);
  assert.equal(h.farm.status().limitCheck,null);
});

test('scope verification never uses a smaller lot that could falsely suggest separate click quotas',async()=>{
  const h=harness(2,{verifyAccountLimits:true});const posts=[];
  h.options.customApi=account=>({generate:async clicks=>{posts.push({id:account.id,clicks});return {ok:false,status:429,retryAfter:'60'};}});
  for(const account of h.accounts)await h.farm.setModes(account.id,{case:true,money:false,vault:false});
  await h.coordinator.reserve('case',1000,()=>true,'a1');await h.coordinator.reserve('case',1000,()=>true,'a1');
  h.options.onEvent=event=>{if(event.type==='request')h.farm.stop();};
  await h.farm.start(h.accounts.map(account=>account.id));
  assert.deepEqual(posts,[{id:'a0',clicks:1000}]);
  assert.ok(await h.coordinator.cooldown()>h.time);
});

test('mode changes during verification cannot send a smaller lot or spend its reservation',async()=>{
  const h=harness(2,{verifyAccountLimits:true});const posts=[];
  h.options.customSnapshots={read:async account=>{if(account.id==='a1')await h.farm.setModes('a1',{case:true,money:true,vault:false});return {money:0,casesTotal:0};},invalidate(){}};
  h.options.customApi=account=>({generate:async clicks=>{posts.push({id:account.id,clicks});return {ok:false,status:429,retryAfter:'60'};}});
  for(const account of h.accounts)await h.farm.setModes(account.id,{case:true,money:false,vault:false});
  h.options.onEvent=event=>{if(event.type==='cooldown'&&event.scope==='global')h.farm.stop();};
  await h.farm.start(['a0','a1']);
  assert.deepEqual(posts,[{id:'a0',clicks:1000}]);
  assert.equal((await h.coordinator.status('a1')).caseUsed,0);
});

test('a verification read limit immediately restores a shared pause without another mutation',async()=>{
  const h=harness(2,{verifyAccountLimits:true});const posts=[];
  h.options.customSnapshots={read:async account=>{if(account.id==='a1')throw Object.assign(Error('limited'),{status:429,retryAfter:'120'});return {money:0,casesTotal:0};},invalidate(){}};
  h.options.customApi=account=>({generate:async clicks=>{posts.push({id:account.id,clicks});return {ok:false,status:429,retryAfter:'60'};}});
  for(const account of h.accounts)await h.farm.setModes(account.id,{case:true,money:false,vault:false});
  h.options.onEvent=event=>{if(event.type==='cooldown'&&event.stage==='read')h.farm.stop();};
  await h.farm.start(['a0','a1']);
  assert.equal(posts.length,1);assert.ok(await h.coordinator.cooldown()>=h.time+120000);
});

test('a successful verification mutation is never replayed after a failed confirmation read',async()=>{
  const h=harness(2,{verifyAccountLimits:true});const posts=[];let reads=0;
  h.options.customSnapshots={read:async account=>{if(account.id==='a1'&&++reads===2)throw Error('offline');return {money:0,casesTotal:0};},invalidate(){}};
  h.options.customApi=account=>({generate:async clicks=>{posts.push({id:account.id,clicks});return account.id==='a0'?{ok:false,status:429,retryAfter:'60'}:{ok:true,status:200};}});
  for(const account of h.accounts)await h.farm.setModes(account.id,{case:true,money:false,vault:false});
  h.options.onEvent=event=>{if(event.type==='request'&&posts.length===2)h.farm.stop();};
  await h.farm.start(['a0','a1']);
  assert.equal(posts.length,2);assert.equal(h.farm.status().accounts[1].results.unconfirmedRequests,1);
  assert.equal(h.farm.status().limitCheck,null);
});

test('a restart during an inconclusive scope check retains the shared pause and sends no probe',async()=>{
  const h=harness(2,{verifyAccountLimits:true,stateStore:{load:async()=>({scopeCheck:{until:61000}}),save:async()=>{}},sleep:async()=>{h.farm.stop();}});
  await h.farm.ready();await h.farm.start(['a0','a1']);
  assert.equal(h.calls.length,0);assert.equal(await h.coordinator.cooldown(),61000);
});

test('stop immediately after an account limit sends no verification request',async()=>{
  const h=harness(3,{verifyAccountLimits:true});const posts=[];
  h.options.customApi=account=>({generate:async clicks=>{posts.push({id:account.id,clicks});return {ok:false,status:429,retryAfter:'60'};}});
  for(const account of h.accounts)await h.farm.setModes(account.id,{case:true,money:false,vault:false});
  h.options.onEvent=event=>{if(event.type==='cooldown')h.farm.stop();};
  await h.farm.start(['a0','a1','a2']);
  assert.equal(posts.length,1);assert.ok(await h.coordinator.cooldown()>h.time);
});

test('a vault waiting at its final cooldown check yields when scope verification starts',async()=>{
  const h=harness(3,{verifyAccountLimits:true,maxInFlight:4});let releaseVault,enteredVault,vaultChecks=0,vaultPosts=0;
  const entered=new Promise(resolve=>{enteredVault=resolve;}),gate=new Promise(resolve=>{releaseVault=resolve;});
  const cooldown=h.coordinator.cooldown.bind(h.coordinator);
  h.coordinator.cooldown=async id=>{if(id==='a0'&&++vaultChecks===2){enteredVault();await gate;}return cooldown(id);};
  h.options.customApi=account=>account.id==='a0'?{vaultSnapshot:async()=>({money:0,vaultCapacity:100,vaultMoneyPerMinute:1,vaultLastCollected:new Date(h.time-6000000).toISOString(),serverNow:new Date(h.time).toISOString()}),collectVault:async()=>{vaultPosts++;return {ok:true,status:200};}}:{generate:async()=>{if(account.id==='a1'){await entered;return {ok:false,status:429,retryAfter:'600'};}return {ok:true,status:200};}};
  await h.farm.setModes('a0',{case:false,money:false,vault:true});
  for(const id of ['a1','a2'])await h.farm.setModes(id,{case:true,money:false,vault:false});
  h.options.onEvent=event=>{if(event.type==='cooldown'&&event.scope==='account'&&!event.verifiedScope)releaseVault();if(event.type==='request'&&event.accountId==='a2')h.farm.stop();};
  await h.farm.start(['a0','a1','a2']);
  assert.equal(vaultPosts,0);
});

test('an inconclusive verification slows shared traffic once before resuming',async()=>{
  const h=harness(2,{verifyAccountLimits:true});
  h.options.customApi=account=>({generate:async()=>{if(account.id==='a1')throw Error('offline');return {ok:false,status:429,retryAfter:'60'};}});
  for(const account of h.accounts)await h.farm.setModes(account.id,{case:true,money:false,vault:false});
  h.options.onEvent=event=>{if(event.type==='cooldown'&&event.scope==='global')h.farm.stop();};
  await h.farm.start(['a0','a1']);
  assert.deepEqual(h.farm.status().pace,{clickIntervalMs:1000,vaultIntervalMs:4000});
  assert.deepEqual(h.savedFarm.pace,h.farm.status().pace);assert.equal(h.savedFarm.scopeCheck,null);
});

test('a hundred case accounts receive one turn each before a repeat', async () => {
  const h = harness(100);
  for (const account of h.accounts) await h.farm.setModes(account.id, { case: true, money: false, vault: false });
  h.options.onEvent = (event) => { if (event.type === 'request' && h.calls.length === 100) h.farm.stop(); };
  await h.farm.start(h.accounts.map((account) => account.id));
  assert.equal(h.calls.length, 100);
  assert.equal(new Set(h.calls.map((call) => call.id)).size, 100);
  assert.equal(h.savedFarm.cursor, 0);
});

test('removing an account clears its saved farm state', async () => {
  const h = harness(2);
  await h.farm.setModes('a0', {case:false,money:false,vault:false});
  await h.farm.syncAccounts([h.accounts[1]]);
  assert.deepEqual(h.farm.status().accounts.map((item) => item.id), ['a1']);
  assert.equal(Object.hasOwn(h.savedFarm.accounts, 'a0'), false);
});

test('case and money share the 1900-click window equally when both are enabled', async () => {
  const h = harness(1);
  await h.farm.setModes('a0', { case: true, money: true, vault: false });
  h.options.onEvent = (event) => { if (event.type === 'request' && h.calls.length === 2) h.farm.stop(); };
  await h.farm.start(['a0']);
  assert.deepEqual(h.calls.map((call) => [call.kind, call.clicks]).sort(), [['case', 950], ['money', 950]]);
  assert.equal((await h.coordinator.status('a0')).combinedUsed, 1900);
});

test('a case request without a server name uses a uniquely confirmed inventory increase', async () => {
  const h = harness(1);
  let amount = 4;
  h.options.customSnapshots = { read: async () => ({money:0,casesTotal:amount,cases:[{id:'gallery',name:'Gallery Case',amount}]}), invalidate: () => {} };
  h.options.customApi = () => ({ generate: async () => {amount += 316;return {ok:true,status:200,awardedCount:316};} });
  await h.farm.setModes('a0',{case:true,money:false,vault:false});
  h.options.onEvent = (event) => {if(event.type==='request')h.farm.stop();};
  await h.farm.start(['a0']);
  const request = h.events.find((event) => event.type==='request');
  assert.equal(request.caseId,'gallery');
  assert.equal(request.caseName,'Gallery Case');
});

test('stopping a queued account mutation sends no click request or reservation', async () => {
  const h = harness(1);
  await h.farm.setModes('a0', { case: true, money: false, vault: false });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const blocker = h.options.accountQueue.run('a0', () => gate);
  const running = h.farm.start(['a0']);
  await Promise.resolve();
  h.farm.stop();
  release();
  await blocker;
  await running;
  assert.equal(h.calls.length, 0);
  assert.equal((await h.coordinator.status()).caseUsed, 0);
});

test('stop during an asynchronous reservation sends nothing and spends no clicks', async () => {
  const h = harness(1);
  await h.farm.setModes('a0', {case:true,money:false,vault:false});
  const original = h.coordinator.reserve.bind(h.coordinator);
  let entered;
  const waiting = new Promise((resolve) => {entered=resolve;});
  let release;
  const gate = new Promise((resolve) => {release=resolve;});
  h.coordinator.reserve = async (...args) => {entered();await gate;return original(...args);};
  const running = h.farm.start(['a0']);
  await waiting;
  h.farm.stop();
  release();
  await running;
  assert.equal(h.calls.length,0);
  assert.equal((await h.coordinator.status()).caseUsed,0);
});

test('pause during an asynchronous cooldown check sends nothing', async () => {
  const h = harness(1);
  await h.farm.setModes('a0', {case:true,money:false,vault:false});
  const original = h.coordinator.cooldown.bind(h.coordinator);
  let entered;
  const waiting = new Promise((resolve) => {entered=resolve;});
  let release;
  const gate = new Promise((resolve) => {release=resolve;});
  h.coordinator.cooldown = async () => {entered();await gate;return original();};
  const running = h.farm.start(['a0']);
  await waiting;
  await h.farm.pause('a0');
  release();
  await running;
  assert.equal(h.calls.length,0);
  assert.equal((await h.coordinator.status()).caseUsed,0);
});

test('a 429 from one account delays the next account for Retry-After', async () => {
  const h = harness(2);
  h.options.customApi = (account) => ({
    snapshot: async () => ({ money: 0, casesTotal: 0 }),
    generate: async (clicks) => { h.calls.push({ id: account.id, kind: 'case', clicks, at: h.time }); return account.id === 'a0' ? { ok: false, status: 429, retryAfter: '4' } : { ok: true, status: 200, awardedCount: 1 }; },
  });
  for (const account of h.accounts) await h.farm.setModes(account.id, { case: true, money: false, vault: false });
  h.options.onEvent = (event) => { if (event.type === 'request' && h.calls.some((call) => call.id === 'a1')) h.farm.stop(); };
  await h.farm.start(h.accounts.map((account) => account.id));
  assert.equal(h.calls[0].id, 'a0');
  assert.equal(h.calls[1].id, 'a1');
  assert.ok(h.calls[1].at - h.calls[0].at >= 4000);
});

test('vault collection is confirmed once and does not trust the response amount', async () => {
  let money = 10;
  let last = '2026-10-09T09:00:00.000Z';
  const h = harness(1);
  h.setTime(Date.parse('2026-10-09T10:00:00.000Z'));
  h.options.customApi = () => ({
    vaultSnapshot: async () => ({ money, vaultCapacity: 100, vaultMoneyPerMinute: 10, vaultLastCollected: last, serverNow: new Date(h.time).toISOString() }),
    collectVault: async () => { money += 100; last = new Date(h.time).toISOString(); return { ok: true, status: 200, amount: 999999 }; },
  });
  await h.farm.setModes('a0', { case: false, money: false, vault: true });
  h.options.onEvent = (event) => { if (event.type === 'vault') h.farm.stop(); };
  await h.farm.start(['a0']);
  const vault = h.events.find((event) => event.type === 'vault');
  assert.equal(vault.confirmedDelta, 100);
  assert.equal(h.events.filter((event) => event.type === 'vault').length, 1);
});

test('accepted but unconfirmed vault collection is not posted again', async () => {
  let h;
  const start = Date.parse('2026-10-09T10:00:00.000Z');
  h = harness(1, {sleep: async (ms) => { h.setTime(h.time + ms); if (h.time >= start + 3000) h.farm.stop(); await Promise.resolve(); }});
  h.setTime(start);
  let posts = 0;
  h.options.customApi = () => ({
    vaultSnapshot: async () => ({ money: 10, vaultCapacity: 100, vaultMoneyPerMinute: 10, vaultLastCollected: '2026-10-09T09:00:00.000Z', serverNow: new Date(h.time).toISOString() }),
    collectVault: async () => { posts++; return {ok:true,status:200}; },
  });
  await h.farm.setModes('a0', {case:false,money:false,vault:true});
  await h.farm.start(['a0']);
  assert.equal(posts,1);
  assert.equal(h.savedFarm.accounts.a0.pendingVaultCollectedAt,'2026-10-09T09:00:00.000Z');
});

test('an expired session disables only its account', async () => {
  const h = harness(2);
  h.options.customApi = (account) => ({
    snapshot: async () => ({ money: 0, casesTotal: 0 }),
    generate: async (clicks) => { h.calls.push({ id: account.id, clicks }); return account.id === 'a0' ? { ok: false, status: 401 } : { ok: true, status: 200 }; },
  });
  for (const account of h.accounts) await h.farm.setModes(account.id, { case: true, money: false, vault: false });
  h.options.onEvent = (event) => { if (event.type === 'request' && h.calls.length === 2) h.farm.stop(); };
  await h.farm.start(['a0', 'a1']);
  assert.equal(h.farm.status().accounts[0].needsLogin, true);
  assert.equal(h.farm.status().accounts[1].needsLogin, false);
  assert.equal(h.events.some((event) => event.type === 'needs-login' && event.accountId === 'a0'), true);
});

test('three network failures pause one account after 30s and 1m retries', async () => {
  const h = harness(1);
  h.options.customApi = () => ({
    snapshot: async () => ({ money: 0, casesTotal: 0 }),
    generate: async () => { h.calls.push({ at: h.time }); throw new Error('offline'); },
  });
  await h.farm.setModes('a0', { case: true, money: false, vault: false });
  await h.farm.start(['a0']);
  assert.deepEqual(h.calls.map((call) => call.at), [1000, 31000, 91000]);
  assert.equal(h.farm.status().accounts[0].paused, true);
  assert.equal(h.savedFarm.accounts.a0.paused, true);
});

test('a failed confirmation read leaves an accepted click unconfirmed', async () => {
  const h = harness(1);
  let reads = 0;
  h.options.customSnapshots = { read: async () => { reads++; if (reads === 2) throw new Error('read failed'); return { money: 10, casesTotal: 0 }; }, invalidate: () => {} };
  await h.farm.setModes('a0', { case: false, money: true, vault: false });
  h.options.onEvent = (event) => { if (event.type === 'request') h.farm.stop(); };
  await h.farm.start(['a0']);
  assert.equal(h.events.find((event) => event.type === 'request').httpStatus, 200);
  assert.equal(h.events.find((event) => event.type === 'request').verifiedDelta, null);
});

test('mode selections and scheduling cursor survive restart without running', async () => {
  const h = harness(2);
  for (const account of h.accounts) await h.farm.setModes(account.id, { case: true, money: false, vault: false });
  h.options.onEvent = (event) => { if (event.type === 'request') h.farm.stop(); };
  await h.farm.start(['a0', 'a1']);
  assert.equal(h.savedFarm.cursor, 1);
  const next = createFarmOrchestrator({ ...h.options, emit: () => {} });
  await next.ready();
  assert.equal(next.status().phase, 'idle');
  assert.deepEqual(next.status().accounts[0].modes, { case: true, money: false, vault: false });
});

test('the global in-flight cap applies across different accounts', async () => {
  let active = 0;
  let peak = 0;
  const releases = [];
  const unlimited = { status: async () => ({ caseUsed: 0, moneyUsed: 0, combinedUsed: 0, caseRemaining: 2400, moneyRemaining: 1900, combinedRemaining: 1900, cooldownUntil: 0, waitUntil: 0 }), reserve: async (_kind, clicks) => ({ clicks }), cooldown: async () => 0, activate: () => {}, deactivate: () => {} };
  const h = harness(6, { coordinator: unlimited, maxInFlight: 4 });
  h.options.customApi = () => ({
    snapshot: async () => ({ money: 0, casesTotal: 0 }),
    generate: async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => releases.push(resolve));
      active--;
      return { ok: true, status: 200 };
    },
  });
  for (const account of h.accounts) await h.farm.setModes(account.id, { case: true, money: false, vault: false });
  const running = h.farm.start(h.accounts.map((account) => account.id));
  for (let index = 0; index < 50 && releases.length < 4; index++) await new Promise(setImmediate);
  assert.equal(peak, 4);
  h.farm.stop();
  releases.forEach((release) => release());
  await running;
  assert.equal(peak, 4);
});

test('pausing a job behind a mutation prevents its request', async () => {
  const h = harness(1);
  await h.farm.setModes('a0', { case: true, money: false, vault: false });
  let release;
  const blocker = h.options.accountQueue.run('a0', () => new Promise((resolve) => { release = resolve; }));
  const running = h.farm.start(['a0']);
  for (let index = 0; index < 20 && !h.farm.status().accounts[0].inFlight; index++) await new Promise(setImmediate);
  await h.farm.pause('a0');
  release();
  await blocker;
  await running;
  assert.equal(h.calls.length, 0);
  assert.equal((await h.coordinator.status()).caseUsed, 0);
});

test('vault 401 requests login without treating it as a network retry', async () => {
  const h = harness(1);
  h.setTime(Date.parse('2026-10-09T10:00:00.000Z'));
  h.options.customApi = () => ({
    vaultSnapshot: async () => ({ money: 0, vaultCapacity: 100, vaultMoneyPerMinute: 10, vaultLastCollected: '2026-10-09T09:00:00.000Z', serverNow: new Date(h.time).toISOString() }),
    collectVault: async () => ({ ok: false, status: 401 }),
  });
  await h.farm.setModes('a0', { case: false, money: false, vault: true });
  await h.farm.start(['a0']);
  assert.equal(h.farm.status().accounts[0].needsLogin, true);
  assert.equal(h.events.some((event) => event.type === 'needs-login'), true);
  assert.equal(h.events.some((event) => event.type === 'account-error'), false);
});

test('network failures identify the operation, cause, retry and automatic suspension',async()=>{
 const h=harness(1);h.options.customApi=()=>({generate:async()=>{throw new Error('net::ERR_CONNECTION_RESET cookie=do-not-export');}});
 await h.farm.setModes('a0',{case:true,money:false,vault:false});await h.farm.start(['a0']);
 const errors=h.events.filter(e=>e.type==='account-error');
 assert.equal(errors[0].errorCode,'ERR_CONNECTION_RESET');assert.equal(errors[0].operation,'case');assert.equal(errors[0].stage,'request');assert.equal(errors[0].retryAt,31000);
 assert.equal(errors[2].paused,true);assert.equal(errors[2].retryAt,0);assert.match(errors[2].message,/3 falhas consecutivas/);assert.match(errors[2].message,/Retomar/);assert.equal(errors[2].message.includes('do-not-export'),false);
 assert.equal(h.events.find(e=>e.type==='farm-finished').reason,'accounts-unavailable');
});
test('a refused HTTP request keeps its status instead of becoming a generic network error',async()=>{
 const h=harness(1);h.options.customApi=()=>({clickMoney:async()=>({ok:false,status:503,message:'private server body'})});
 await h.farm.setModes('a0',{case:false,money:true,vault:false});await h.farm.start(['a0']);
 const error=h.events.find(e=>e.type==='account-error');assert.equal(error.httpStatus,503);assert.equal(error.errorCategory,'http');assert.match(error.message,/HTTP 503/);assert.equal(error.message.includes('private'),false);
});
test('invalid reads are distinguishable from failed mutations and never send a click',async()=>{
 const h=harness(1);h.options.customSnapshots={read:async()=>{throw Error('Resposta inválida: saldo');},invalidate:()=>{}};
 await h.farm.setModes('a0',{case:true,money:false,vault:false});await h.farm.start(['a0']);
 const error=h.events.find(e=>e.type==='account-error');assert.equal(error.stage,'read');assert.equal(error.errorCategory,'response');assert.equal(h.calls.length,0);
});

for (const count of [51, 100]) test(`${count} accounts each receive their own full click allowance within one window`, async () => {
  let h;
  h = harness(count, { maxInFlight: 4, sleep: async ms => { h.setTime(h.time + ms); if (h.time >= 311000) h.farm.stop(); } });
  for (const account of h.accounts) await h.farm.setModes(account.id, {case:true,money:true,vault:false});
  await h.farm.start(h.accounts.map(account => account.id));
  assert.equal(new Set(h.calls.map(call => call.id)).size, count);
  for (const account of h.accounts) assert.deepEqual([...new Set(h.calls.filter(call => call.id === account.id).map(call => call.kind))].sort(), ['case','money']);
  assert.ok(h.calls.every(call => call.at < 311000 && call.clicks > 0 && call.clicks <= 1000));
  assert.equal(h.calls.reduce((sum,call) => sum + call.clicks, 0), 1900*count);
  for (const id of h.accounts.map(account=>account.id)) for (const kind of ['case','money']) assert.equal(h.calls.filter(call => call.id === id && call.kind === kind).reduce((sum,call) => sum + call.clicks, 0), 950);
});

test('an even account count alternates click modes per account across windows', async () => {
  const h = harness(2);
  for (const account of h.accounts) await h.farm.setModes(account.id,{case:true,money:true,vault:false});
  h.options.onEvent = event => { if (event.type === 'request' && h.calls.length === 8) h.farm.stop(); };
  await h.farm.start(['a0','a1']);
  for (const id of ['a0','a1']) assert.deepEqual(h.calls.filter(call => call.id === id).map(call => call.kind), ['case','money','case','money']);
});

test('a due vault is collected before spending available click budget', async () => {
  const h = harness(1);
  let money = 10, last = new Date(h.time - 60000).toISOString();
  h.options.customApi = () => ({
    vaultSnapshot: async () => ({money,vaultCapacity:1,vaultMoneyPerMinute:1,vaultLastCollected:last,serverNow:new Date(h.time).toISOString()}),
    collectVault: async () => { money++; last = new Date(h.time).toISOString(); return {ok:true,status:200}; },
    generate: async () => ({ok:true,status:200}), clickMoney: async () => ({ok:true,status:200}),
  });
  h.options.onEvent = event => { if (['vault','request'].includes(event.type)) h.farm.stop(); };
  await h.farm.start(['a0']);
  assert.equal(h.events.find(event => ['vault','request'].includes(event.type)).type, 'vault');
});

test('confirmed gains reset for a new run and never count unconfirmed responses', async () => {
  const h = harness(1);
  let money = 0, reads = 0;
  h.options.customApi = () => ({clickMoney: async () => {money += 10;return {ok:true,status:200};}});
  h.options.customSnapshots = { read: async () => { reads++; if (reads === 4) throw Error('confirmation unavailable'); return {money,casesTotal:0}; }, invalidate(){} };
  await h.farm.setModes('a0',{case:false,money:true,vault:false});
  h.options.onEvent = event => { if (event.type === 'request') h.farm.stop(); };
  await h.farm.start(['a0']);
  assert.equal(h.farm.status().accounts[0].results.money, 10);
  await h.farm.start(['a0']);
  assert.equal(h.farm.status().accounts[0].results.money, 0);
  assert.equal(h.farm.status().accounts[0].results.unconfirmedRequests, 1);
});

for (const status of [200,401,429]) test(`rotation persistence failure preserves HTTP ${status} response handling`, async () => {
  const h = harness(1);
  let saves = 0, posts = 0;
  const save = h.options.stateStore.save;
  h.options.stateStore.save = async value => { if (++saves === 3) throw Error('disk unavailable'); await save(value); };
  h.options.customApi = () => ({generate: async () => { posts++; return {ok:status===200,status,retryAfter:'4'}; }});
  await h.farm.setModes('a0',{case:true,money:false,vault:false});
  h.options.onEvent = event => { if (event.type === 'request') h.farm.stop(); };
  // Rejecting the run is allowed on the old code; the server response must still be handled.
  await h.farm.start(['a0']).catch(() => {});
  assert.equal(posts,1,'saving rotation must not cause another mutation');
  assert.equal(h.events.find(event => event.type === 'request')?.httpStatus,status);
  if (status === 401) assert.equal(h.farm.status().accounts[0].needsLogin,true);
  if (status === 429) assert.ok((await h.coordinator.status()).cooldownUntil > h.time);
  if (status === 200) assert.equal(h.farm.status().accounts[0].results.confirmedRequests,1);
});

test('many due vaults do not monopolize the scheduler before case and money', async () => {
  const h = harness(51);
  const collected = new Map(), balances = new Map();
  h.options.customApi = account => ({
    vaultSnapshot: async () => ({money:balances.get(account.id)||0,vaultCapacity:100,vaultMoneyPerMinute:1,vaultLastCollected:collected.get(account.id)||new Date(h.time-6000000).toISOString(),serverNow:new Date(h.time).toISOString()}),
    collectVault: async () => { collected.set(account.id,new Date(h.time).toISOString());balances.set(account.id,100);return {ok:true,status:200}; },
    generate: async clicks => {h.calls.push({id:account.id,kind:'case',clicks,at:h.time});return {ok:true,status:200};},
    clickMoney: async clicks => {h.calls.push({id:account.id,kind:'money',clicks,at:h.time});return {ok:true,status:200};},
  });
  h.options.onEvent = event => { if (event.type === 'request' && h.calls.some(call=>call.kind==='case') && h.calls.some(call=>call.kind==='money')) h.farm.stop(); };
  await h.farm.start(h.accounts.map(account=>account.id));
  const work = h.events.filter(event=>['vault','request'].includes(event.type));
  assert.equal(work[0].type,'vault');
  assert.equal(work[1].type,'request','a due vault must yield to click work');
  assert.ok(work.filter(event=>event.type==='vault').length < 51,'both click modes run before collecting every vault');
});

test('vault requests are spaced while another account read is slow', async () => {
  const h = harness(3,{maxInFlight:4});
  const collected = new Map(), posts = [];
  let reads = 0;
  h.options.customApi = account => ({
    vaultSnapshot: async () => { if (++reads===1) h.setTime(h.time+2500);return {money:collected.has(account.id)?100:0,vaultCapacity:100,vaultMoneyPerMinute:1,vaultLastCollected:collected.get(account.id)||new Date(h.time-6000000).toISOString(),serverNow:new Date(h.time).toISOString()};},
    collectVault: async () => {posts.push(h.time);collected.set(account.id,new Date(h.time).toISOString());return {ok:true,status:200};},
  });
  for (const account of h.accounts) await h.farm.setModes(account.id,{case:false,money:false,vault:true});
  h.options.onEvent = event => {if(event.type==='vault'&&posts.length===3)h.farm.stop();};
  await h.farm.start(h.accounts.map(account=>account.id));
  assert.equal(posts.length,3);
  assert.ok(posts[1]-posts[0]>=2000);assert.ok(posts[2]-posts[1]>=2000);
});

test('click sends across accounts are paced instead of forming a burst', async () => {
  const h = harness(3,{maxInFlight:4});
  for (const account of h.accounts) await h.farm.setModes(account.id,{case:true,money:false,vault:false});
  h.options.onEvent = event => {if(event.type==='request'&&h.calls.length===3)h.farm.stop();};
  await h.farm.start(h.accounts.map(account=>account.id));
  assert.equal(h.calls.length,3);
  assert.ok(h.calls[1].at-h.calls[0].at>=500);assert.ok(h.calls[2].at-h.calls[1].at>=500);
});

test('a vault 429 identifies the cause and exposes zero sendable clicks during cooldown', async () => {
  const h = harness(1);
  h.options.customApi = () => ({vaultSnapshot:async()=>({money:0,vaultCapacity:100,vaultMoneyPerMinute:1,vaultLastCollected:new Date(h.time-6000000).toISOString(),serverNow:new Date(h.time).toISOString()}),collectVault:async()=>({ok:false,status:429,retryAfter:'4'})});
  h.options.onEvent = event => {if(event.type==='vault')h.farm.stop();};
  await h.farm.start(['a0']);
  assert.equal(h.farm.status().clicksAvailable,0);
  const limit=h.events.find(event=>event.type==='cooldown');
  assert.equal(limit?.operation,'vault');assert.equal(limit?.stage,'request');assert.equal(limit?.httpStatus,429);assert.equal(limit?.until,5000);
});

test('accepted click work accelerates gradually and a 429 backs off before retrying', async () => {
  const h=harness(51),sent=[];
  let count=0;
  h.options.customApi=()=>({generate:async()=>{const number=++count;sent.push({number,at:h.time});return number===22?{ok:false,status:429,retryAfter:'4'}:{ok:true,status:200};}});
  for(const account of h.accounts)await h.farm.setModes(account.id,{case:true,money:false,vault:false});
  h.options.onEvent=event=>{if(event.type==='request'&&count===24)h.farm.stop();};
  await h.farm.start(h.accounts.map(account=>account.id));
  assert.ok(sent[1].at-sent[0].at>=500);
  assert.ok(sent[20].at-sent[19].at<500,'healthy traffic gradually accelerates');
  assert.ok(sent[22].at-sent[21].at>=4000,'Retry-After is honored');
  assert.ok(sent[23].at-sent[22].at>=900,'resumed traffic uses a reduced request rate');
});

test('confirmed click events carry the same fresh normalized snapshot used for their delta', async()=>{
  const h=harness(1);let money=10;
  h.options.customApi=()=>({clickMoney:async()=>{money=20;return{ok:true,status:200};}});
  h.options.customSnapshots={read:async()=>({money,casesTotal:5,cases:[]}),invalidate(){}};
  await h.farm.setModes('a0',{case:false,money:true,vault:false});
  h.options.onEvent=event=>{if(event.type==='request')h.farm.stop();};
  await h.farm.start(['a0']);
  const event=h.events.find(event=>event.type==='request');
  assert.equal(event.verifiedDelta,10);assert.equal(event.snapshot?.money,20);assert.equal(event.snapshot?.casesTotal,5);
});

test('real API and snapshot reader confirm both modes with seven HTTP calls instead of ten',async()=>{
  const {createCaseApi}=require('../engine/api.cjs');
  const {createAccountSnapshots}=require('../engine/accountSnapshots.cjs');
  let h,money=10,amount=5;const calls=[];
  const api=createCaseApi(async(endpoint,init)=>{
    calls.push(`${init.method} ${endpoint}`);
    if(endpoint==='/api/caseClick')amount+=2;
    if(endpoint==='/api/click')money+=3;
    const payload=endpoint==='/api/me'?{money,tokens:0,moneyPerClick:1,casesPerClick:1,caseOpenCount:1,maxCaseOpenMultiplier:1,inventoryCount:0}:endpoint==='/api/cases'?[{id:'a',name:'Alpha',amount}]:{amount:2};
    return new Response(JSON.stringify(payload));
  });
  h=harness(1,{snapshots:createAccountSnapshots({apiForAccount:()=>api,now:()=>h.time})});
  h.options.customApi=()=>api;
  await h.farm.setModes('a0',{case:true,money:true,vault:false});
  h.options.onEvent=event=>{if(event.type==='request'&&h.events.filter(item=>item.type==='request').length===2)h.farm.stop();};
  await h.farm.start(['a0']);
  assert.deepEqual(calls,['GET /api/me','GET /api/cases','POST /api/caseClick','GET /api/cases','GET /api/me','POST /api/click','GET /api/me']);
  assert.deepEqual(h.events.filter(event=>event.type==='request').map(event=>[event.kind,event.verifiedDelta]),[['case',2],['money',3]]);
});

test('money confirmations schedule an unready vault without an extra probe',async()=>{
  const h=harness(1);let probes=0,clicks=0;
  h.options.customSnapshots={read:async()=>({money:clicks,casesTotal:0,vaultCapacity:100,vaultMoneyPerMinute:1,vaultLastCollected:new Date(h.time).toISOString()}),invalidate(){}};
  h.options.customApi=()=>({vaultSnapshot:async()=>{probes++;return {money:0,vaultCapacity:null};},clickMoney:async()=>{clicks++;return {ok:true,status:200};}});
  await h.farm.setModes('a0',{case:false,money:true,vault:true});
  h.options.onEvent=event=>{if(event.type==='request')h.farm.stop();};
  await h.farm.start(['a0']);
  assert.equal(probes,1,'initial probe occurs before clicks');
  assert.ok(h.farm.status().accounts[0].vaultNextAt>=h.time+5700000,'fresh money state replaces the failed probe deadline');
});

for (const kind of ['case','vault']) for (const limitStage of ['request','read']) test(`${kind} ${limitStage} 429 stops confirmation traffic and preserves accepted work`,async()=>{
  const h=harness(1);let reads=0,posts=0;
  const read=async()=>{
    if(++reads===2&&limitStage==='read')throw Object.assign(Error('limited'),{status:429,retryAfter:'6'});
    return {money:0,casesTotal:0,cases:[],vaultCapacity:100,vaultMoneyPerMinute:1,vaultLastCollected:new Date(h.time-6000000).toISOString(),serverNow:new Date(h.time).toISOString()};
  };
  const mutate=async()=>{posts++;return limitStage==='request'?{ok:false,status:429,retryAfter:'6'}:{ok:true,status:200};};
  h.options.customSnapshots={read,invalidate(){}};
  h.options.customApi=()=>({generate:mutate,vaultSnapshot:read,collectVault:mutate});
  await h.farm.setModes('a0',{case:kind==='case',money:false,vault:kind==='vault'});
  h.options.onEvent=event=>{if(event.type===(kind==='vault'?'vault':'request'))h.farm.stop();};
  await h.farm.start(['a0']);
  assert.equal(posts,1);assert.equal(reads,limitStage==='request'?1:2);
  const limit=h.events.find(event=>event.type==='cooldown');
  assert.equal(limit?.operation,kind);assert.equal(limit?.stage,limitStage);assert.equal(limit?.until,7000);
  assert.equal(h.farm.status().accounts[0].results.unconfirmedRequests,limitStage==='read'?1:0);
});

test('an account job queued before a shared cooldown sends no read when it finally starts',async()=>{
  const h=harness(1);let reads=0,release;
  h.options.customSnapshots={read:async()=>{reads++;return {money:0,casesTotal:0};},invalidate(){}};
  await h.farm.setModes('a0',{case:true,money:false,vault:false});
  const blocker=h.options.accountQueue.run('a0',()=>new Promise(resolve=>{release=resolve;}));
  const running=h.farm.start(['a0']);
  for(let index=0;index<20&&!h.farm.status().accounts[0].inFlight;index++)await new Promise(setImmediate);
  await h.coordinator.limit(h.time+60000);h.farm.stop();release();await blocker;await running;
  assert.equal(reads,0);assert.equal(h.calls.length,0);
});

test('reopening the farm keeps the slower pace learned from a server limit',async()=>{
  const h=harness(1);
  h.options.customApi=()=>({generate:async()=>({ok:false,status:429,retryAfter:'6'})});
  await h.farm.setModes('a0',{case:true,money:false,vault:false});
  h.options.onEvent=event=>{if(event.type==='request')h.farm.stop();};
  await h.farm.start(['a0']);
  const reopened=harness(1,{stateStore:{load:async()=>h.savedFarm,save:async()=>{}}});
  await reopened.farm.ready();
  assert.deepEqual(reopened.farm.status().pace,{clickIntervalMs:1000,vaultIntervalMs:4000});
});

test('a cooldown arriving after reservation prevents the pending click send',async()=>{
  let h;h=harness(1,{sleep:async()=>{h.farm.stop();}});const reserve=h.coordinator.reserve.bind(h.coordinator);
  h.coordinator.reserve=async(...args)=>{const value=await reserve(...args);await h.coordinator.limit(h.time+60000);return value;};
  await h.farm.setModes('a0',{case:true,money:false,vault:false});
  await h.farm.start(['a0']);
  assert.equal(h.calls.length,0);
});

test('stop during the final asynchronous cooldown check releases the account reservation',async()=>{
  const h=harness(1);let checks=0,entered,release;
  const waiting=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  const cooldown=h.coordinator.cooldown.bind(h.coordinator);
  h.coordinator.cooldown=async()=>{if(++checks===3){entered();await gate;}return cooldown();};
  await h.farm.setModes('a0',{case:true,money:false,vault:false});
  const running=h.farm.start(['a0']);await waiting;h.farm.stop();release();await running;
  assert.equal(h.calls.length,0);assert.equal((await h.coordinator.status('a0')).caseUsed,0);
});
