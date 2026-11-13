const clickBudget = require('./clickBudget.cjs');

function parseRetryAfter(value, now = Date.now()) {
  const fallback = 300000;
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const trimmed = value.trim();
  let milliseconds;
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) milliseconds = Number(trimmed) * 1000;
  else {
    const date = Date.parse(trimmed);
    milliseconds = Number.isFinite(date) ? date - now : NaN;
  }
  if (!Number.isFinite(milliseconds)) return fallback;
  return Math.max(1000, Math.min(milliseconds, 24 * 60 * 60 * 1000));
}

function validateConfig(config) {
  if (!Array.isArray(config?.accounts) || config.accounts.length === 0 ||
      config.accounts.some((account) => typeof account?.id !== 'string') ||
      new Set(config.accounts.map((account) => account.id)).size !== config.accounts.length) {
    throw new Error('Seleciona contas válidas e diferentes');
  }
  for (const [key, min, max] of [
    ['clicks', 1, 1000], ['concurrency', 1, 20],
  ]) {
    if (!Number.isSafeInteger(config[key]) || config[key] < min || config[key] > max) {
      throw new Error(`${key}: escolhe um inteiro entre ${min} e ${max}`);
    }
  }
  if (config.continuous !== true && (!Number.isSafeInteger(config.maxRequests) || config.maxRequests < 1 || config.maxRequests > 100)) throw new Error('Número de pedidos inválido');
  if (config.adaptive !== true && (!Number.isSafeInteger(config.delayMs) || config.delayMs < 1000 || config.delayMs > 3600000)) throw new Error('Intervalo inválido');
  if (!['case', 'money'].includes(config.kind || 'case')) throw new Error('Tipo de clique inválido');
}

function createScheduler({ apiForAccount, now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), emit = () => {}, budgetStore = null, coordinator = null, accountQueue = null, defaultKind = 'case' }) {
  let phase = 'idle';
  let stopRequested = false;
  let cooldownUntil = 0;
  let sent = 0;
  let succeeded = 0;
  let failed = 0;
  let runPromise = null;
  let accountState = [];
  let intervalMs = 0;
  let successStreak = 0;
  let mode = 'bounded';
  let kind = defaultKind;
  let budgetState = {};
  let budgetWaitUntil = 0;

  const status = () => ({ phase, sent, succeeded, failed, cooldownUntil, budgetWaitUntil, intervalMs, mode, kind, accounts: accountState.map(({ account, attempts, disabled }) => ({ id: account.id, attempts, disabled })) });
  const publish = (event) => emit({ ...event, at: new Date(now()).toISOString(), status: status() });

  async function one(entry, clicks) {
    const api = apiForAccount(entry.account);
    let before = null;
    let after = null;
    let result = null;
    try {
      before = await api.snapshot();
      if (stopRequested) return;
      if (coordinator && (cooldownUntil = await coordinator.cooldown())) return;
      sent++;
      result = kind === 'money' ? await api.clickMoney(clicks) : await api.generate(clicks);
      if (result.status === 429) {
        cooldownUntil = Math.max(cooldownUntil, now() + parseRetryAfter(result.retryAfter, now()));
        if (coordinator) await coordinator.limit(cooldownUntil);
        if (budgetStore) { budgetState = clickBudget.afterLimit(budgetState, cooldownUntil); await budgetStore.save(budgetState); }
        if (mode === 'adaptive') { intervalMs = Math.min(60000, Math.max(250, Math.ceil(intervalMs * 2))); successStreak = 0; }
        publish({ type: 'cooldown', accountId: entry.account.id, until: cooldownUntil });
      } else if (result.status === 401 || result.status === 403) {
        entry.disabled = true;
        publish({ type: 'needs-login', accountId: entry.account.id });
      }
      try { after = await api.snapshot(); } catch { /* record the missing verification */ }
      if (result.ok) {
        succeeded++;
        if (mode === 'adaptive' && ++successStreak >= 20) {
          intervalMs = Math.max(0, Math.floor(intervalMs * 0.85));
          successStreak = 0;
          publish({ type: 'pace', intervalMs });
        }
      }
      else failed++;
      publish({
        type: 'request', kind, accountId: entry.account.id, clicks, httpStatus: result.status,
        awardedCount: Number(result.awardedCount || 0), caseName: String(result.caseName || ''),
        caseId: String(result.caseId || ''), message: String(result.message || '').slice(0, 180),
        before, after, verifiedDelta: before && after ? (kind === 'money' ? after.money - before.money : after.casesTotal - before.casesTotal) : null,
      });
    } catch (error) {
      failed++;
      if (error.status === 401 || error.status === 403) entry.disabled = true;
      else entry.disabled = true;
      publish({ type: 'account-error', accountId: entry.account.id, message: String(error.message || 'Erro de rede').slice(0, 180) });
    }
  }

  async function run(config) {
    kind = config.kind || 'case';
    if (budgetStore) budgetState = clickBudget.cleanState(await budgetStore.load());
    const entries = config.accounts.map((account) => ({ account, attempts: 0, disabled: false, busy: false }));
    accountState = entries;
    phase = 'running'; stopRequested = false; cooldownUntil = 0;
    sent = 0; succeeded = 0; failed = 0;
    mode = config.adaptive === true ? 'adaptive' : 'bounded';
    intervalMs = mode === 'adaptive' ? 0 : config.delayMs;
    successStreak = 0;
    budgetWaitUntil = 0;
    publish({ type: 'run-started' });
    let cursor = 0;
    let nextStart = now();
    const active = new Set();
    try {
      while (!stopRequested) {
        const pending = entries.some((entry) => !entry.disabled && (config.continuous === true || entry.attempts < config.maxRequests));
        if (!pending) break;
        if (cooldownUntil > now()) {
          await sleep(Math.min(1000, cooldownUntil - now()));
          continue;
        }
        if (coordinator || budgetStore) {
          const available = coordinator ? await coordinator.availability(kind) : clickBudget.availability(budgetState, kind, now());
          if (!coordinator) budgetState = available.state;
          if (!available.remaining && available.waitUntil !== budgetWaitUntil) {
            if (active.size) { await Promise.race(active); continue; }
            budgetWaitUntil = available.waitUntil;
            publish({ type: 'budget-wait', kind, until: budgetWaitUntil });
          } else budgetWaitUntil = available.waitUntil;
          if (!available.remaining) {
            await sleep(Math.min(1000, Math.max(1, available.waitUntil - now())));
            continue;
          }
        }
        if (active.size >= config.concurrency) {
          await Promise.race(active);
          continue;
        }
        if (nextStart > now()) {
          await sleep(Math.min(1000, nextStart - now()));
          continue;
        }
        let entry = null;
        for (let offset = 0; offset < entries.length; offset++) {
          const index = (cursor + offset) % entries.length;
          const candidate = entries[index];
          if (!candidate.busy && !candidate.disabled && (config.continuous === true || candidate.attempts < config.maxRequests)) {
            entry = candidate;
            cursor = (index + 1) % entries.length;
            break;
          }
        }
        if (!entry) {
          if (active.size) await Promise.race(active);
          else break;
          continue;
        }
        entry.busy = true;
        entry.attempts++;
        nextStart = now() + intervalMs;
        let actualClicks = config.clicks;
        if (coordinator || budgetStore) {
          const reservation = coordinator ? await coordinator.reserve(kind, config.clicks) : clickBudget.reserve(budgetState, kind, config.clicks, now());
          if (!coordinator) budgetState = reservation.state;
          actualClicks = reservation.clicks;
          budgetWaitUntil = reservation.waitUntil;
          if (budgetStore) await budgetStore.save(budgetState);
        }
        if (!actualClicks) { entry.busy = false; entry.attempts--; continue; }
        const task = (accountQueue ? accountQueue.run(entry.account.id, () => one(entry, actualClicks)) : one(entry, actualClicks)).finally(() => { entry.busy = false; active.delete(task); });
        active.add(task);
      }
      await Promise.allSettled(active);
    } finally {
      coordinator?.deactivate?.(kind);
      phase = stopRequested ? 'stopped' : 'complete';
      publish({ type: 'run-finished' });
      runPromise = null;
    }
    return status();
  }

  return {
    start(config) {
      if (runPromise) throw new Error('Já existe uma execução ativa');
      validateConfig(config);
      coordinator?.activate?.(config.kind || 'case');
      runPromise = run(config);
      return runPromise;
    },
    stop() { if (phase === 'running') { stopRequested = true; phase = 'stopping'; publish({ type: 'run-stopping' }); } return status(); },
    status,
  };
}
module.exports = { parseRetryAfter, createScheduler };
