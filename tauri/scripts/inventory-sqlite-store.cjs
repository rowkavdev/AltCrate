const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const {
  cleanInventoryOperation,
  parseInventoryOperationJournal,
} = require('../runtime/engine/inventoryOperationStore.cjs');

const writeRecord = `
  INSERT INTO inventory_operations (operation_key, preview_key, payload)
  VALUES (?, ?, ?)
  ON CONFLICT (operation_key) DO UPDATE SET
    preview_key = excluded.preview_key, payload = excluded.payload
`;

function save(statement, record) {
  // JSON-encode index keys to preserve the exact strings accepted by the legacy format.
  const previewKey = typeof record.previewId === 'string' ? JSON.stringify(record.previewId) : null;
  statement.run(JSON.stringify(record.operationId), previewKey, JSON.stringify(record));
}

function migrate(database, legacyFilePath) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const { user_version: version } = database.prepare('PRAGMA user_version').get();
    if (version === 0) {
      const records = parseInventoryOperationJournal(fs.readFileSync(legacyFilePath, 'utf8'));
      database.exec(`
        CREATE TABLE inventory_operations (
          sequence INTEGER PRIMARY KEY,
          operation_key TEXT NOT NULL UNIQUE,
          preview_key TEXT,
          payload TEXT NOT NULL
        ) STRICT;
        CREATE INDEX inventory_preview_index ON inventory_operations (preview_key, sequence);
      `);
      const insert = database.prepare(writeRecord);
      for (const record of records.values()) save(insert, record);
      database.exec('PRAGMA user_version = 1');
    } else if (version !== 1) {
      throw Error(`Unsupported SQLite inventory journal version ${version}`);
    }
    database.exec('COMMIT');
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK');
    throw error;
  }
}

// Prototype for tests and benchmarks. Open a separate database from a static v1 snapshot.
function createSqliteInventoryOperationStore({ filePath, legacyFilePath }) {
  if (path.resolve(filePath) === path.resolve(legacyFilePath)) {
    throw Error('The SQLite database and legacy journal must use separate paths');
  }

  let database;
  let queries;
  function open() {
    if (database) return;
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    try {
      fs.closeSync(fs.openSync(filePath, 'wx', 0o600));
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = fs.lstatSync(filePath);
      if (!existing.isFile() || (existing.mode & 0o077) !== 0) {
        throw Error('The SQLite inventory journal requires a private regular file');
      }
    }

    const connection = new DatabaseSync(filePath, { timeout: 5000 });
    try {
      const { journal_mode: journalMode } = connection.prepare('PRAGMA journal_mode = WAL').get();
      if (journalMode !== 'wal') throw Error('The SQLite inventory journal requires WAL mode');
      connection.exec('PRAGMA synchronous = FULL');
      migrate(connection, legacyFilePath);
      queries = {
        put: connection.prepare(writeRecord),
        get: connection.prepare('SELECT payload FROM inventory_operations WHERE operation_key = ?'),
        getByPreview: connection.prepare(`
          SELECT payload FROM inventory_operations WHERE preview_key = ? ORDER BY sequence LIMIT 1
        `),
        list: connection.prepare('SELECT payload FROM inventory_operations ORDER BY sequence'),
      };
      database = connection;
    } catch (error) {
      connection.close();
      throw error;
    }
  }

  function find(query, key) {
    open();
    if (typeof key !== 'string') return undefined;
    const row = queries[query].get(JSON.stringify(key));
    return row ? JSON.parse(row.payload) : undefined;
  }

  return {
    async load() {
      open();
    },
    async list() {
      open();
      return queries.list.all().map(row => JSON.parse(row.payload));
    },
    async get(id) {
      return find('get', id);
    },
    async getByPreview(id) {
      return find('getByPreview', id);
    },
    async put(record) {
      open();
      if (typeof record?.operationId !== 'string' || !record.operationId) throw Error('Invalid inventory operation');
      save(queries.put, cleanInventoryOperation(record));
    },
    close() {
      database?.close();
      database = undefined;
      queries = undefined;
    },
  };
}

module.exports = { createSqliteInventoryOperationStore };
