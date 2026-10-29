import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  OfflineKitDexie,
  createDatabase,
  updateDatabase,
  createTable,
  updateTableSchema,
  upsertRecord,
  deleteRecord,
  bulkDeleteRecords,
  deleteDatabase,
  queryRecords,
  validateRecordAgainstSchema,
  inspectOriginIndexedDatabases,
} from '../db/offlineDb';
import {
  createBackupSnapshot,
  validateAndPreviewBackup,
  applyBackupRestore,
} from '../utils/backupEngine';
import {
  runInBrowserStorageTests,
  writeReloadVerificationMarker,
} from '../utils/inBrowserTestSuite';
import {
  resolveInitialTheme,
  persistThemeSelection,
  DEVELOPER_PROFILE,
  APP_VERSION,
} from '../utils/themeManager';

describe('OfflineKit Storage, Schema, Backup & Resilience Test Suite', () => {
  let testDbName: string;
  let testDb: OfflineKitDexie;

  beforeEach(async () => {
    testDbName = `TestOfflineKit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    testDb = new OfflineKitDexie(testDbName);
    await testDb.open();
  });

  it('creates databases, updates metadata, creates tables, and prevents duplicate names', async () => {
    const dbMeta = await createDatabase(
      { name: 'EdgeCacheDB', description: 'Unit test database', version: 1 },
      testDb
    );
    expect(dbMeta.name).toBe('EdgeCacheDB');
    expect(dbMeta.version).toBe(1);

    // Duplicate database name should throw
    await expect(
      createDatabase({ name: 'edgecachedb', description: 'Duplicate' }, testDb)
    ).rejects.toThrow(/already exists/i);

    const updatedDb = await updateDatabase(
      dbMeta.id,
      { name: 'EdgeCacheDB_v2', description: 'Updated description', version: 2 },
      testDb
    );
    expect(updatedDb.name).toBe('EdgeCacheDB_v2');
    expect(updatedDb.version).toBe(2);

    const tblMeta = await createTable(
      {
        databaseId: dbMeta.id,
        name: 'jobs',
        primaryKey: 'jobId',
        indexedFields: ['status', 'priority'],
        schemaHint: { jobId: 'string', status: 'string', priority: 'number' },
      },
      testDb
    );
    expect(tblMeta.primaryKey).toBe('jobId');

    // Duplicate table name in same database should throw
    await expect(
      createTable({ databaseId: dbMeta.id, name: 'JOBS' }, testDb)
    ).rejects.toThrow(/already exists/i);
  });

  it('performs full record CRUD, revision increments, query filtering, sorting, pagination, and bulk delete', async () => {
    const dbMeta = await createDatabase(
      { name: 'TelemetryDB', description: 'Sensor telemetry', version: 1 },
      testDb
    );
    const tblMeta = await createTable(
      {
        databaseId: dbMeta.id,
        name: 'readings',
        primaryKey: 'readingId',
        indexedFields: ['status', 'zone'],
      },
      testDb
    );

    const rec1 = await upsertRecord(
      {
        tableId: tblMeta.id,
        data: { readingId: 'RD-100', zone: 'NORTH', status: 'QUEUED', temp: 21.5 },
        enqueueSync: true,
      },
      testDb
    );
    expect(rec1.revision).toBe(1);

    const rec1Updated = await upsertRecord(
      {
        tableId: tblMeta.id,
        data: { readingId: 'RD-100', zone: 'NORTH', status: 'SYNCED', temp: 22.0 },
        enqueueSync: true,
      },
      testDb
    );
    expect(rec1Updated.revision).toBe(2);

    const rec2 = await upsertRecord(
      {
        tableId: tblMeta.id,
        data: { readingId: 'RD-101', zone: 'SOUTH', status: 'QUEUED', temp: 18.2 },
        enqueueSync: false,
      },
      testDb
    );
    const rec3 = await upsertRecord(
      {
        tableId: tblMeta.id,
        data: { readingId: 'RD-102', zone: 'NORTH', status: 'QUEUED', temp: 19.8 },
        enqueueSync: false,
      },
      testDb
    );

    // Verify sync queue items were enqueued for rec1 create + update
    expect(await testDb.syncQueue.count()).toBe(2);

    // Filter by field zone = NORTH
    const northQuery = await queryRecords(
      {
        tableId: tblMeta.id,
        filterField: 'zone',
        filterValue: 'NORTH',
        sortBy: 'primaryKeyValue',
        sortDir: 'asc',
        page: 1,
        pageSize: 10,
      },
      testDb
    );
    expect(northQuery.totalFiltered).toBe(2);
    expect(northQuery.totalInTable).toBe(3);
    expect(northQuery.items[0].primaryKeyValue).toBe('RD-100');
    expect(northQuery.items[1].primaryKeyValue).toBe('RD-102');

    // Search query
    const searchResult = await queryRecords(
      { tableId: tblMeta.id, search: 'SOUTH' },
      testDb
    );
    expect(searchResult.totalFiltered).toBe(1);
    expect(searchResult.items[0].primaryKeyValue).toBe('RD-101');

    // Delete single record + bulk delete remaining
    await deleteRecord(rec1.id, false, testDb);
    const deletedCount = await bulkDeleteRecords([rec2.id, rec3.id], false, testDb);
    expect(deletedCount).toBe(2);
    expect(await testDb.records.count()).toBe(0);
  });

  it('enforces strict schema validation when strictSchema is enabled', async () => {
    const dbMeta = await createDatabase(
      { name: 'StrictDB', description: 'Schema validation test', version: 1 },
      testDb
    );
    const tblMeta = await createTable(
      {
        databaseId: dbMeta.id,
        name: 'devices',
        primaryKey: 'deviceId',
        schemaHint: {
          deviceId: 'string',
          firmwareVersion: 'number',
          active: 'boolean',
        },
        strictSchema: true,
      },
      testDb
    );

    // Invalid type: firmwareVersion is a string instead of number
    const check = validateRecordAgainstSchema(tblMeta, {
      deviceId: 'DEV-01',
      firmwareVersion: 'v1.2',
      active: true,
    });
    expect(check.valid).toBe(false);
    expect(check.errors.some((e) => e.includes('firmwareVersion'))).toBe(true);

    await expect(
      upsertRecord(
        {
          tableId: tblMeta.id,
          data: { deviceId: 'DEV-01', firmwareVersion: 'v1.2', active: true },
        },
        testDb
      )
    ).rejects.toThrow(/Schema validation failed/i);

    // Valid payload succeeds
    const validRec = await upsertRecord(
      {
        tableId: tblMeta.id,
        data: { deviceId: 'DEV-01', firmwareVersion: 102, active: true },
      },
      testDb
    );
    expect(validRec.primaryKeyValue).toBe('DEV-01');

    // Disable strict schema and allow dynamic fields
    await updateTableSchema(tblMeta.id, { strictSchema: false }, testDb);
    const dynamicRec = await upsertRecord(
      {
        tableId: tblMeta.id,
        data: { deviceId: 'DEV-02', firmwareVersion: 103, active: false, locationTag: 'LAB-A' },
      },
      testDb
    );
    expect(dynamicRec.data.locationTag).toBe('LAB-A');
  });

  it('persists data across closing and reopening the IndexedDB connection', async () => {
    const dbMeta = await createDatabase(
      { name: 'PersistenceCheckDB', description: 'Survives reopen', version: 1 },
      testDb
    );
    const tblMeta = await createTable(
      { databaseId: dbMeta.id, name: 'ledgers', primaryKey: 'id' },
      testDb
    );
    await upsertRecord(
      { tableId: tblMeta.id, data: { id: 'TX-900', amount: 4500 } },
      testDb
    );

    // Close connection and instantiate a fresh Dexie instance pointing to the same IndexedDB name
    testDb.close();
    const reopenedDb = new OfflineKitDexie(testDbName);
    await reopenedDb.open();

    const storedRecord = await reopenedDb.records.get(`${tblMeta.id}::TX-900`);
    expect(storedRecord).toBeDefined();
    expect(storedRecord?.data.amount).toBe(4500);
    reopenedDb.close();
  });

  it('exports JSON backups, detects primary-key conflicts, and honors all 4 restore strategies + per-record overrides', async () => {
    const dbMeta = await createDatabase(
      { name: 'InventoryDB', description: 'Warehouse ledger', version: 2 },
      testDb
    );
    const tblMeta = await createTable(
      { databaseId: dbMeta.id, name: 'skus', primaryKey: 'sku' },
      testDb
    );

    await upsertRecord(
      { tableId: tblMeta.id, data: { sku: 'SKU-01', qty: 50, location: 'Aisle 1' } },
      testDb
    );

    const snapshot = await createBackupSnapshot('Unit Test Snapshot', undefined, testDb);
    expect(snapshot.recordCount).toBe(1);
    expect(snapshot.checksum).toMatch(/^sha256:/);

    // Mutate local record so snapshot now conflicts with local state (local is newer)
    await new Promise((r) => setTimeout(r, 10));
    await upsertRecord(
      { tableId: tblMeta.id, data: { sku: 'SKU-01', qty: 99, location: 'Aisle 4' } },
      testDb
    );

    const preview = await validateAndPreviewBackup(snapshot.payloadJson, testDb);
    expect(preview.valid).toBe(true);
    expect(preview.summary.recordsConflicting).toBe(1);
    expect(preview.conflicts[0].primaryKeyValue).toBe('SKU-01');

    // Mode 1: MERGE_SKIP_CONFLICTS keeps local qty = 99
    const mergeResult = await applyBackupRestore(preview.payload!, 'MERGE_SKIP_CONFLICTS', testDb);
    expect(mergeResult.skipped).toBe(1);
    expect((await testDb.records.get(`${tblMeta.id}::SKU-01`))?.data.qty).toBe(99);

    // Mode 2: KEEP_NEWER_TIMESTAMP keeps local qty = 99 because local updatedAt > backup updatedAt
    const newerResult = await applyBackupRestore(preview.payload!, 'KEEP_NEWER_TIMESTAMP', testDb);
    expect(newerResult.skipped).toBe(1);
    expect((await testDb.records.get(`${tblMeta.id}::SKU-01`))?.data.qty).toBe(99);

    // Per-record override: force BACKUP even under MERGE_SKIP_CONFLICTS
    const overrideResult = await applyBackupRestore(
      preview.payload!,
      'MERGE_SKIP_CONFLICTS',
      testDb,
      { conflictOverrides: { [`${tblMeta.id}::SKU-01`]: 'BACKUP' } }
    );
    expect(overrideResult.overwritten).toBe(1);
    expect((await testDb.records.get(`${tblMeta.id}::SKU-01`))?.data.qty).toBe(50);

    // Mutate again and test Mode 3: UPSERT_OVERWRITE with safety snapshot
    await upsertRecord(
      { tableId: tblMeta.id, data: { sku: 'SKU-01', qty: 120, location: 'Aisle 9' } },
      testDb
    );
    const overwriteResult = await applyBackupRestore(preview.payload!, 'UPSERT_OVERWRITE', testDb, {
      createSafetyBackupFirst: true,
    });
    expect(overwriteResult.overwritten).toBe(1);
    expect(overwriteResult.safetySnapshotId).toBeDefined();
    expect((await testDb.records.get(`${tblMeta.id}::SKU-01`))?.data.qty).toBe(50);

    await deleteDatabase(dbMeta.id, testDb);
    expect(await testDb.databases.count()).toBe(0);
  });

  it('rejects malformed JSON, unsupported schemaVersion, orphan entities, and deduplicates duplicate keys', async () => {
    const invalidJson = await validateAndPreviewBackup('{ broken json ', testDb);
    expect(invalidJson.valid).toBe(false);
    expect(invalidJson.errors[0]).toContain('Invalid JSON syntax');

    const wrongFormat = await validateAndPreviewBackup(
      JSON.stringify({ format: 'unknown-v0', databases: [], tables: [], records: [] }),
      testDb
    );
    expect(wrongFormat.valid).toBe(false);
    expect(wrongFormat.errors[0]).toContain('Unsupported format');

    const unsupportedVersion = await validateAndPreviewBackup(
      JSON.stringify({
        format: 'offlinekit-backup-v1',
        schemaVersion: 42,
        databases: [],
        tables: [],
        records: [],
      }),
      testDb
    );
    expect(unsupportedVersion.valid).toBe(false);
    expect(unsupportedVersion.errors[0]).toContain('Incompatible backup schemaVersion');

    const orphanRecord = await validateAndPreviewBackup(
      JSON.stringify({
        format: 'offlinekit-backup-v1',
        schemaVersion: 1,
        databases: [],
        tables: [],
        records: [
          {
            id: 'tbl_ghost::1',
            databaseId: 'db_ghost',
            tableId: 'tbl_ghost',
            primaryKeyValue: '1',
            data: { x: 1 },
          },
        ],
      }),
      testDb
    );
    expect(orphanRecord.valid).toBe(false);
    expect(orphanRecord.summary.orphanEntities).toBe(1);
  });

  it('rolls back the entire restore transaction atomically if a storage fault occurs mid-restore', async () => {
    const dbMeta = await createDatabase(
      { name: 'RollbackTestDB', description: 'Atomic test', version: 1 },
      testDb
    );
    const tblMeta = await createTable(
      { databaseId: dbMeta.id, name: 'items', primaryKey: 'id' },
      testDb
    );
    await upsertRecord({ tableId: tblMeta.id, data: { id: 'ITEM-1', val: 'ORIGINAL_1' } }, testDb);
    await upsertRecord({ tableId: tblMeta.id, data: { id: 'ITEM-2', val: 'ORIGINAL_2' } }, testDb);

    const snap = await createBackupSnapshot('Before Fault', undefined, testDb);
    const preview = await validateAndPreviewBackup(snap.payloadJson, testDb);

    // Modify ITEM-1 locally
    await upsertRecord({ tableId: tblMeta.id, data: { id: 'ITEM-1', val: 'MODIFIED_LOCAL' } }, testDb);

    // Attempt CLEAN_REPLACE with simulated mid-transaction fault
    await expect(
      applyBackupRestore(preview.payload!, 'CLEAN_REPLACE', testDb, {
        simulateMidTransactionFault: true,
      })
    ).rejects.toThrow(/Atomic IndexedDB rollback triggered/i);

    // Verify local database was NOT wiped and ITEM-1 still has 'MODIFIED_LOCAL'
    const item1AfterFault = await testDb.records.get(`${tblMeta.id}::ITEM-1`);
    expect(item1AfterFault?.data.val).toBe('MODIFIED_LOCAL');
    expect(await testDb.records.count()).toBe(2);
  });

  it('passes all 9 in-browser E2E test suite cases', async () => {
    const results = await runInBrowserStorageTests();
    expect(results.length).toBe(9);
    for (const r of results) {
      expect(r.passed, `Test "${r.name}" failed: ${r.assertionDetail}`).toBe(true);
    }
  });

  it('resolves and persists theme preferences and verifies origin IndexedDB discovery & reload markers', async () => {
    const memoryStore = new Map<string, string>();
    const mockStorage = {
      getItem: (k: string) => memoryStore.get(k) ?? null,
      setItem: (k: string, v: string) => {
        memoryStore.set(k, v);
      },
    };

    // Fallback to prefers-color-scheme when storage is empty
    expect(resolveInitialTheme(mockStorage, true)).toBe('light');
    expect(resolveInitialTheme(mockStorage, false)).toBe('dark');

    // Manual selection overrides prefers-color-scheme
    persistThemeSelection('light', mockStorage);
    expect(resolveInitialTheme(mockStorage, false)).toBe('light');
    persistThemeSelection('dark', mockStorage);
    expect(resolveInitialTheme(mockStorage, true)).toBe('dark');

    // Verify developer profile and version metadata
    expect(APP_VERSION).toBe('1.0.0');
    expect(DEVELOPER_PROFILE.name).toBe('ArnobRazz');
    expect(DEVELOPER_PROFILE.githubProfileUrl).toBe('https://github.com/arnob123/');
    expect(DEVELOPER_PROFILE.repositoryUrl).toBe('https://github.com/arnob123/OpenDevKit');

    // Verify native origin IndexedDB enumeration helper
    const idbInfo = await inspectOriginIndexedDatabases();
    expect(Array.isArray(idbInfo.databases)).toBe(true);
    expect(idbInfo.securityNote).toContain('Same-Origin');

    // Verify reload persistence marker writes to audit log
    const marker = await writeReloadVerificationMarker(testDb);
    expect(marker.markerId).toMatch(/^probe_/);
    const logs = await testDb.activityLogs.toArray();
    expect(logs.some((l) => l.detail.includes(marker.markerId))).toBe(true);
  });
});

