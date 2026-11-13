const test = require('node:test');
const assert = require('node:assert/strict');
const { createOpenScheduler } = require('../engine/openScheduler.cjs');

const id = '691f90c11ff412261c423a3f';
const skin = (extra = {}) => ({ _id: id, name: 'Cheap item', price: 2, quality: 0, rarity: 'Mil-Spec Grade', isFavorite: false, isTerminal: false, isSticker: false, isKeychain: false, ...extra });
const openingSnapshot=(amount=2,extra={})=>{let reads=0;return async()=>({casesTotal:reads%2?amount-1:amount,cases:[{id,amount:reads++%2?amount-1:amount}],...extra});};
const config = { accounts: [{ id: 'a' }], caseId: id, maxOpens: 1, delayMs: 1000, concurrency: 1, convert: true, maxPrice: 5, conversionCap: 1 };

test('item rules run after the account queue is released and replace price conversion',async()=>{
 let insideQueue=false,converted=0,applied=0;
 const scheduler=createOpenScheduler({accountQueue:{run:async(_account,work)=>{assert.equal(insideQueue,false);insideQueue=true;try{return await work();}finally{insideQueue=false;}}},apiForAccount:()=>({snapshot:openingSnapshot(),openCase:async()=>({ok:true,status:200,skinIds:[id]}),convertSkin:async()=>{converted++;}}),onOpenedItems:async(_entry,ids)=>{assert.equal(insideQueue,false);assert.deepEqual(ids,[id]);applied++;},sleep:async()=>{}});
 await scheduler.start({...config,itemRules:[{name:'Cheap item',action:'sell'}],convert:false});
 assert.equal(applied,1);assert.equal(converted,0);
});

test('incomplete opening response leaves every item untouched and stops the account',async()=>{
 let applied=0;const events=[];
 const scheduler=createOpenScheduler({apiForAccount:()=>({snapshot:openingSnapshot(2,{caseOpenCount:2}),openCase:async()=>({ok:true,status:200,requestedCount:2,skinIds:[id]})}),onOpenedItems:async()=>{applied++;},emit:event=>events.push(event),sleep:async()=>{}});
 const result=await scheduler.start({...config,itemRules:[{name:'Cheap item',action:'sell'}],convert:false});
 assert.equal(applied,0);assert.equal(result.accounts[0].disabled,true);assert.match(events.find(event=>event.type==='account-error').message,/não identificou todos/i);
});

test('opens once and converts only the returned cheap common skin', async () => {
  const calls = [];
  let balanceReads = 0;
  const scheduler = createOpenScheduler({
    apiForAccount: () => ({
      snapshot: openingSnapshot(),
      openCase: async () => { calls.push('open'); return { ok: true, status: 200, skinIds: [id] }; },
      inventoryPage: async () => ({ skins: [skin()], pages: 1 }),
      balance: async () => ({ money: 20, tokens: ++balanceReads }),
      convertSkin: async (skinId) => { calls.push(skinId); return { ok: true, status: 200 }; },
    }),
    sleep: async () => {}, emit: () => {},
  });
  const result = await scheduler.start(config);
  assert.deepEqual(calls, ['open', id]);
  assert.equal(result.opened, 1);
  assert.equal(result.converted, 1);
});

test('a successful HTTP response does not count as token conversion without a token increase', async () => {
  const secondId = '691f90c11ff412261c423a40';
  const calls = [];
  const events = [];
  const scheduler = createOpenScheduler({
    apiForAccount: () => ({
      snapshot: (()=>{let reads=0;return async()=>({casesTotal:reads%2?0:2,cases:[{id,amount:reads++%2?0:2}],caseOpenCount:2});})(),
      openCase: async () => ({ ok: true, status: 200, skinIds: [id, secondId], requestedCount:2 }),
      inventoryPage: async () => ({ skins: [skin(), skin({ _id: secondId })], pages: 1 }),
      balance: async () => ({ money: 22, tokens: 1 }),
      convertSkin: async (skinId) => { calls.push(skinId); return { ok: true, status: 200 }; },
    }),
    sleep: async () => {}, emit: (event) => events.push(event),
  });
  const result = await scheduler.start({ ...config, conversionCap: 2 });
  assert.equal(result.converted, 0);
  assert.equal(result.failed, 1);
  assert.equal(result.accounts[0].disabled, true);
  assert.deepEqual(calls, [id]);
  assert.equal(events.find((event) => event.type === 'conversion').verified, false);
});

test('money mode sells the opened item and confirms a money increase', async () => {
  let balanceReads = 0;
  let tokenCalls = 0;
  const events = [];
  const scheduler = createOpenScheduler({
    apiForAccount: () => ({
      snapshot: openingSnapshot(),
      openCase: async () => ({ ok: true, status: 200, skinIds: [id] }),
      inventoryPage: async () => ({ skins: [skin()], pages: 1 }),
      balance: async () => ({ money: 20 + 2 * balanceReads++, tokens: 1 }),
      convertSkin: async () => { tokenCalls++; return { ok: true, status: 200 }; },
      sellSkin: async () => ({ ok: true, status: 200 }),
    }),
    sleep: async () => {}, emit: (event) => events.push(event),
  });
  const result = await scheduler.start({ ...config, conversionMode: 'money' });
  assert.equal(tokenCalls, 0);
  assert.equal(result.converted, 1);
  assert.equal(events.find((event) => event.type === 'conversion').moneyDelta, 2);
});

test('money mode never counts token growth as a confirmed sale', async () => {
  const scheduler = createOpenScheduler({
    apiForAccount: () => ({
      snapshot: openingSnapshot(),
      openCase: async () => ({ ok: true, status: 200, skinIds: [id] }),
      inventoryPage: async () => ({ skins: [skin()], pages: 1 }),
      balance: (() => { let reads = 0; return async () => ({ money: 20, tokens: ++reads }); })(),
      sellSkin: async () => ({ ok: true, status: 200 }),
    }),
    sleep: async () => {}, emit: () => {},
  });
  const result = await scheduler.start({ ...config, conversionMode: 'money' });
  assert.equal(result.converted, 0);
  assert.equal(result.accounts[0].disabled, true);
});

test('rejected token conversion stops further openings for that account', async () => {
  let opens = 0;
  const scheduler = createOpenScheduler({
    apiForAccount: () => ({
      snapshot: openingSnapshot(5),
      openCase: async () => { opens++; if (opens > 2) throw new Error('unexpected extra opening'); return { ok: true, status: 200, skinIds: [id] }; },
      inventoryPage: async () => ({ skins: [skin()], pages: 1 }),
      balance: async () => ({ money: 20, tokens: 1 }),
      convertSkin: async () => ({ ok: false, status: 400, message: 'item not eligible' }),
    }),
    sleep: async () => {}, emit: () => {},
  });
  const result = await scheduler.start({ ...config, continuous: true, adaptive: true, conversionCap: null });
  assert.equal(opens, 1);
  assert.equal(result.accounts[0].disabled, true);
});

test('opening stops after one accepted response without identifiable items when conversion is enabled', async () => {
  let opens = 0;
  const events = [];
  const scheduler = createOpenScheduler({
    apiForAccount: () => ({
      snapshot: openingSnapshot(5),
      openCase: async () => { opens++; if (opens > 2) throw new Error('unexpected extra opening'); return { ok: true, status: 200, skinIds: [] }; },
    }),
    sleep: async () => {}, emit: (event) => events.push(event),
  });
  const result = await scheduler.start({ ...config, continuous: true, adaptive: true, conversionCap: null });
  assert.equal(opens, 1);
  assert.equal(result.accounts[0].disabled, true);
  assert.equal(events.some((event) => event.type === 'account-error'), true);
});

test('opening stops when returned item IDs cannot be matched to inventory', async () => {
  let opens = 0;
  const scheduler = createOpenScheduler({
    apiForAccount: () => ({
      snapshot: openingSnapshot(5),
      openCase: async () => { opens++; if (opens > 2) throw new Error('unexpected extra opening'); return { ok: true, status: 200, skinIds: [id] }; },
      inventoryPage: async () => ({ skins: [], pages: 1 }),
    }),
    sleep: async () => {}, emit: () => {},
  });
  const result = await scheduler.start({ ...config, continuous: true, adaptive: true, conversionCap: null });
  assert.equal(opens, 1);
  assert.equal(result.accounts[0].disabled, true);
});

test('retains rare and expensive skins, and never converts a pre-existing ID', async () => {
  let conversions = 0;
  const scheduler = createOpenScheduler({
    apiForAccount: () => ({
      snapshot: openingSnapshot(),
      openCase: async () => ({ ok: true, status: 200, skinIds: [id] }),
      inventoryPage: async () => ({ skins: [skin({ quality: 1, price: 100 }), skin({ _id: 'otherid', price: 1 })], pages: 1 }),
      convertSkin: async () => { conversions++; return { ok: true, status: 200 }; },
    }),
    sleep: async () => {}, emit: () => {},
  });
  await scheduler.start(config);
  assert.equal(conversions, 0);
});

test('429 pauses the next account before opening', async () => {
  let time = 0;
  const calls = [];
  const scheduler = createOpenScheduler({
    apiForAccount: (account) => ({
      snapshot: openingSnapshot(),
      openCase: async () => { calls.push({ id: account.id, time }); return account.id === 'a' ? { ok: false, status: 429, retryAfter: '4', skinIds: [] } : { ok: true, status: 200, skinIds: [] }; },
    }),
    now: () => time,
    sleep: async (ms) => { time += ms; }, emit: () => {},
  });
  await scheduler.start({ ...config, accounts: [{ id: 'a' }, { id: 'b' }], convert: false });
  assert.equal(calls[1].time - calls[0].time >= 4000, true);
});

test('continuous opening stops when the selected account runs out of cases', async () => {
  let time = 0;
  let calls = 0;
  const scheduler = createOpenScheduler({
    apiForAccount: () => ({
      snapshot: async () => ({ casesTotal: 2 - calls, cases: [{ id, amount: 2 - calls }] }),
      openCase: async () => { calls++; return { ok: true, status: 200, skinIds: [id] }; },
    }),
    now: () => time, sleep: async (ms) => { time += ms; }, emit: () => {},
  });
  const result = await scheduler.start({ ...config, continuous: true, adaptive: true, convert: false });
  assert.equal(calls, 2);
  assert.equal(result.opened, 2);
  assert.equal(result.phase, 'complete');
  assert.equal(result.accounts[0].disabled, true);
});

test('opening batch follows each account setting and available stock', async () => {
  const calls = [];
  const scheduler = createOpenScheduler({
    apiForAccount: () => ({
      snapshot: (()=>{let reads=0;return async()=>({casesTotal:reads%2?1:13,cases:[{id,amount:reads++%2?1:13}],caseOpenCount:16,maxCaseOpenMultiplier:2});})(),
      openCase: async (_id, count, multiplier) => { calls.push({ count, multiplier }); return { ok: true, status: 200, requestedCount: count * multiplier, skinIds: Array.from({length:count*multiplier},(_,i)=>i.toString(16).padStart(24,"0")) }; },
    }),
    sleep: async () => {}, emit: () => {},
  });
  const result = await scheduler.start({ ...config, convert: false });
  assert.deepEqual(calls, [{ count: 6, multiplier: 2 }]);
  assert.equal(result.opened, 12);
});

test('single-case token check opens exactly one case even with a larger account batch setting', async () => {
  const calls = [];
  const scheduler = createOpenScheduler({
    apiForAccount: () => ({
      snapshot: openingSnapshot(20,{caseOpenCount:16,maxCaseOpenMultiplier:2}),
      openCase: async (_id, count, multiplier) => { calls.push({ count, multiplier }); return { ok: true, status: 200, requestedCount: count * multiplier, skinIds: Array.from({length:count*multiplier},(_,i)=>i.toString(16).padStart(24,"0")) }; },
    }),
    sleep: async () => {}, emit: () => {},
  });
  const result = await scheduler.start({ ...config, testOnce: true, convert: false, maxOpens: 1 });
  assert.deepEqual(calls, [{ count: 1, multiplier: 1 }]);
  assert.equal(result.opened, 1);
});
test('auto conversion skips an item reserved by a reviewed operation',async()=>{
 let conversions=0;const scheduler=createOpenScheduler({isItemReserved:()=>true,apiForAccount:()=>({snapshot:openingSnapshot(),openCase:async()=>({ok:true,status:200,skinIds:[id]}),inventoryPage:async()=>({skins:[skin()],pages:1}),balance:async()=>({money:20,tokens:1}),convertSkin:async()=>{conversions++;return {ok:true,status:200};}}),sleep:async()=>{}});
 await scheduler.start(config);assert.equal(conversions,0);
});
