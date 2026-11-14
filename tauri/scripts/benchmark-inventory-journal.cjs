const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { createInventoryOperationStore } = require('../runtime/engine/inventoryOperationStore.cjs');
const { createSqliteInventoryOperationStore } = require('./inventory-sqlite-store.cjs');

const sizes = [1_000, 10_000, 50_000];
const warmups = 5;
const samples = 30;

function makeRecord(index) {
  const itemId = index.toString(16).padStart(24, '0');
  const ref = { accountId: 'fixture-account', itemId, storageUnitId: null, page: 1, name: 'Fixture item' };
  const item = { id: itemId, name: ref.name, price: 5, isFavorite: false };
  return {
    operationId: `operation-${index}`,
    previewId: `preview-${index}`,
    kind: 'sell',
    ref,
    item,
    request: { kind: 'sell', ref },
    reviewedItem: item,
    accountId: ref.accountId,
    state: 'unconfirmed',
    stage: 'sending',
    location: 'inventory',
    locationAccountId: ref.accountId,
    sourceIdentity: 'fixture-identity',
    createdAt: '2026-01-01T00:00:00.000Z',
    verified: false,
  };
}

async function measure(work) {
  const durations = [];
  for (let i = -warmups; i < samples; i++) {
    const start = performance.now();
    await work(i + warmups);
    if (i >= 0) durations.push(performance.now() - start);
  }
  durations.sort((a, b) => a - b);
  const median = (durations[samples / 2 - 1] + durations[samples / 2]) / 2;
  return { medianMs: median, p95Ms: durations[Math.ceil(samples * 0.95) - 1] };
}

async function benchmark(directory, count) {
  const records = Array.from({ length: count }, (_, index) => makeRecord(index));
  const legacyFilePath = path.join(directory, `operations-${count}.json`);
  const filePath = path.join(directory, `operations-${count}.sqlite`);
  await fs.writeFile(legacyFilePath, JSON.stringify({ version: 1, records }), { mode: 0o600 });
  const json = createInventoryOperationStore({ filePath: legacyFilePath });
  const sqlite = createSqliteInventoryOperationStore({ filePath, legacyFilePath });
  try {
    let start = performance.now();
    await json.load();
    const jsonLoadMs = performance.now() - start;
    start = performance.now();
    await sqlite.load();
    const sqliteMigrationMs = performance.now() - start;
    sqlite.close();
    start = performance.now();
    await sqlite.load();
    const sqliteReopenMs = performance.now() - start;
    const recordAt = index => records[count - 1 - index];
    const update = (store, index) => store.put({ ...recordAt(index), state: 'confirmed', verified: true });
    const cachedRecords = new Map(records.map(record => [record.operationId, record]));
    return {
      records: count,
      jsonLoadMs,
      sqliteMigrationMs,
      sqliteReopenMs,
      jsonUpdate: await measure(index => update(json, index)),
      sqliteUpdate: await measure(index => update(sqlite, index)),
      jsonOperationLookup: await measure(index => json.get(recordAt(index).operationId)),
      sqliteOperationLookup: await measure(index => sqlite.get(recordAt(index).operationId)),
      cachedPreviewLookup: await measure(index => {
        const { previewId } = recordAt(index);
        return [...cachedRecords.values()].find(record => record.previewId === previewId);
      }),
      sqlitePreviewLookup: await measure(index => sqlite.getByPreview(recordAt(index).previewId)),
      jsonList: await measure(() => json.list()),
      sqliteList: await measure(() => sqlite.list()),
    };
  } finally {
    sqlite.close();
  }
}

async function main() {
  const tempRoot = path.resolve(process.argv[2] ?? os.tmpdir());
  const directory = await fs.mkdtemp(path.join(tempRoot, 'altcrate-inventory-benchmark-'));
  try {
    const results = [];
    for (const count of sizes) results.push(await benchmark(directory, count));
    console.log(JSON.stringify({ node: process.version, platform: process.platform, tempRoot, samples, warmups, results }, null, 2));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
