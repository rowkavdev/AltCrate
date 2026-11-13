const test = require('node:test');
const assert = require('node:assert/strict');
let createFarmNetwork;
try { ({ createFarmNetwork } = require('../electron/farmNetwork.cjs')); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }

function harness(config = { enabled: true, proxies: ['socks5://5.6.7.8:1080', 'http://9.8.7.6:8080'] }, fail = [], beforeFetch) {
  assert.equal(typeof createFarmNetwork, 'function', 'native account routing is implemented');
  const calls = [], sessions = new Map();
  const sessionForPartition = partition => {
    if (!sessions.has(partition)) {
      const ses = { route: null, async setProxy(value) { this.route = value; }, async closeAllConnections() {},
        async fetch(url, init) {
          calls.push({ partition, url, init, route: this.route });
          await beforeFetch?.(this.route, url);
          if (fail.includes(this.route?.proxyRules)) throw Error('TLS or proxy connection failed');
          if (partition.startsWith('persist:')) return { status: 200, text: async () => '{}' };
          assert.equal(init.credentials, 'omit');
          return { status: 200, headers: new Headers(), text: async () => url.endsWith('/trace') ? `ip=${this.route?.proxyRules ? new URL(this.route.proxyRules).hostname : '1.2.3.4'}\n` : 'official public page' };
        } };
      sessions.set(partition, ses);
    }
    return sessions.get(partition);
  };
  const network = createFarmNetwork({ readConfig: async () => config, sessionForPartition });
  const accounts = Array.from({ length: 51 }, (_, index) => ({ id: `a${index}`, partition: `persist:caseclicker-${index}` }));
  return { network, accounts, sessions, calls };
}

test('51 native sessions are evenly assigned to three verified distinct routes without copying cookies', async () => {
  const h = harness(); await h.network.ready(h.accounts);
  assert.deepEqual(h.network.status(), { configured: true, connections: 3, directAccounts: 17, proxiedAccounts: 34, unavailableProxies: 0 });
  assert.equal(h.calls.some(row => row.partition.startsWith('persist:')), false);
  assert.equal(h.network.groupAccounts('a0').length, 17);
  assert.equal(h.network.groupAccounts('a1').includes('a0'), false);
  const before = h.sessions.get(h.accounts[1].partition).route;
  await h.network.fetch(h.accounts[1], '/api/click', { method: 'POST', body: '{"clicks":950}', credentials: 'include' });
  const row = h.calls.at(-1);
  assert.equal(row.route, before); assert.equal(row.init.credentials, 'include');
  assert.equal(row.init.redirect, 'error'); assert.equal(row.url, 'https://case-clicker.com/api/click');
  assert.equal(h.network.groupAccounts('a1').length, 17);
});

test('eight verified proxies distribute all 51 sessions across nine isolated groups', async () => {
  const proxies = Array.from({ length: 8 }, (_, index) => `http://8.8.4.${index + 1}:8080`);
  const h = harness({ enabled: true, proxies });
  await h.network.ready(h.accounts);
  assert.deepEqual(h.network.status(), { configured: true, connections: 9, directAccounts: 6, proxiedAccounts: 45, unavailableProxies: 0 });
  const groups = new Map(h.accounts.map(account => [h.network.groupKey(account.id), h.network.groupAccounts(account.id)]));
  assert.equal(groups.size, 9);
  assert.deepEqual([...groups.values()].map(ids => ids.length).sort(), [5, 5, 5, 6, 6, 6, 6, 6, 6]);
  assert.equal(new Set([...groups.values()].flat()).size, 51);
  assert.deepEqual(new Set([...h.sessions].filter(([id]) => id.startsWith('persist:')).map(([, ses]) => ses.route.proxyRules).filter(Boolean)), new Set(proxies));
});

test('transient public baseline and proxy failures receive one bounded retry before routes are discarded', async () => {
  const proxies = Array.from({ length: 8 }, (_, index) => `http://8.8.4.${index + 1}:8080`);
  const attempts = new Map();
  const h = harness({ enabled: true, proxies }, [], async (route, url) => {
    if (!url.endsWith('/trace')) return;
    const key = route.proxyRules || route.mode;
    attempts.set(key, (attempts.get(key) || 0) + 1);
    if (['system', proxies[0]].includes(key) && attempts.get(key) === 1) throw Error('Transient public connection timeout');
  });
  await h.network.ready(h.accounts);
  assert.equal(h.network.status().connections, 9);
  assert.equal(h.network.status().unavailableProxies, 0);
  assert.equal(attempts.get('system'), 2);
  assert.equal(attempts.get(proxies[0]), 2);
  assert.equal(attempts.get(proxies[1]), 1);
  assert.equal(h.calls.some(row => row.partition.startsWith('persist:')), false);
});

test('startup validation checks at most two free proxy requests concurrently', async () => {
  const proxies = Array.from({ length: 8 }, (_, index) => `http://8.8.4.${index + 1}:8080`);
  let active = 0, maximum = 0;
  const h = harness({ enabled: true, proxies }, [], async route => {
    if (!route.proxyRules) return;
    active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
  });
  await h.network.ready(h.accounts);
  assert.equal(h.network.status().connections, 9);
  assert.equal(maximum, 2);
});

test('51 distinct verified proxies give all 51 accounts a dedicated proxy without using the direct route', async () => {
  const proxies = Array.from({ length: 51 }, (_, index) => `http://8.8.4.${index + 1}:8080`);
  const h = harness({ enabled: true, proxies });
  await h.network.ready(h.accounts);
  assert.deepEqual(h.network.status(), { configured: true, connections: 52, directAccounts: 0, proxiedAccounts: 51, unavailableProxies: 0 });
  assert.equal(new Set(h.accounts.map(a => h.network.groupKey(a.id))).size, 51);
  assert.equal(h.accounts.every(a => h.network.groupAccounts(a.id).length === 1), true);
  assert.deepEqual(new Set([...h.sessions].filter(([id]) => id.startsWith('persist:')).map(([, ses]) => ses.route.proxyRules)), new Set(proxies));
});

test('a failed public proxy is excluded before any authenticated session uses it', async () => {
  const h = harness(undefined, ['http://9.8.7.6:8080']); await h.network.ready(h.accounts);
  assert.deepEqual(h.network.status(), { configured: true, connections: 2, directAccounts: 26, proxiedAccounts: 25, unavailableProxies: 1 });
  assert.equal([...h.sessions].filter(([id]) => id.startsWith('persist:')).some(([, ses]) => ses.route?.proxyRules === 'http://9.8.7.6:8080'), false);
});

test('disabled routing restores system routes and makes no public or authenticated probes', async () => {
  const h = harness({ enabled: false, proxies: ['http://9.8.7.6:8080'] }); await h.network.ready(h.accounts);
  assert.equal(h.network.status().connections, 1); assert.equal(h.network.status().proxiedAccounts, 0);
  assert.equal(h.calls.length, 0);
  assert.equal([...h.sessions.values()].every(ses => ses.route.mode === 'system'), true);
});

test('proxy credentials, hostnames and route syntax cannot enter the native proxy configuration', async () => {
  const h = harness({ enabled: true, proxies: ['http://user:secret@9.8.7.6:8080', 'http://example.com:8080', 'http://9.8.7.6:8080;DIRECT', 'socks5://5.6.7.8:1080'] });
  await h.network.ready(h.accounts);
  assert.equal(h.network.status().connections, 2); assert.equal(h.network.status().unavailableProxies, 3);
  assert.equal([...h.sessions.values()].some(ses => ses.route?.proxyRules?.includes('secret')), false);
});

test('an uncertain farm mutation is sent once and never replayed or switched to another route', async () => {
  const h = harness(); await h.network.ready(h.accounts);
  const ses = h.sessions.get(h.accounts[1].partition); let sent = 0;
  ses.fetch = async (_url, init) => { sent++; assert.ok(init.signal); throw Error('Connection lost after send'); };
  await assert.rejects(h.network.fetch(h.accounts[1], '/api/click', { method: 'POST' }), /Connection lost/);
  assert.equal(sent, 1); assert.equal(ses.route.proxyRules, 'socks5://5.6.7.8:1080');
});

test('the routed authenticated fetch only admits game API endpoints', async () => {
  const h = harness(); await h.network.ready(h.accounts);
  await assert.rejects(h.network.fetch(h.accounts[0], 'https://another.example/api/me'), /inválido/);
  await assert.rejects(h.network.fetch(h.accounts[0], '/api/../../auth/login'), /inválido/);
  assert.equal(h.calls.some(row => row.partition.startsWith('persist:')), false);
});

test('adding and removing accounts reconciles group holds without moving existing native sessions', async () => {
  const h = harness(); await h.network.ready(h.accounts);
  const original = h.sessions.get(h.accounts[1].partition).route;
  const added = { id: 'new', partition: 'persist:caseclicker-new' };
  await h.network.ready([...h.accounts, added]);
  assert.equal(h.network.groupAccounts('a0').includes('new'), true);
  assert.equal(h.network.groupAccounts('new').includes('a0'), true);
  assert.equal(h.network.status().directAccounts, 18);
  assert.equal(h.sessions.get(h.accounts[1].partition).route, original);
  await h.network.ready(h.accounts);
  assert.equal(h.network.groupAccounts('a0').includes('new'), false);
  assert.equal(h.network.status().directAccounts, 17);
});

test('concurrent first fetches register new accounts before sending without duplicating route setup', async () => {
  const h = harness(); await h.network.ready(h.accounts);
  const added = { id: 'new', partition: 'persist:caseclicker-new' };
  await Promise.all([h.network.fetch(added, '/api/me'), h.network.fetch(added, '/api/cases')]);
  assert.equal(h.network.groupAccounts('a0').includes('new'), true);
  assert.equal(h.network.status().directAccounts, 18);
  assert.equal(h.calls.filter(row => row.partition === added.partition).length, 2);
});
