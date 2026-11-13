const test = require('node:test');
const assert = require('node:assert/strict');
const { vaultDueAt, shouldCollectVault } = require('../electron/vaultPolicy.cjs');

test('vault becomes due when 95 percent of capacity has accrued', () => {
  const last = Date.parse('2026-10-09T10:00:00.000Z');
  const snapshot = { vaultCapacity: 1060, vaultMoneyPerMinute: 77, vaultLastCollected: new Date(last).toISOString() };
  const due = last + Math.ceil(0.95 * 1060 / 77 * 60000);
  assert.equal(vaultDueAt(snapshot, last), due);
  assert.equal(shouldCollectVault(snapshot, due - 1), false);
  assert.equal(shouldCollectVault(snapshot, due), true);
});

test('invalid vault state never schedules a collection', () => {
  const now = Date.parse('2026-10-09T10:00:00.000Z');
  for (const snapshot of [null, {}, { vaultCapacity: 0, vaultMoneyPerMinute: 77, vaultLastCollected: new Date(now).toISOString() }, { vaultCapacity: 100, vaultMoneyPerMinute: -1, vaultLastCollected: new Date(now).toISOString() }, { vaultCapacity: 100, vaultMoneyPerMinute: 10, vaultLastCollected: 'not-a-date' }]) {
    assert.equal(vaultDueAt(snapshot, now), null);
    assert.equal(shouldCollectVault(snapshot, now), false);
  }
});

test('a future last-collection time cannot make the vault due early', () => {
  const now = Date.parse('2026-10-09T10:00:00.000Z');
  const snapshot = { vaultCapacity: 100, vaultMoneyPerMinute: 10, vaultLastCollected: new Date(now + 60000).toISOString() };
  assert.equal(shouldCollectVault(snapshot, now), false);
  assert.ok(vaultDueAt(snapshot, now) > now);
});
