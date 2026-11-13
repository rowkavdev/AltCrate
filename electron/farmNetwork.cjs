const { randomUUID, createHash } = require('node:crypto');
const { isIP } = require('node:net');

const ORIGIN = 'https://case-clicker.com';
function proxyRule(value) {
  try {
    if (typeof value !== 'string' || value.length > 100) return null;
    const url = new URL(value);
    if (!['http:', 'socks5:'].includes(url.protocol) || !isIP(url.hostname) || url.username || url.password ||
        !url.port || Number(url.port) < 1 || Number(url.port) > 65535 || !['', '/'].includes(url.pathname) || url.search || url.hash) return null;
    return `${url.protocol}//${url.hostname}:${url.port}`;
  } catch { return null; }
}

function createFarmNetwork({ readConfig, sessionForPartition, onAccountReady = async () => {} }) {
  if (typeof readConfig !== 'function' || typeof sessionForPartition !== 'function') throw TypeError('Configuração de ligações inválida');
  const assignments = new Map();
  const prepared = new Map();
  let membership = Promise.resolve();
  let initialized;
  let configured = false;
  let routes = [null];
  let unavailableProxies = 0;
  let membershipSize = 0;
  const routeKey = group => routes[group] ? `proxy-${createHash('sha256').update(routes[group]).digest('hex').slice(0,32)}` : 'direct';
  async function probe(rule) {
    const ses = sessionForPartition(`farm-route-probe-${randomUUID()}`);
    try {
      await ses.setProxy(rule ? { mode: 'fixed_servers', proxyRules: rule } : { mode: 'system' });
      const init = { credentials: 'omit', cache: 'no-store', redirect: 'error' };
      const trace = await ses.fetch(`${ORIGIN}/cdn-cgi/trace`, { ...init, signal: AbortSignal.timeout(10000) });
      const body = await trace.text();
      const ip = body.length < 4096 ? body.split('\n').find(row => row.startsWith('ip='))?.slice(3).trim() : null;
      if (trace.status !== 200 || !isIP(ip || '') || trace.headers.get('cf-mitigated') === 'challenge') return null;
      if (rule) {
        const root = await ses.fetch(`${ORIGIN}/`, { ...init, signal: AbortSignal.timeout(10000) });
        await root.text();
        if (root.status !== 200 || root.headers.get('cf-mitigated') === 'challenge') return null;
      }
      return ip;
    } catch { return null; }
    finally { await ses.closeAllConnections().catch(() => {}); }
  }
  async function verifiedProbe(rule) {
    // Public, credential-free checks only. Never retry authenticated mutations.
    return await probe(rule) || await probe(rule);
  }
  function prepareAccount(account) {
    if (prepared.has(account.id)) return prepared.get(account.id);
    const counts = routes.map((_, group) => [...assignments.values()].filter(value => value === group).length);
    const first = configured && routes.length - 1 >= Math.max(membershipSize, assignments.size + 1) ? 1 : 0;
    const availableCounts = counts.slice(first);
    const group = first + availableCounts.indexOf(Math.min(...availableCounts));
    assignments.set(account.id, group);
    const task = (async () => {
      const ses = sessionForPartition(account.partition);
      await ses.setProxy(routes[group] ? { mode: 'fixed_servers', proxyRules: routes[group] } : { mode: 'system' });
      await ses.closeAllConnections();
      await onAccountReady(account.id,routeKey(group));
    })().catch(error => { assignments.delete(account.id); prepared.delete(account.id); throw error; });
    prepared.set(account.id, task);
    return task;
  }
  function ready(accounts) {
    if (!initialized) initialized = (async () => {
      const config = await readConfig();
      configured = config?.enabled === true;
      if (configured) {
        const input = Array.isArray(config.proxies) ? config.proxies.slice(0, 51) : [];
        const rules = [...new Set(input.map(proxyRule).filter(Boolean))];
        unavailableProxies = input.length - rules.length;
        const baseline = await verifiedProbe(null);
        if (!baseline) { unavailableProxies += rules.length; return; }
        const candidates = new Array(rules.length);
        let next = 0;
        async function worker() {
          while (next < rules.length) {
            const index = next++;
            const rule = rules[index];
            candidates[index] = { rule, ip: await verifiedProbe(rule) };
          }
        }
        await Promise.all([worker(), worker()]);
        const seen = new Set(baseline ? [baseline] : []);
        for (const candidate of candidates) {
          if (!baseline || !candidate.ip || seen.has(candidate.ip)) { unavailableProxies++; continue; }
          seen.add(candidate.ip); routes.push(candidate.rule);
        }
      }
    })();
    // Reconcile membership after imports/removals; existing sessions retain
    // their route and accepted reservations. New accounts join a real group.
    const task = membership.catch(() => {}).then(async () => {
      await initialized;
      const ids = new Set(accounts.map(account => account.id));
      membershipSize = ids.size;
      for (const id of assignments.keys()) if (!ids.has(id)) { assignments.delete(id); prepared.delete(id); }
      await Promise.all(accounts.map(prepareAccount));
    });
    membership = task;
    return task;
  }
  return {
    ready,
    status() {
      const groups = [...assignments.values()];
      return { configured, connections: routes.length, directAccounts: groups.filter(group => group === 0).length,
        proxiedAccounts: groups.filter(group => group > 0).length, unavailableProxies };
    },
    groupAccounts(accountId) {
      const group = assignments.get(accountId);
      if (group === undefined) return [accountId];
      return [...assignments].filter(([, value]) => value === group).map(([id]) => id);
    },
    groupKey(accountId) { return routeKey(assignments.get(accountId) ?? 0); },
    async fetch(account, endpoint, init = {}) {
      if (!initialized) throw Error('Ligações ainda não preparadas');
      await initialized;
      const target = new URL(endpoint, ORIGIN);
      if (typeof endpoint !== 'string' || !endpoint.startsWith('/api/') || target.origin !== ORIGIN || !target.pathname.startsWith('/api/')) throw TypeError('Endpoint de farm inválido');
      await prepareAccount(account);
      const timeout = AbortSignal.timeout(12000);
      const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
      // In particular, do not retry an uncertain POST on a different IP.
      return sessionForPartition(account.partition).fetch(target.href, { ...init, redirect: 'error', signal });
    },
  };
}
module.exports = { createFarmNetwork };
