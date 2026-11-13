function vaultDueAt(snapshot, nowMs) {
  const capacity = snapshot?.vaultCapacity;
  const rate = snapshot?.vaultMoneyPerMinute;
  const lastCollected = snapshot?.vaultLastCollected;
  if (typeof capacity !== 'number' || !Number.isFinite(capacity) || capacity <= 0 ||
      typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0 ||
      typeof lastCollected !== 'string' || !Number.isFinite(nowMs)) return null;
  const lastMs = Date.parse(lastCollected);
  if (!Number.isFinite(lastMs)) return null;
  const duration = Math.ceil(0.95 * capacity / rate * 60000);
  const due = lastMs + duration;
  return Number.isFinite(due) ? due : null;
}

function shouldCollectVault(snapshot, nowMs) {
  const due = vaultDueAt(snapshot, nowMs);
  return due !== null && nowMs >= due;
}

module.exports = { vaultDueAt, shouldCollectVault };
