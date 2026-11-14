# SQLite inventory journal prototype

The runtime uses its existing JSON journal. The prototype in [`tauri/scripts`](../tauri/scripts/inventory-sqlite-store.cjs) imports a static v1 JSON snapshot into a separate SQLite file using one transaction for the schema, records, and version marker. It preserves record order and the last value for duplicate operation IDs. Preview lookup returns the earliest matching operation, including after an update. The original snapshot stays available for recovery.

```sh
node --test tauri/runtime/tests/inventory-sqlite-store.test.cjs
node tauri/scripts/benchmark-inventory-journal.cjs .
```

The benchmark creates and removes a synthetic journal in the directory supplied on the command line. Run it on the target filesystem to include storage latency. These measurements used Node 24.18.0 on Linux with a Btrfs worktree, five warmups, and 30 samples per operation. The SQLite measurements include a committed write with WAL and `synchronous=FULL`. The JSON writer uses a temporary file and rename without an explicit `fsync`.

| Records | JSON update median / p95 | SQLite update median / p95 | JSON full read median | SQLite full read median |
| ---: | ---: | ---: | ---: | ---: |
| 1,000 | 5.5 / 8.3 ms | 2.8 / 3.6 ms | 10.4 ms | 6.1 ms |
| 10,000 | 48.6 / 79.8 ms | 3.2 / 13.5 ms | 107.1 ms | 65.4 ms |
| 50,000 | 369.0 / 914.1 ms | 10.8 / 32.8 ms | 656.0 ms | 403.4 ms |

At 50,000 records, importing the snapshot took 3.01 s. Opening the migrated database took 0.65 ms before reading any records. Median operation ID lookups took about 0.013 ms for either store. Preview lookup near the end of the journal took 2.17 ms with the existing cached scan and 0.014 ms with the SQLite index.

The inventory action service currently reads the entire journal during synchronization. The prototype also uses synchronous SQLite on the Node worker's event loop. Before integrating it into the desktop runtime, measure end-to-end action latency on Linux and macOS and determine which reads can use an index or incremental refresh while preserving item reservations and duplicate dispatch prevention. Confirm cutover and recovery from the last JSON snapshot before enabling migration on a user profile.
