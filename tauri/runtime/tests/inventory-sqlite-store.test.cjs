const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');
const { createInventoryActions } = require('../engine/inventoryActions.cjs');
const { createInventoryOperationStore } = require('../engine/inventoryOperationStore.cjs');
const { inventoryFixture } = require('./helpers/inventory-fixture.cjs');
const { createSqliteInventoryOperationStore } = require('../../scripts/inventory-sqlite-store.cjs');

async function journal(t, records = []) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'altcrate-inventory-sqlite-'));
  const options = {
    filePath: path.join(directory, 'operations.sqlite'),
    legacyFilePath: path.join(directory, 'operations.json'),
  };
  const store = createSqliteInventoryOperationStore(options);
  t.after(async () => {
    store.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const legacy = JSON.stringify({ version: 1, records });
  await fs.writeFile(options.legacyFilePath, legacy, { mode: 0o600 });
  return { options, legacy, store };
}

test('SQLite migrates the same v1 records and keeps operation and preview lookups across reopening', async t => {
  const records = [
    { operationId: 'one', previewId: 'shared', state: 'running' },
    { operationId: 'two', previewId: 'shared', state: 'unresolved',
      resolution: { kind: 'unresolved-conversion', scope: { itemId: 'item', token: 'fixture-secret' } } },
    { operationId: 'one', previewId: 'shared', state: 'unconfirmed', stage: 'sending' },
    { operationId: 'unpaired\ud800', previewId: 'last\u0000preview' },
  ];
  const { options, legacy, store } = await journal(t, records);
  const baseline = createInventoryOperationStore({ filePath: options.legacyFilePath });
  assert.deepEqual(await store.list(), await baseline.list());
  assert.equal((await store.getByPreview('shared')).operationId, 'one');
  assert.equal((await store.getByPreview('last\u0000preview')).operationId, 'unpaired\ud800');
  assert.equal(await store.get('unpaired\ufffd'), undefined);
  assert.equal(await store.getByPreview('missing'), undefined);
  assert.equal((await fs.stat(options.filePath)).mode & 0o777, 0o600);

  const one = await store.get('one');
  one.previewId = 'changed';
  assert.equal((await store.get('one')).previewId, 'shared');
  await Promise.all([store.put(one), store.put({ operationId: 'four' })]);
  store.close();
  assert.equal(await fs.readFile(options.legacyFilePath, 'utf8'), legacy);
  await fs.rm(options.legacyFilePath);
  assert.equal((await store.getByPreview('shared')).operationId, 'two');
  assert.deepEqual(await store.getByPreview('changed'), one);
  assert.deepEqual((await store.list()).map(record => record.operationId), ['one', 'two', 'unpaired\ud800', 'four']);
});

test('an interrupted SQLite migration rolls back its first record and can be retried', async t => {
  const { options, legacy, store } = await journal(t, [{ operationId: 'one' }, { operationId: 'two' }]);
  const child = spawnSync(process.execPath, ['-e', `
    const { DatabaseSync } = require('node:sqlite');
    const prepare = DatabaseSync.prototype.prepare;
    DatabaseSync.prototype.prepare = function (sql) {
      const statement = prepare.call(this, sql);
      if (sql.includes('INSERT INTO inventory_operations')) {
        const run = statement.run.bind(statement);
        statement.run = (...args) => {
          run(...args);
          process.kill(process.pid, 'SIGKILL');
        };
      }
      return statement;
    };
    const { createSqliteInventoryOperationStore } = require(process.argv[1]);
    createSqliteInventoryOperationStore(JSON.parse(process.argv[2])).load();
  `, require.resolve('../../scripts/inventory-sqlite-store.cjs'), JSON.stringify(options)], { timeout: 10000 });
  assert.ifError(child.error);
  assert.equal(child.signal, 'SIGKILL', child.stderr.toString());

  const afterCrash = new DatabaseSync(options.filePath);
  try {
    assert.equal(afterCrash.prepare('PRAGMA user_version').get().user_version, 0);
    assert.equal(afterCrash.prepare("SELECT name FROM sqlite_schema WHERE name = 'inventory_operations'").get(), undefined);
  } finally {
    afterCrash.close();
  }
  assert.deepEqual((await store.list()).map(record => record.operationId), ['one', 'two']);
  assert.equal(await fs.readFile(options.legacyFilePath, 'utf8'), legacy);
});

test('a corrupt legacy snapshot fails without marking the SQLite migration complete', async t => {
  const { options, legacy, store } = await journal(t, [{ operationId: 'one' }]);
  const invalid = JSON.stringify({ version: 1, records: [{ operationId: 'one' }, { operationId: 2 }] });
  await fs.writeFile(options.legacyFilePath, invalid);
  await assert.rejects(store.load());
  assert.equal(await fs.readFile(options.legacyFilePath, 'utf8'), invalid);
  await fs.writeFile(options.legacyFilePath, legacy);
  assert.deepEqual(await store.list(), [{ operationId: 'one' }]);
});

test('a rejected SQLite sending write stops the inventory request', async t => {
  const { options, store } = await journal(t);
  const fixture = await inventoryFixture(t);
  await store.load();
  const database = new DatabaseSync(options.filePath);
  try {
    database.exec(`
      CREATE TRIGGER reject_sending BEFORE UPDATE ON inventory_operations
      WHEN json_extract(NEW.payload, '$.stage') = 'sending'
      BEGIN SELECT RAISE(ABORT, 'Fixture disk write rejected'); END;
    `);
  } finally {
    database.close();
  }

  const service = createInventoryActions({ ...fixture.deps, store });
  const preview = await service.prepare({ kind: 'sell', ref: fixture.ref });
  const { operation } = await service.confirm(preview.previewId);
  assert.match(operation.message, /Fixture disk write rejected/);
  assert.equal(fixture.state.mutations.length, 0);
});

test('a sent SQLite operation remains reserved and cannot dispatch again after reopening', async t => {
  const { options, store } = await journal(t);
  const fixture = await inventoryFixture(t, { fail: 'after-send' });
  let previewId;
  let dispatchedRecord;
  const apiForAccount = account => {
    const api = fixture.deps.apiForAccount(account);
    return {
      ...api,
      async convertSkin(...args) {
        const observer = createSqliteInventoryOperationStore(options);
        try {
          dispatchedRecord = await observer.getByPreview(previewId);
        } finally {
          observer.close();
        }
        return api.convertSkin(...args);
      },
    };
  };
  const reopen = () => createInventoryActions({ ...fixture.deps, apiForAccount, store });
  const service = reopen();
  const preview = await service.prepare({ kind: 'convert', ref: fixture.ref });
  previewId = preview.previewId;
  const { operation } = await service.confirm(previewId);
  assert.equal(operation.state, 'unconfirmed');
  assert.equal(dispatchedRecord?.operationId, operation.operationId);
  assert.equal(dispatchedRecord.stage, 'sending');

  store.close();
  const restarted = reopen();
  const retry = await restarted.confirm(preview.previewId);
  assert.equal(retry.operation.operationId, operation.operationId);
  assert.equal(restarted.isItemReserved('source', fixture.ref.itemId), true);
  assert.equal(fixture.state.mutations.length, 1);
});
