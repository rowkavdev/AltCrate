export const OVERVIEW_REFRESH_MS = 5 * 60 * 1000;

// Scan only when inputs change or the next account becomes stale. No sorting or per-account timers.
export function planOverviewRefresh({ enabled = true, visible = true, online = true, loading = false, busy = false, running = false, paused = false, refreshStatus = {}, cooldownUntil = 0, accounts = [], snapshots = {}, now = Date.now(), maxAgeMs = OVERVIEW_REFRESH_MS } = {}) {
  const result = (phase, nextAt = null, targets = []) => ({ phase, nextAt, targets });
  if (!enabled || !online || loading || busy || running) return result('inactive');
  if (paused) return result('paused');
  if (['running', 'stopping'].includes(refreshStatus.phase)) return result('reading');
  if (!visible) return result('inactive');
  const until = Math.max(cooldownUntil || 0, refreshStatus.retryAt || 0);
  if (until > now) return result('waiting', until);
  if (refreshStatus.phase === 'paused' && refreshStatus.errorStatus !== 429) return result('paused');
  const targets = [];
  let nextAt = Infinity;
  for (const account of accounts) {
    if (account.session && (!account.session.reusable || account.session.validationPending)) continue;
    const snapshot = snapshots[account.id];
    if ([401, 403].includes(snapshot?.refreshError?.status)) continue;
    const observedAt = Date.parse(snapshot?.observedAt);
    const known = snapshot && !snapshot.error && ['money', 'tokens', 'casesTotal'].some(key => Number.isFinite(snapshot[key]));
    const error = snapshot?.refreshError;
    const errorDue = error ? error.status === 429 && error.retryAt > 0 ? error.retryAt : (error.at || now) + maxAgeMs : 0;
    const dueAt = Math.max(known && Number.isFinite(observedAt) && observedAt <= now + maxAgeMs ? observedAt + maxAgeMs : 0, errorDue, error?.retryAt || 0);
    if (dueAt <= now) targets.push(account);
    else nextAt = Math.min(nextAt, dueAt);
  }
  return targets.length ? result('due', now, targets) : result('scheduled', Number.isFinite(nextAt) ? nextAt : null);
}
