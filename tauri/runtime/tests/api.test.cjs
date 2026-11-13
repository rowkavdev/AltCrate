const test = require('node:test');
const assert = require('node:assert/strict');

test('failed account reads preserve the server retry deadline',async()=>{
  const {createCaseApi}=require('../engine/api.cjs');
  const api=createCaseApi(async endpoint=>new Response('{}',{status:endpoint==='/api/cases'?429:200,headers:{'Retry-After':'6'}}));
  await assert.rejects(()=>api.snapshot(),error=>error.status===429&&error.retryAfter==='6');
});
const { createCaseApi, normalizeSnapshot } = require('../engine/api.cjs');

test('farm reads fetch only the resource being confirmed and retain other last-observed fields',async()=>{
  const calls=[];
  const me={money:21,tokens:3,moneyPerClick:0.2,casesPerClick:1,caseOpenCount:1,maxCaseOpenMultiplier:1,inventoryCount:0,password:'private'};
  const previous=normalizeSnapshot({...me,money:10},[{id:'a',name:'Alpha',amount:5}]);
  const api=createCaseApi(async path=>{calls.push(path);return new Response(JSON.stringify(path==='/api/me'?me:[{id:'a',name:'Alpha',amount:8}]));});
  const money=await api.farmSnapshot('money',previous);
  assert.deepEqual(calls,['/api/me']);assert.equal(money.money,21);assert.equal(money.casesTotal,5);
  const cases=await api.farmSnapshot('case',money);
  assert.deepEqual(calls,['/api/me','/api/cases']);assert.equal(cases.casesTotal,8);assert.equal(cases.money,21);
  assert.equal(JSON.stringify(cases).includes('private'),false);
});

test('snapshot counts cases and keeps only displayed account fields', () => {
  const result = normalizeSnapshot(
    { money: 12.5, tokens: 3, moneyPerClick: 0.2, casesPerClick: 3.5, caseOpenCount: 16, maxCaseOpenMultiplier: 1, inventoryCount: 2, password: 'secret' },
    [{ _id: 'a', amount: 4, name: 'Alpha' }, { _id: 'b', amount: 2, case: { name: 'Beta' } }],
  );
  assert.deepEqual(result, {
    membership: null,
    money: 12.5, tokens: 3, moneyPerClick: 0.2, casesPerClick: 3.5, caseOpenCount: 16, maxCaseOpenMultiplier: 1, inventoryCount: 2, casesTotal: 6,
    cases: [{ id: 'a', name: 'Alpha', amount: 4 }, { id: 'b', name: 'Beta', amount: 2 }],
    vaultCapacity: null, vaultMoneyPerMinute: null, vaultLastCollected: null,
  });
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('snapshot exposes validated vault fields without extra account data', () => {
  const me = { money: 10, tokens: 1, moneyPerClick: 0.1, casesPerClick: 1, caseOpenCount: 1, maxCaseOpenMultiplier: 1, inventoryCount: 0, vaultCapacity: 1060, vaultMoneyPerMinute: 77, vaultLastCollected: '2026-10-09T10:00:00.000Z', email: 'private@example.com' };
  const snapshot = normalizeSnapshot(me, []);
  assert.deepEqual([snapshot.vaultCapacity, snapshot.vaultMoneyPerMinute, snapshot.vaultLastCollected], [1060, 77, '2026-10-09T10:00:00.000Z']);
  assert.equal(JSON.stringify(snapshot).includes('private@example.com'), false);
});

test('missing or invalid vault fields make the entire vault state unavailable', () => {
  const me = { money: 10, tokens: 1, moneyPerClick: 0.1, casesPerClick: 1, caseOpenCount: 1, maxCaseOpenMultiplier: 1, inventoryCount: 0, vaultCapacity: 1060, vaultMoneyPerMinute: 77 };
  assert.deepEqual(Object.fromEntries(Object.entries(normalizeSnapshot(me, [])).filter(([key]) => key.startsWith('vault'))), { vaultCapacity: null, vaultMoneyPerMinute: null, vaultLastCollected: null });
  assert.equal(normalizeSnapshot({ ...me, vaultLastCollected: 'bad-date' }, []).vaultCapacity, null);
});

test('collectVault sends an empty POST to the fixed endpoint', async () => {
  const calls = [];
  const api = createCaseApi(async (path, init) => {
    calls.push({ path, init });
    return { status: 200, ok: true, headers: { get: () => null }, text: async () => '{}' };
  });
  const result = await api.collectVault();
  assert.equal(calls[0].path, '/api/vault');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.body, undefined);
  assert.deepEqual(result, { status: 200, ok: true, retryAfter: null, message: '' });
});

test('vaultSnapshot reads only me and accepts the server Date header', async () => {
  const calls = [];
  const api = createCaseApi(async (path) => {
    calls.push(path);
    return { status: 200, ok: true, headers: { get: (name) => name === 'Date' ? 'Fri, 09 Oct 2026 10:05:00 GMT' : null }, text: async () => JSON.stringify({ money: 12, vaultCapacity: 100, vaultMoneyPerMinute: 10, vaultLastCollected: '2026-10-09T10:00:00.000Z', token: 'secret' }) };
  });
  assert.deepEqual(await api.vaultSnapshot(), { money: 12, vaultCapacity: 100, vaultMoneyPerMinute: 10, vaultLastCollected: '2026-10-09T10:00:00.000Z', serverNow: '2026-10-09T10:05:00.000Z' });
  assert.deepEqual(calls, ['/api/me']);
});

test('case generation sends only validated clicks to the fixed endpoint', async () => {
  const calls = [];
  const api = createCaseApi(async (path, init) => {
    calls.push({ path, init });
    return { status: 200, ok: true, headers: { get: () => null }, text: async () => '{"amount":1,"caseName":"Alpha"}' };
  });
  const result = await api.generate(3);
  assert.equal(calls[0].path, '/api/caseClick');
  assert.deepEqual(JSON.parse(calls[0].init.body), { clicks: 3 });
  assert.equal(result.awardedCount, 1);
  assert.equal(result.caseName, 'Alpha');
  await assert.rejects(() => api.generate(0), /1.*1000/);
});

test('opening and conversion use fixed endpoints and one owned item ID', async () => {
  const id = '691f90c11ff412261c423a3f';
  const catalogId = '691f90c11ff412261c423a40';
  const calls = [];
  const api = createCaseApi(async (path, init) => {
    calls.push({ path, init });
    return { status: 200, ok: true, headers: { get: () => null }, text: async () => path === '/api/open/case' ? JSON.stringify({ skins: [{ _id: catalogId }], openedSkins: [{ _id: id }] }) : '{}' };
  });
  assert.deepEqual((await api.openCase(id)).skinIds, [id]);
  assert.equal(calls[0].path, '/api/open/case');
  assert.equal(JSON.parse(calls[0].init.body).count, 1);
  assert.equal(Object.hasOwn(JSON.parse(calls[0].init.body), 'autoOpen'), false);
  await api.convertSkin(id);
  assert.equal(calls[1].path, '/api/casino/skinToTokens');
  assert.deepEqual(JSON.parse(calls[1].init.body), { id });
  await api.sellSkin(id);
  assert.equal(calls[2].path, '/api/inventory');
  assert.equal(calls[2].init.method, 'DELETE');
  assert.deepEqual(JSON.parse(calls[2].init.body), { id });
  await assert.rejects(() => api.convertSkin('../other'), /inválido/);
  await assert.rejects(() => api.sellSkin('../other'), /inválido/);
});

test('quick opening reads the direct skin list returned by the site', async () => {
  const id = '691f90c11ff412261c423a3f';
  const api = createCaseApi(async () => ({ status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify([{ _id: id, name: 'Drop' }]) }));
  assert.deepEqual((await api.openCase(id)).skinIds, [id]);
});

test('single quick opening also accepts a direct skin object', async () => {
  const id = '691f90c11ff412261c423a3f';
  const api = createCaseApi(async () => ({ status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ _id: id, name: 'Drop' }) }));
  assert.deepEqual((await api.openCase(id)).skinIds, [id]);
});

test('balance reads only current money and tokens', async () => {
  const api = createCaseApi(async (path) => {
    assert.equal(path, '/api/me');
    return { status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ money: 100, tokens: 2.5, email: 'private@example.com' }) };
  });
  assert.deepEqual(await api.balance(), { money: 100, tokens: 2.5 });
});

test('money clicks use the fixed endpoint and validated count', async () => {
  const calls = [];
  const api = createCaseApi(async (path, init) => {
    calls.push({ path, init });
    return { status: 200, ok: true, headers: { get: () => null }, text: async () => '123.45' };
  });
  assert.equal((await api.clickMoney(1000)).ok, true);
  assert.equal(calls[0].path, '/api/click');
  assert.deepEqual(JSON.parse(calls[0].init.body), { clicks: 1000 });
  await assert.rejects(() => api.clickMoney(1001), /1.*1000/);
});
test('inventory actions validate identifiers and use observed mutation bodies',async()=>{
 const calls=[],skinId='a'.repeat(24),storageUnitId='b'.repeat(24);
 const api=createCaseApi(async(path,init)=>{calls.push({path,...init});return {ok:true,status:200,headers:new Headers(),text:async()=>JSON.stringify({_id:'c'.repeat(24),isUnlocked:true})};});
 assert.equal(typeof api.setSkinFavorite,'function');await api.setSkinFavorite(skinId,true,true);await api.withdrawStorageSkin(skinId,storageUnitId);
 assert.deepEqual(JSON.parse(calls[0].body),{skinId,isFavorite:true,inStorageUnit:true});assert.deepEqual(JSON.parse(calls[1].body),{skinId,storageUnitId});assert.equal(calls[1].method,'DELETE');
 assert.equal((await api.createTrade()).tradeId,'c'.repeat(24));assert.equal(calls[2].method,'POST');assert.equal(calls[2].body,undefined);
 await api.tradingStatus();assert.equal(calls[3].method,'GET');const before=calls.length;await assert.rejects(api.withdrawStorageSkin('bad',storageUnitId));await assert.rejects(api.setSkinFavorite(skinId,'yes',false));assert.equal(calls.length,before);
});
test('storage deposit posts a single validated item',async()=>{
 const calls=[],skinId='a'.repeat(24),storageUnitId='b'.repeat(24);
 const api=createCaseApi(async(path,init)=>{calls.push({path,init});return {ok:true,status:200,headers:new Headers(),text:async()=>'{"ok":true}'};});
 const result=await api.depositStorageSkin(skinId,storageUnitId);
 assert.equal(result.ok,true);assert.equal(calls[0].path,'/api/inventory/storageUnits/skins');assert.equal(calls[0].init.method,'POST');
 assert.deepEqual(JSON.parse(calls[0].init.body),{skinIds:[skinId],storageUnitId});
 await assert.rejects(api.depositStorageSkin('bad',storageUnitId),/Identificador/);assert.equal(calls.length,1);
});

test('account balances reject missing numeric values instead of inventing zero balances', async () => {
  for (const invalid of [null, '', '   ', false, true, [], [12], {}]) {
    for (const field of ['money', 'tokens']) {
      const api = createCaseApi(async () => new Response(JSON.stringify({ money: 12, tokens: 3, [field]: invalid })));
      await assert.rejects(api.balance(), /Resposta inválida/, `${field}: ${JSON.stringify(invalid)}`);
    }
  }
});

test('snapshots reject unavailable numeric fields and malformed case quantities', () => {
  const me = { money: 0, tokens: 0, moneyPerClick: 0.1, casesPerClick: 1, caseOpenCount: 1, maxCaseOpenMultiplier: 1, inventoryCount: 0 };
  for (const field of Object.keys(me)) {
    for (const invalid of [null, '', ' ', false, []]) {
      assert.throws(() => normalizeSnapshot({ ...me, [field]: invalid }, []), /Resposta inválida/, field);
    }
  }
  assert.throws(() => normalizeSnapshot(me, [{ _id: 'a'.repeat(24), amount: null }]), /quantidade de caixas/);
});

test('valid zero balances and numeric strings retain their actual values', async () => {
  const api = createCaseApi(async () => new Response(JSON.stringify({ money: 0, tokens: '0' })));
  assert.deepEqual(await api.balance(), { money: 0, tokens: 0 });
  const fractional = createCaseApi(async () => new Response(JSON.stringify({ money: '12.50', tokens: '-0.25' })));
  assert.deepEqual(await fractional.balance(), { money: 12.5, tokens: -0.25 });
});
