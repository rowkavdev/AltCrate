export function observedSnapshot(snapshot, now = Date.now()) {
  const { error, refreshError, ...value } = snapshot || {};
  return { ...value, observedAt: new Date(now).toISOString() };
}
export function failedSnapshot(previous, error, now = Date.now()) {
  const message = String(error.message || error).replace(/^Error invoking remote method '[^']+': Error: /, '');
  const known = previous && ['money', 'tokens', 'casesTotal'].some(key => Number.isFinite(previous[key]));
  const refreshError = { message, status: Number(error.status) || 0, retryAt: Number(error.retryAt) || 0, at: now };
  return known ? { ...previous, refreshError } : { error: message, refreshError };
}
export function overviewReadings(accounts = [], snapshots = {}) {
  const fields = {money:{value:0,count:0},tokens:{value:0,count:0},casesTotal:{value:0,count:0}};
  let read = 0, failed = 0, connected = 0, latestAt = null;
  for (const account of accounts) {
    const snapshot = snapshots[account.id];
    if (account.session ? account.session.reusable && !account.session.validationPending : snapshot && !snapshot.error) connected++;
    if (snapshot?.refreshError || snapshot?.error) failed++;
    if (!snapshot || snapshot.error) continue;
    let known = false;
    for (const key of ['money', 'tokens', 'casesTotal']) if (Number.isFinite(snapshot[key])) {
      fields[key].value += snapshot[key]; fields[key].count++; known = true;
    }
    if (known) {
      read++;
      const at = Date.parse(snapshot.observedAt);
      if (Number.isFinite(at)) latestAt = Math.max(latestAt ?? at, at);
    }
  }
  return { fields, total: accounts.length, read, failed, connected, latestAt };
}
