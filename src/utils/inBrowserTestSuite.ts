import {
  OfflineKitDexie,
  db,
  createDatabase,
  updateDatabase,
  createTable,
  updateTableSchema,
  upsertRecord,
  deleteRecord,
  bulkDeleteRecords,
  queryRecords,
  logActivity,
} from '../db/offlineDb';
import {
  createBackupSnapshot,
  validateAndPreviewBackup,
  applyBackupRestore,
} from './backupEngine';

export interface TestCaseResult {
  id: string;
  category: 'CRUD' | 'PERSISTENCE' | 'BACKUP' | 'RESILIENCE';
  name: string;
  passed: boolean;
  durationMs: number;
  assertionDetail: string;
}

export interface ReloadPersistenceMarker {
  markerId: string;
  writtenAt: string;
  dbCountAtWrite: number;
  recordCountAtWrite: number;
  navigatorOnlineAtWrite: boolean;
}

const RELOAD_MARKER_STORAGE_KEY = 'offlinekit_reload_verification_marker_v1';

export async function writeReloadVerificationMarker(
  targetDb: OfflineKitDexie = db
): Promise<ReloadPersistenceMarker> {
  const [dbCount, recordCount] = await Promise.all([
    targetDb.databases.count(),
    targetDb.records.count(),
  ]);
  const marker: ReloadPersistenceMarker = {
    markerId: `probe_${Date.now().toString(36)}`,
    writtenAt: new Date().toISOString(),
    dbCountAtWrite: dbCount,
    recordCountAtWrite: recordCount,
    navigatorOnlineAtWrite: typeof navigator !== 'undefined' ? navigator.onLine : true,
  };
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(RELOAD_MARKER_STORAGE_KEY, JSON.stringify(marker));
  }
  await logActivity(
    'DIAGNOSTICS',
    'Wrote reload persistence marker',
    `Marker ${marker.markerId} recorded (${dbCount} DBs, ${recordCount} records). Reload page to verify persistence.`,
    targetDb
  );
  return marker;
}

export async function inspectReloadVerificationMarker(
  targetDb: OfflineKitDexie = db
): Promise<{
  marker: ReloadPersistenceMarker | null;
  verifiedInIndexedDb: boolean;
  currentDbCount: number;
  currentRecordCount: number;
}> {
  const [currentDbCount, currentRecordCount, logs] = await Promise.all([
    targetDb.databases.count(),
    targetDb.records.count(),
    targetDb.activityLogs.toArray(),
  ]);

  if (typeof localStorage === 'undefined') {
    return { marker: null, verifiedInIndexedDb: false, currentDbCount, currentRecordCount };
  }

  const raw = localStorage.getItem(RELOAD_MARKER_STORAGE_KEY);
  if (!raw) {
    return { marker: null, verifiedInIndexedDb: false, currentDbCount, currentRecordCount };
  }

  try {
    const marker = JSON.parse(raw) as ReloadPersistenceMarker;
    const foundInIdb = logs.some((l) => l.detail.includes(marker.markerId));
    return {
      marker,
      verifiedInIndexedDb: foundInIdb,
      currentDbCount,
      currentRecordCount,
    };
  } catch {
    return { marker: null, verifiedInIndexedDb: false, currentDbCount, currentRecordCount };
  }
}

export async function runInBrowserStorageTests(): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const sandboxDbName = `OfflineKit_TestSandbox_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;
  let sandbox = new OfflineKitDexie(sandboxDbName);

  const runCase = async (
    id: string,
    category: TestCaseResult['category'],
    name: string,
    fn: () => Promise<string>
  ) => {
    const t0 = performance.now();
    try {
      const detail = await fn();
      results.push({
        id,
        category,
        name,
        passed: true,
        durationMs: Math.max(1, Math.round(performance.now() - t0)),
        assertionDetail: detail,
      });
    } catch (err) {
      results.push({
        id,
        category,
        name,
        passed: false,
        durationMs: Math.max(1, Math.round(performance.now() - t0)),
        assertionDetail: (err as Error).message,
      });
    }
  };

  try {
    await sandbox.open();

    let createdDbId = '';
    let createdTableId = '';

    // 1. Database & Object Store Schema Creation + Metadata Update
    await runCase(
      'test_db_table_create',
      'CRUD',
      'Database & Object Store Creation + Metadata Update',
      async () => {
        const dbMeta = await createDatabase(
          { name: 'SandboxDB', description: 'Ephemeral test store', version: 1 },
          sandbox
        );
        createdDbId = dbMeta.id;

        const updatedDb = await updateDatabase(
          dbMeta.id,
          { version: 2, description: 'Updated test store' },
          sandbox
        );
        if (updatedDb.version !== 2) {
          throw new Error('Failed to update database version');
        }

        const tblMeta = await createTable(
          {
            databaseId: dbMeta.id,
            name: 'events',
            primaryKey: 'eventId',
            indexedFields: ['type', 'updatedAt'],
            schemaHint: { eventId: 'string', type: 'string', value: 'number' },
            strictSchema: false,
          },
          sandbox
        );
        createdTableId = tblMeta.id;
        if (tblMeta.primaryKey !== 'eventId') {
          throw new Error('Primary key mismatch');
        }
        return `Created SandboxDB (v2) and table "events" (pk: ${tblMeta.primaryKey})`;
      }
    );

    // 2. Record Create, Read, Update & Revision Increment
    await runCase(
      'test_record_crud_revisions',
      'CRUD',
      'Record Upsert, Revision Increment & Outbox Queueing',
      async () => {
        const r1 = await upsertRecord(
          {
            tableId: createdTableId,
            data: { eventId: 'EVT-01', type: 'SENSOR_PING', value: 42 },
            enqueueSync: true,
          },
          sandbox
        );
        const r2 = await upsertRecord(
          {
            tableId: createdTableId,
            data: { eventId: 'EVT-01', type: 'SENSOR_ACK', value: 84 },
            enqueueSync: true,
          },
          sandbox
        );
        await upsertRecord(
          {
            tableId: createdTableId,
            data: { eventId: 'EVT-02', type: 'SENSOR_PING', value: 19 },
            enqueueSync: false,
          },
          sandbox
        );
        const queued = await sandbox.syncQueue.count();
        if (r1.revision !== 1 || r2.revision !== 2 || queued !== 2) {
          throw new Error(
            `Unexpected state: rev1=${r1.revision}, rev2=${r2.revision}, queued=${queued}`
          );
        }
        return `Verified revision 1 → 2 increment and 2 outbox mutations queued`;
      }
    );

    // 3. Indexed Querying, Filtering, Sorting & Pagination
    await runCase(
      'test_search_filter_pagination',
      'CRUD',
      'Search, Field Filtering, Sorting & Pagination',
      async () => {
        const filtered = await queryRecords(
          {
            tableId: createdTableId,
            filterField: 'type',
            filterValue: 'SENSOR_ACK',
            sortBy: 'primaryKeyValue',
            sortDir: 'asc',
            page: 1,
            pageSize: 5,
          },
          sandbox
        );
        if (filtered.totalFiltered !== 1 || filtered.items[0].primaryKeyValue !== 'EVT-01') {
          throw new Error(`Expected 1 filtered record (EVT-01), got ${filtered.totalFiltered}`);
        }
        return `Filtered ${filtered.totalFiltered}/${filtered.totalInTable} records by field type="SENSOR_ACK"`;
      }
    );

    // 4. Strict Schema Enforcement Guard
    await runCase(
      'test_schema_validation',
      'RESILIENCE',
      'Strict Schema Field Type Validation Guard',
      async () => {
        await updateTableSchema(createdTableId, { strictSchema: true }, sandbox);
        let rejected = false;
        try {
          await upsertRecord(
            {
              tableId: createdTableId,
              data: { eventId: 'EVT-BAD', type: 'INVALID', value: 'not-a-number' },
            },
            sandbox
          );
        } catch {
          rejected = true;
        }
        await updateTableSchema(createdTableId, { strictSchema: false }, sandbox);
        if (!rejected) {
          throw new Error('Strict schema failed to reject mismatched number field');
        }
        return 'Rejected invalid record where number field "value" received string';
      }
    );

    // 5. Persistence Across Connection Close & Re-open
    await runCase(
      'test_persistence_reopen',
      'PERSISTENCE',
      'IndexedDB Persistence Across Connection Close & Re-open',
      async () => {
        sandbox.close();
        sandbox = new OfflineKitDexie(sandboxDbName);
        await sandbox.open();
        const persistedRec = await sandbox.records.get(`${createdTableId}::EVT-01`);
        if (!persistedRec || persistedRec.data.value !== 84) {
          throw new Error('Record EVT-01 did not survive IndexedDB connection close/reopen');
        }
        return `Closed & reopened "${sandboxDbName}"; verified EVT-01 (rev ${persistedRec.revision}) persisted`;
      }
    );

    // 6. Backup Export, Checksum & Conflict Resolution Strategies
    await runCase(
      'test_backup_conflict_detection',
      'BACKUP',
      'Backup Checksum, Diff Preview & Conflict Resolution Modes',
      async () => {
        const snap = await createBackupSnapshot('Test Snap', undefined, sandbox);
        // Modify local record to trigger a conflict against snapshot
        await upsertRecord(
          {
            tableId: createdTableId,
            data: { eventId: 'EVT-01', type: 'LOCAL_DIVERGENCE', value: 999 },
          },
          sandbox
        );
        const preview = await validateAndPreviewBackup(snap.payloadJson, sandbox);
        if (!preview.valid || preview.summary.recordsConflicting !== 1) {
          throw new Error('Failed to detect record conflict against snapshot');
        }

        // MERGE_SKIP_CONFLICTS preserves local value 999
        await applyBackupRestore(preview.payload!, 'MERGE_SKIP_CONFLICTS', sandbox);
        const afterMerge = await sandbox.records.get(`${createdTableId}::EVT-01`);
        if (afterMerge?.data.value !== 999) {
          throw new Error('MERGE_SKIP_CONFLICTS overwrote local record');
        }

        // UPSERT_OVERWRITE restores snapshot value 84
        await applyBackupRestore(preview.payload!, 'UPSERT_OVERWRITE', sandbox);
        const restored = await sandbox.records.get(`${createdTableId}::EVT-01`);
        if (restored?.data.value !== 84) {
          throw new Error('UPSERT_OVERWRITE did not restore expected value 84');
        }
        return `Verified ${snap.checksum}, MERGE_SKIP_CONFLICTS, and UPSERT_OVERWRITE`;
      }
    );

    // 7. Malformed Backup, Unsupported Version & Orphan Record Rejection
    await runCase(
      'test_schema_rejection',
      'BACKUP',
      'Corrupt JSON, Incompatible Version & Orphan Entity Guard',
      async () => {
        const badFormat = await validateAndPreviewBackup('{"format":"invalid-schema"}', sandbox);
        const futureVer = await validateAndPreviewBackup(
          JSON.stringify({
            format: 'offlinekit-backup-v1',
            schemaVersion: 999,
            databases: [],
            tables: [],
            records: [],
          }),
          sandbox
        );
        const orphanRec = await validateAndPreviewBackup(
          JSON.stringify({
            format: 'offlinekit-backup-v1',
            schemaVersion: 1,
            databases: [],
            tables: [],
            records: [
              {
                id: 'missing_tbl::1',
                databaseId: 'missing_db',
                tableId: 'missing_tbl',
                primaryKeyValue: '1',
                data: { a: 1 },
                revision: 1,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
          }),
          sandbox
        );
        if (badFormat.valid || futureVer.valid || orphanRec.valid) {
          throw new Error('Validator accepted malformed, future-version, or orphan backup');
        }
        return 'Rejected corrupt format, unsupported schemaVersion 999, and orphan record';
      }
    );

    // 8. Atomic Transaction Rollback on Mid-Restore Fault
    await runCase(
      'test_transaction_rollback',
      'RESILIENCE',
      'Atomic Transaction Rollback on Mid-Restore Storage Fault',
      async () => {
        const snap = await createBackupSnapshot('Rollback Baseline', undefined, sandbox);
        const preview = await validateAndPreviewBackup(snap.payloadJson, sandbox);
        const countBefore = await sandbox.records.count();

        let rolledBack = false;
        try {
          await applyBackupRestore(preview.payload!, 'CLEAN_REPLACE', sandbox, {
            simulateMidTransactionFault: true,
          });
        } catch {
          rolledBack = true;
        }

        const countAfter = await sandbox.records.count();
        if (!rolledBack || countAfter !== countBefore) {
          throw new Error(
            `Rollback failed: expected ${countBefore} records intact, found ${countAfter}`
          );
        }
        return `Aborted mid-transaction CLEAN_REPLACE fault; all ${countAfter} original records remained intact`;
      }
    );

    // 9. Bulk Record Deletion & Cleanup
    await runCase(
      'test_record_deletion',
      'CRUD',
      'Transactional Record & Bulk Deletion Cleanup',
      async () => {
        await deleteRecord(`${createdTableId}::EVT-01`, false, sandbox);
        await bulkDeleteRecords([`${createdTableId}::EVT-02`], false, sandbox);
        const count = await sandbox.records.where('databaseId').equals(createdDbId).count();
        if (count !== 0) {
          throw new Error(`Expected 0 records after delete, found ${count}`);
        }
        return 'Deleted records EVT-01 & EVT-02 and verified 0 orphan records remain';
      }
    );
  } finally {
    await sandbox.delete();
  }

  return results;
}
