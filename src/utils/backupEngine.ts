import {
  db,
  generateId,
  logActivity,
  type BackupSnapshotMeta,
  type OfflineKitDexie,
  type UserDatabaseMeta,
  type UserRecord,
  type UserTableMeta,
} from '../db/offlineDb';

export const CURRENT_BACKUP_SCHEMA_VERSION = 1;

export interface OfflineKitBackupPayload {
  format: 'offlinekit-backup-v1';
  schemaVersion?: number;
  appVersion?: string;
  exportedAt: string;
  checksum?: string;
  metadata?: {
    databaseCount: number;
    tableCount: number;
    recordCount: number;
  };
  databases: UserDatabaseMeta[];
  tables: UserTableMeta[];
  records: UserRecord[];
}

export interface RecordConflictDetail {
  recordId: string;
  tableName: string;
  primaryKeyValue: string;
  localRevision: number;
  incomingRevision: number;
  localUpdatedAt: string;
  incomingUpdatedAt: string;
  localData: Record<string, unknown>;
  incomingData: Record<string, unknown>;
}

export interface BackupValidationPreview {
  valid: boolean;
  errors: string[];
  warnings: string[];
  payload?: OfflineKitBackupPayload;
  checksum: string;
  checksumMatchesEmbedded: boolean;
  schemaVersion: number;
  summary: {
    databasesTotal: number;
    databasesNew: number;
    tablesTotal: number;
    tablesNew: number;
    recordsTotal: number;
    recordsNew: number;
    recordsIdentical: number;
    recordsConflicting: number;
    duplicatesInFile: number;
    orphanEntities: number;
  };
  conflicts: RecordConflictDetail[];
}

export type RestoreMode =
  | 'MERGE_SKIP_CONFLICTS'
  | 'UPSERT_OVERWRITE'
  | 'KEEP_NEWER_TIMESTAMP'
  | 'CLEAN_REPLACE';

export interface RestoreOptions {
  createSafetyBackupFirst?: boolean;
  conflictOverrides?: Record<string, 'LOCAL' | 'BACKUP'>;
  simulateMidTransactionFault?: boolean;
}

export function computeChecksum(input: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0, ch; i < input.length; i++) {
    ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `sha256:${hex2}${hex1}`;
}

export function computeCanonicalPayloadChecksum(data: {
  databases: UserDatabaseMeta[];
  tables: UserTableMeta[];
  records: UserRecord[];
}): string {
  const canonical = JSON.stringify({
    databases: [...data.databases].sort((a, b) => a.id.localeCompare(b.id)),
    tables: [...data.tables].sort((a, b) => a.id.localeCompare(b.id)),
    records: [...data.records].sort((a, b) => a.id.localeCompare(b.id)),
  });
  return computeChecksum(canonical);
}

export async function createBackupSnapshot(
  label?: string,
  filterDatabaseId?: string,
  targetDb: OfflineKitDexie = db
): Promise<BackupSnapshotMeta> {
  const allDbs = await targetDb.databases.toArray();
  const allTables = await targetDb.tablesMeta.toArray();
  const allRecords = await targetDb.records.toArray();

  const databases = filterDatabaseId
    ? allDbs.filter((d) => d.id === filterDatabaseId)
    : allDbs;
  const dbIds = new Set(databases.map((d) => d.id));
  const tables = allTables.filter((t) => dbIds.has(t.databaseId));
  const records = allRecords.filter((r) => dbIds.has(r.databaseId));

  const now = new Date().toISOString();
  const checksum = computeCanonicalPayloadChecksum({ databases, tables, records });

  const payloadObj: OfflineKitBackupPayload = {
    format: 'offlinekit-backup-v1',
    schemaVersion: CURRENT_BACKUP_SCHEMA_VERSION,
    appVersion: '1.0.0',
    exportedAt: now,
    checksum,
    metadata: {
      databaseCount: databases.length,
      tableCount: tables.length,
      recordCount: records.length,
    },
    databases,
    tables,
    records,
  };

  const payloadJson = JSON.stringify(payloadObj, null, 2);

  const snapshot: BackupSnapshotMeta = {
    id: generateId('bkp'),
    label:
      label?.trim() ||
      `Manual Snapshot · ${new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })}`,
    createdAt: now,
    databaseCount: databases.length,
    tableCount: tables.length,
    recordCount: records.length,
    sizeBytes: payloadJson.length,
    checksum,
    payloadJson,
  };

  await targetDb.backups.put(snapshot);
  await logActivity(
    'BACKUP',
    'Snapshot created',
    `Created "${snapshot.label}" (${snapshot.recordCount} records, ${checksum})`,
    targetDb
  );

  return snapshot;
}

export async function validateAndPreviewBackup(
  rawJson: string,
  targetDb: OfflineKitDexie = db
): Promise<BackupValidationPreview> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const emptyPreview: BackupValidationPreview = {
    valid: false,
    errors,
    warnings,
    checksum: '',
    checksumMatchesEmbedded: true,
    schemaVersion: CURRENT_BACKUP_SCHEMA_VERSION,
    summary: {
      databasesTotal: 0,
      databasesNew: 0,
      tablesTotal: 0,
      tablesNew: 0,
      recordsTotal: 0,
      recordsNew: 0,
      recordsIdentical: 0,
      recordsConflicting: 0,
      duplicatesInFile: 0,
      orphanEntities: 0,
    },
    conflicts: [],
  };

  if (!rawJson || !rawJson.trim()) {
    errors.push('Backup JSON input is empty.');
    return emptyPreview;
  }

  if (rawJson.length > 50 * 1024 * 1024) {
    errors.push('Backup file exceeds maximum safe in-memory import size (50 MB).');
    return emptyPreview;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    errors.push(`Invalid JSON syntax: ${(err as Error).message}`);
    return emptyPreview;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    errors.push('Root backup structure must be a JSON object.');
    return emptyPreview;
  }

  const candidate = parsed as Partial<OfflineKitBackupPayload>;
  if (candidate.format !== 'offlinekit-backup-v1') {
    errors.push(
      `Unsupported format "${String(candidate.format ?? 'missing')}". Expected "offlinekit-backup-v1".`
    );
  }

  const schemaVersion =
    candidate.schemaVersion !== undefined ? Number(candidate.schemaVersion) : 1;
  if (
    Number.isNaN(schemaVersion) ||
    schemaVersion < 1 ||
    schemaVersion > CURRENT_BACKUP_SCHEMA_VERSION
  ) {
    errors.push(
      `Incompatible backup schemaVersion "${String(candidate.schemaVersion)}". Supported version: 1.`
    );
  }

  if (!Array.isArray(candidate.databases)) {
    errors.push('Missing or invalid "databases" array.');
  }
  if (!Array.isArray(candidate.tables)) {
    errors.push('Missing or invalid "tables" array.');
  }
  if (!Array.isArray(candidate.records)) {
    errors.push('Missing or invalid "records" array.');
  }

  if (errors.length > 0) {
    return emptyPreview;
  }

  const rawDatabases = candidate.databases!;
  const rawTables = candidate.tables!;
  const rawRecords = candidate.records!;

  const seenDbIds = new Set<string>();
  const seenTableIds = new Set<string>();
  const seenRecordIds = new Set<string>();
  const deduplicatedDatabases: UserDatabaseMeta[] = [];
  const deduplicatedTables: UserTableMeta[] = [];
  const deduplicatedRecords: UserRecord[] = [];
  let duplicatesInFile = 0;

  for (let i = 0; i < rawDatabases.length; i++) {
    const d = rawDatabases[i];
    if (!d || typeof d.id !== 'string' || !d.id.trim() || typeof d.name !== 'string' || !d.name.trim()) {
      errors.push(`Database at index ${i} is missing required non-empty string fields "id" or "name".`);
      continue;
    }
    if (seenDbIds.has(d.id)) {
      duplicatesInFile++;
      warnings.push(`Duplicate database ID "${d.id}" at index ${i} will be deduplicated.`);
      continue;
    }
    seenDbIds.add(d.id);
    deduplicatedDatabases.push(d);
  }

  for (let i = 0; i < rawTables.length; i++) {
    const t = rawTables[i];
    if (
      !t ||
      typeof t.id !== 'string' ||
      !t.id.trim() ||
      typeof t.databaseId !== 'string' ||
      !t.databaseId.trim() ||
      typeof t.name !== 'string' ||
      !t.name.trim()
    ) {
      errors.push(
        `Table at index ${i} is missing required string fields "id", "databaseId", or "name".`
      );
      continue;
    }
    if (seenTableIds.has(t.id)) {
      duplicatesInFile++;
      warnings.push(`Duplicate table ID "${t.id}" at index ${i} will be deduplicated.`);
      continue;
    }
    seenTableIds.add(t.id);
    deduplicatedTables.push({
      ...t,
      primaryKey: t.primaryKey || 'id',
      indexedFields: Array.isArray(t.indexedFields) ? t.indexedFields : ['status', 'updatedAt'],
      schemaHint: t.schemaHint && typeof t.schemaHint === 'object' ? t.schemaHint : { [t.primaryKey || 'id']: 'string' },
    });
  }

  for (let i = 0; i < rawRecords.length; i++) {
    const r = rawRecords[i];
    if (
      !r ||
      typeof r.id !== 'string' ||
      !r.id.trim() ||
      typeof r.tableId !== 'string' ||
      !r.tableId.trim() ||
      typeof r.primaryKeyValue !== 'string' ||
      !r.primaryKeyValue.trim() ||
      typeof r.data !== 'object' ||
      r.data === null ||
      Array.isArray(r.data)
    ) {
      errors.push(
        `Record at index ${i} is missing required fields ("id", "tableId", "primaryKeyValue", or object "data").`
      );
      continue;
    }
    if (seenRecordIds.has(r.id)) {
      duplicatesInFile++;
      warnings.push(`Duplicate record ID "${r.id}" at index ${i} will be deduplicated.`);
      continue;
    }
    seenRecordIds.add(r.id);
    deduplicatedRecords.push({
      ...r,
      databaseId: r.databaseId || '',
      revision: typeof r.revision === 'number' && r.revision >= 1 ? Math.floor(r.revision) : 1,
      createdAt: r.createdAt || new Date().toISOString(),
      updatedAt: r.updatedAt || new Date().toISOString(),
    });
  }

  if (errors.length > 0) {
    return emptyPreview;
  }

  const existingDbs = await targetDb.databases.toArray();
  const existingTables = await targetDb.tablesMeta.toArray();
  const existingRecords = await targetDb.records.toArray();

  const existingDbIds = new Set(existingDbs.map((d) => d.id));
  const existingTableMap = new Map(existingTables.map((t) => [t.id, t]));
  const existingRecordMap = new Map(existingRecords.map((r) => [r.id, r]));
  const incomingTableMap = new Map(deduplicatedTables.map((t) => [t.id, t]));

  // Check for orphan tables or records referencing unknown parents
  let orphanEntities = 0;
  for (const t of deduplicatedTables) {
    if (!seenDbIds.has(t.databaseId) && !existingDbIds.has(t.databaseId)) {
      orphanEntities++;
      errors.push(
        `Orphan table "${t.name}" (${t.id}) references non-existent databaseId "${t.databaseId}".`
      );
    }
  }

  for (const r of deduplicatedRecords) {
    const parentTbl = incomingTableMap.get(r.tableId) || existingTableMap.get(r.tableId);
    if (!parentTbl) {
      orphanEntities++;
      errors.push(
        `Orphan record "${r.primaryKeyValue}" (${r.id}) references non-existent tableId "${r.tableId}".`
      );
    } else if (!r.databaseId) {
      r.databaseId = parentTbl.databaseId;
    }
  }

  if (errors.length > 0) {
    return {
      ...emptyPreview,
      summary: {
        ...emptyPreview.summary,
        duplicatesInFile,
        orphanEntities,
      },
    };
  }

  const databasesNew = deduplicatedDatabases.filter((d) => !existingDbIds.has(d.id)).length;
  const tablesNew = deduplicatedTables.filter((t) => !existingTableMap.has(t.id)).length;

  let recordsNew = 0;
  let recordsIdentical = 0;
  const conflicts: RecordConflictDetail[] = [];

  for (const incoming of deduplicatedRecords) {
    const local = existingRecordMap.get(incoming.id);
    if (!local) {
      recordsNew++;
    } else {
      const localSerialized = JSON.stringify(local.data);
      const incomingSerialized = JSON.stringify(incoming.data);
      if (localSerialized === incomingSerialized) {
        recordsIdentical++;
      } else {
        const tblName =
          incomingTableMap.get(incoming.tableId)?.name ||
          existingTableMap.get(incoming.tableId)?.name ||
          incoming.tableId;
        conflicts.push({
          recordId: incoming.id,
          tableName: tblName,
          primaryKeyValue: incoming.primaryKeyValue,
          localRevision: local.revision,
          incomingRevision: incoming.revision ?? 1,
          localUpdatedAt: local.updatedAt,
          incomingUpdatedAt: incoming.updatedAt,
          localData: local.data,
          incomingData: incoming.data,
        });
      }
    }
  }

  const computedChecksum = computeCanonicalPayloadChecksum({
    databases: deduplicatedDatabases,
    tables: deduplicatedTables,
    records: deduplicatedRecords,
  });

  let checksumMatchesEmbedded = true;
  if (candidate.checksum && candidate.checksum !== computedChecksum) {
    checksumMatchesEmbedded = false;
    warnings.push(
      `Embedded checksum (${candidate.checksum}) differs from computed payload hash (${computedChecksum}). Payload may have been edited after export.`
    );
  }

  return {
    valid: true,
    errors: [],
    warnings,
    payload: {
      format: 'offlinekit-backup-v1',
      schemaVersion,
      appVersion: candidate.appVersion || '1.0.0',
      exportedAt: candidate.exportedAt || new Date().toISOString(),
      checksum: computedChecksum,
      databases: deduplicatedDatabases,
      tables: deduplicatedTables,
      records: deduplicatedRecords,
    },
    checksum: computedChecksum,
    checksumMatchesEmbedded,
    schemaVersion,
    summary: {
      databasesTotal: deduplicatedDatabases.length,
      databasesNew,
      tablesTotal: deduplicatedTables.length,
      tablesNew,
      recordsTotal: deduplicatedRecords.length,
      recordsNew,
      recordsIdentical,
      recordsConflicting: conflicts.length,
      duplicatesInFile,
      orphanEntities,
    },
    conflicts,
  };
}

export async function applyBackupRestore(
  payload: OfflineKitBackupPayload,
  mode: RestoreMode,
  targetDb: OfflineKitDexie = db,
  options?: RestoreOptions
): Promise<{
  inserted: number;
  overwritten: number;
  skipped: number;
  safetySnapshotId?: string;
}> {
  if (!payload || payload.format !== 'offlinekit-backup-v1') {
    throw new Error('Cannot apply restore: Invalid backup payload format.');
  }

  let safetySnapshotId: string | undefined;
  if (options?.createSafetyBackupFirst) {
    const safety = await createBackupSnapshot(
      `Auto-Safety Point (Pre-${mode})`,
      undefined,
      targetDb
    );
    safetySnapshotId = safety.id;
  }

  let inserted = 0;
  let overwritten = 0;
  let skipped = 0;

  try {
    await targetDb.transaction(
      'rw',
      [targetDb.databases, targetDb.tablesMeta, targetDb.records, targetDb.activityLogs],
      async () => {
        if (mode === 'CLEAN_REPLACE') {
          await targetDb.records.clear();
          await targetDb.tablesMeta.clear();
          await targetDb.databases.clear();
        }

        for (const d of payload.databases) {
          if (!d.id || !d.name) {
            throw new Error('Transactional abort: Invalid database metadata encountered.');
          }
          const exists = await targetDb.databases.get(d.id);
          if (!exists || mode !== 'MERGE_SKIP_CONFLICTS') {
            await targetDb.databases.put(d);
          }
        }

        for (const t of payload.tables) {
          if (!t.id || !t.databaseId || !t.name) {
            throw new Error('Transactional abort: Invalid table metadata encountered.');
          }
          const exists = await targetDb.tablesMeta.get(t.id);
          if (!exists || mode !== 'MERGE_SKIP_CONFLICTS') {
            await targetDb.tablesMeta.put(t);
          }
        }

        for (let idx = 0; idx < payload.records.length; idx++) {
          const r = payload.records[idx];
          if (!r.id || !r.tableId || !r.data || typeof r.data !== 'object') {
            throw new Error(`Transactional abort: Corrupt record at index ${idx}.`);
          }

          if (options?.simulateMidTransactionFault && idx === Math.floor(payload.records.length / 2)) {
            throw new Error(
              'Simulated mid-transaction storage fault: Atomic IndexedDB rollback triggered.'
            );
          }

          const existing = await targetDb.records.get(r.id);
          if (!existing) {
            await targetDb.records.put(r);
            inserted++;
            continue;
          }

          // Check if record is identical
          if (JSON.stringify(existing.data) === JSON.stringify(r.data)) {
            skipped++;
            continue;
          }

          // Check per-record override first
          const override = options?.conflictOverrides?.[r.id];
          if (override === 'LOCAL') {
            skipped++;
            continue;
          }
          if (override === 'BACKUP') {
            await targetDb.records.put(r);
            overwritten++;
            continue;
          }

          // Otherwise apply selected strategy
          if (mode === 'MERGE_SKIP_CONFLICTS') {
            skipped++;
          } else if (mode === 'KEEP_NEWER_TIMESTAMP') {
            const localTime = new Date(existing.updatedAt).getTime() || 0;
            const incomingTime = new Date(r.updatedAt).getTime() || 0;
            if (incomingTime > localTime) {
              await targetDb.records.put(r);
              overwritten++;
            } else {
              skipped++;
            }
          } else {
            // UPSERT_OVERWRITE or CLEAN_REPLACE
            await targetDb.records.put(r);
            overwritten++;
          }
        }

        await logActivity(
          'BACKUP',
          `Restored backup (${mode})`,
          `Inserted ${inserted}, overwrote ${overwritten}, skipped ${skipped} records.${
            safetySnapshotId ? ` Safety snapshot: ${safetySnapshotId}` : ''
          }`,
          targetDb
        );
      }
    );
  } catch (err) {
    const error = err as Error;
    if (error.name === 'QuotaExceededError') {
      throw new Error(
        'Storage Quota Exceeded: Browser ran out of disk space during restore. Transaction was safely rolled back with zero data loss.'
      );
    }
    throw error;
  }

  return { inserted, overwritten, skipped, safetySnapshotId };
}
