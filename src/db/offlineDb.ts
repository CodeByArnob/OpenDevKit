import Dexie, { type Table } from 'dexie';

export type FieldType = 'string' | 'number' | 'boolean' | 'object' | 'array';

export interface UserDatabaseMeta {
  id: string;
  name: string;
  description: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface UserTableMeta {
  id: string;
  databaseId: string;
  name: string;
  primaryKey: string;
  indexedFields: string[];
  schemaHint: Record<string, FieldType>;
  strictSchema?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserRecord {
  id: string; // `${tableId}::${primaryKeyValue}`
  databaseId: string;
  tableId: string;
  primaryKeyValue: string;
  data: Record<string, unknown>;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export type SyncOperationType = 'INSERT' | 'UPDATE' | 'DELETE';
export type SyncItemStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED' | 'CONFLICT';
export type ConflictStrategy = 'LWW' | 'CLIENT_WINS' | 'SERVER_WINS' | 'MANUAL_MERGE';

export interface SyncQueueItem {
  id: string;
  databaseId: string;
  tableName: string;
  recordKey: string;
  operation: SyncOperationType;
  status: SyncItemStatus;
  clientPayload: Record<string, unknown>;
  serverPayload?: Record<string, unknown>;
  resolvedPayload?: Record<string, unknown>;
  resolutionStrategy?: ConflictStrategy;
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  clientTimestamp: string;
  serverTimestamp?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BackupSnapshotMeta {
  id: string;
  label: string;
  createdAt: string;
  databaseCount: number;
  tableCount: number;
  recordCount: number;
  sizeBytes: number;
  checksum: string;
  payloadJson: string;
}

export interface ActivityLogItem {
  id: string;
  category: 'DATABASE' | 'BACKUP' | 'SYNC' | 'DIAGNOSTICS' | 'SYSTEM';
  action: string;
  detail: string;
  timestamp: string;
}

export interface SchemaValidationReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface RecordQueryOptions {
  tableId: string;
  search?: string;
  filterField?: string;
  filterValue?: string;
  sortBy?: 'updatedAt' | 'primaryKeyValue' | 'revision';
  sortDir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface RecordQueryResult {
  items: UserRecord[];
  totalFiltered: number;
  totalInTable: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export class OfflineKitDexie extends Dexie {
  databases!: Table<UserDatabaseMeta, string>;
  tablesMeta!: Table<UserTableMeta, string>;
  records!: Table<UserRecord, string>;
  syncQueue!: Table<SyncQueueItem, string>;
  backups!: Table<BackupSnapshotMeta, string>;
  activityLogs!: Table<ActivityLogItem, string>;

  constructor(dbName = 'OfflineKitCoreDB') {
    super(dbName);
    this.version(1).stores({
      databases: 'id, name, updatedAt',
      tablesMeta: 'id, databaseId, name, [databaseId+name]',
      records: 'id, databaseId, tableId, primaryKeyValue, updatedAt, [tableId+primaryKeyValue]',
      syncQueue: 'id, databaseId, status, operation, createdAt',
      backups: 'id, createdAt',
      activityLogs: 'id, category, timestamp',
    });
  }
}

export const db = new OfflineKitDexie();

export function generateId(prefix = 'id'): string {
  const random =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().split('-')[0]
      : Math.random().toString(36).substring(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export function inferValueFieldType(val: unknown): FieldType {
  if (Array.isArray(val)) return 'array';
  if (val !== null && typeof val === 'object') return 'object';
  if (typeof val === 'number' && !Number.isNaN(val)) return 'number';
  if (typeof val === 'boolean') return 'boolean';
  return 'string';
}

export function validateRecordAgainstSchema(
  table: UserTableMeta,
  data: Record<string, unknown>
): SchemaValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    errors.push('Record payload must be a plain JSON object.');
    return { valid: false, errors, warnings };
  }

  const pkField = table.primaryKey;
  const rawPk = data[pkField];
  if (rawPk !== undefined && rawPk !== null) {
    if (typeof rawPk !== 'string' && typeof rawPk !== 'number') {
      errors.push(`Primary key "${pkField}" must be a string or number (received ${typeof rawPk}).`);
    } else if (String(rawPk).trim() === '') {
      errors.push(`Primary key "${pkField}" cannot be an empty string.`);
    }
  } else if (table.strictSchema) {
    errors.push(`Strict schema requires explicit primary key field "${pkField}".`);
  }

  const schemaEntries = Object.entries(table.schemaHint || {});
  for (const [field, expectedType] of schemaEntries) {
    if (field === pkField && (rawPk === undefined || rawPk === null)) {
      continue;
    }
    const val = data[field];
    if (val === undefined || val === null) {
      if (table.strictSchema && field !== pkField) {
        errors.push(`Missing required schema field "${field}" (expected ${expectedType}).`);
      }
      continue;
    }
    const actualType = inferValueFieldType(val);
    if (actualType !== expectedType) {
      const msg = `Field "${field}" expected type "${expectedType}", but received "${actualType}".`;
      if (table.strictSchema) {
        errors.push(msg);
      } else {
        warnings.push(msg);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export async function logActivity(
  category: ActivityLogItem['category'],
  action: string,
  detail: string,
  targetDb: OfflineKitDexie = db
): Promise<void> {
  const entry: ActivityLogItem = {
    id: generateId('act'),
    category,
    action,
    detail,
    timestamp: new Date().toISOString(),
  };
  await targetDb.activityLogs.put(entry);
  const count = await targetDb.activityLogs.count();
  if (count > 100) {
    const oldest = await targetDb.activityLogs.orderBy('timestamp').limit(count - 100).primaryKeys();
    await targetDb.activityLogs.bulkDelete(oldest);
  }
}

export async function createDatabase(
  input: { name: string; description: string; version?: number },
  targetDb: OfflineKitDexie = db
): Promise<UserDatabaseMeta> {
  const cleanName = input.name.trim();
  if (!cleanName) {
    throw new Error('Database name is required.');
  }
  if (!/^[a-zA-Z0-9_.\-\s]{2,64}$/.test(cleanName)) {
    throw new Error('Database name must be 2–64 characters (alphanumeric, spaces, hyphens, or underscores).');
  }
  const existing = await targetDb.databases
    .filter((d) => d.name.toLowerCase() === cleanName.toLowerCase())
    .first();
  if (existing) {
    throw new Error(`A database named "${cleanName}" already exists.`);
  }
  const now = new Date().toISOString();
  const meta: UserDatabaseMeta = {
    id: generateId('db'),
    name: cleanName,
    description: input.description.trim() || 'Local IndexedDB object store workspace',
    version: input.version && input.version > 0 ? Math.floor(input.version) : 1,
    createdAt: now,
    updatedAt: now,
  };
  await targetDb.databases.put(meta);
  await logActivity('DATABASE', 'Created database', `Created "${meta.name}" (v${meta.version})`, targetDb);
  return meta;
}

export async function updateDatabase(
  databaseId: string,
  updates: { name?: string; description?: string; version?: number },
  targetDb: OfflineKitDexie = db
): Promise<UserDatabaseMeta> {
  const existing = await targetDb.databases.get(databaseId);
  if (!existing) {
    throw new Error('Target database not found.');
  }
  const nextName = updates.name !== undefined ? updates.name.trim() : existing.name;
  if (!nextName) {
    throw new Error('Database name cannot be empty.');
  }
  if (nextName.toLowerCase() !== existing.name.toLowerCase()) {
    const conflict = await targetDb.databases
      .filter((d) => d.id !== databaseId && d.name.toLowerCase() === nextName.toLowerCase())
      .first();
    if (conflict) {
      throw new Error(`A database named "${nextName}" already exists.`);
    }
  }
  const now = new Date().toISOString();
  const updated: UserDatabaseMeta = {
    ...existing,
    name: nextName,
    description: updates.description !== undefined ? updates.description.trim() : existing.description,
    version:
      updates.version !== undefined && updates.version > 0
        ? Math.floor(updates.version)
        : existing.version,
    updatedAt: now,
  };
  await targetDb.databases.put(updated);
  await logActivity(
    'DATABASE',
    'Updated database metadata',
    `Updated "${updated.name}" (v${updated.version})`,
    targetDb
  );
  return updated;
}

export async function deleteDatabase(
  databaseId: string,
  targetDb: OfflineKitDexie = db
): Promise<void> {
  const existing = await targetDb.databases.get(databaseId);
  if (!existing) return;

  await targetDb.transaction(
    'rw',
    [targetDb.databases, targetDb.tablesMeta, targetDb.records, targetDb.syncQueue, targetDb.activityLogs],
    async () => {
      await targetDb.records.where('databaseId').equals(databaseId).delete();
      await targetDb.tablesMeta.where('databaseId').equals(databaseId).delete();
      await targetDb.syncQueue.where('databaseId').equals(databaseId).delete();
      await targetDb.databases.delete(databaseId);
      await logActivity(
        'DATABASE',
        'Deleted database',
        `Removed "${existing.name}" and all child tables/records`,
        targetDb
      );
    }
  );
}

export async function createTable(
  input: {
    databaseId: string;
    name: string;
    primaryKey?: string;
    indexedFields?: string[];
    schemaHint?: Record<string, FieldType>;
    strictSchema?: boolean;
  },
  targetDb: OfflineKitDexie = db
): Promise<UserTableMeta> {
  const cleanName = input.name.trim();
  if (!cleanName) {
    throw new Error('Table name is required.');
  }
  if (!/^[a-zA-Z0-9_.\-]{2,64}$/.test(cleanName)) {
    throw new Error('Table name must be 2–64 characters (letters, numbers, underscores, or hyphens).');
  }
  const parentDb = await targetDb.databases.get(input.databaseId);
  if (!parentDb) {
    throw new Error('Parent database does not exist.');
  }
  const existing = await targetDb.tablesMeta
    .where('databaseId')
    .equals(input.databaseId)
    .filter((t) => t.name.toLowerCase() === cleanName.toLowerCase())
    .first();

  if (existing) {
    throw new Error(`Table "${cleanName}" already exists in ${parentDb.name}.`);
  }

  const pk = (input.primaryKey || 'id').trim() || 'id';
  const now = new Date().toISOString();
  const defaultSchema: Record<string, FieldType> = input.schemaHint
    ? { ...input.schemaHint, [pk]: input.schemaHint[pk] || 'string' }
    : { [pk]: 'string', status: 'string', updatedAt: 'string' };

  const table: UserTableMeta = {
    id: generateId('tbl'),
    databaseId: input.databaseId,
    name: cleanName,
    primaryKey: pk,
    indexedFields: input.indexedFields?.length ? input.indexedFields : ['status', 'updatedAt'],
    schemaHint: defaultSchema,
    strictSchema: Boolean(input.strictSchema),
    createdAt: now,
    updatedAt: now,
  };

  await targetDb.tablesMeta.put(table);
  await targetDb.databases.update(input.databaseId, { updatedAt: now });
  await logActivity(
    'DATABASE',
    'Created table',
    `Added table "${cleanName}" (pk: ${pk}${table.strictSchema ? ', strict schema' : ''}) to ${parentDb.name}`,
    targetDb
  );
  return table;
}

export async function updateTableSchema(
  tableId: string,
  updates: {
    name?: string;
    indexedFields?: string[];
    schemaHint?: Record<string, FieldType>;
    strictSchema?: boolean;
  },
  targetDb: OfflineKitDexie = db
): Promise<UserTableMeta> {
  const existing = await targetDb.tablesMeta.get(tableId);
  if (!existing) {
    throw new Error('Target table not found.');
  }
  const nextName = updates.name !== undefined ? updates.name.trim() : existing.name;
  if (!nextName) {
    throw new Error('Table name cannot be empty.');
  }
  if (nextName.toLowerCase() !== existing.name.toLowerCase()) {
    const conflict = await targetDb.tablesMeta
      .where('databaseId')
      .equals(existing.databaseId)
      .filter((t) => t.id !== tableId && t.name.toLowerCase() === nextName.toLowerCase())
      .first();
    if (conflict) {
      throw new Error(`Table "${nextName}" already exists in this database.`);
    }
  }

  const now = new Date().toISOString();
  const nextSchemaHint = updates.schemaHint
    ? { ...updates.schemaHint, [existing.primaryKey]: updates.schemaHint[existing.primaryKey] || 'string' }
    : existing.schemaHint;

  const updated: UserTableMeta = {
    ...existing,
    name: nextName,
    indexedFields: updates.indexedFields !== undefined ? updates.indexedFields : existing.indexedFields,
    schemaHint: nextSchemaHint,
    strictSchema: updates.strictSchema !== undefined ? updates.strictSchema : existing.strictSchema,
    updatedAt: now,
  };

  await targetDb.tablesMeta.put(updated);
  await targetDb.databases.update(existing.databaseId, { updatedAt: now });
  await logActivity(
    'DATABASE',
    'Updated table schema',
    `Updated schema for "${updated.name}" (${Object.keys(updated.schemaHint).length} fields, strict=${Boolean(updated.strictSchema)})`,
    targetDb
  );
  return updated;
}

export async function deleteTable(
  tableId: string,
  targetDb: OfflineKitDexie = db
): Promise<void> {
  const tbl = await targetDb.tablesMeta.get(tableId);
  if (!tbl) return;
  await targetDb.transaction(
    'rw',
    [targetDb.tablesMeta, targetDb.records, targetDb.databases, targetDb.activityLogs],
    async () => {
      await targetDb.records.where('tableId').equals(tableId).delete();
      await targetDb.tablesMeta.delete(tableId);
      await targetDb.databases.update(tbl.databaseId, { updatedAt: new Date().toISOString() });
      await logActivity('DATABASE', 'Deleted table', `Dropped table "${tbl.name}" and its records`, targetDb);
    }
  );
}

export async function upsertRecord(
  input: {
    tableId: string;
    data: Record<string, unknown>;
    enqueueSync?: boolean;
  },
  targetDb: OfflineKitDexie = db
): Promise<UserRecord> {
  const tbl = await targetDb.tablesMeta.get(input.tableId);
  if (!tbl) {
    throw new Error('Target table not found.');
  }

  const validation = validateRecordAgainstSchema(tbl, input.data);
  if (!validation.valid) {
    throw new Error(`Schema validation failed: ${validation.errors.join(' ')}`);
  }

  const pkField = tbl.primaryKey;
  let pkValue = input.data[pkField];
  if (pkValue === undefined || pkValue === null || String(pkValue).trim() === '') {
    pkValue = generateId('rec');
  }
  const pkString = String(pkValue).trim();
  const compositeId = `${tbl.id}::${pkString}`;
  const existing = await targetDb.records.get(compositeId);
  const now = new Date().toISOString();

  const normalizedData: Record<string, unknown> = {
    ...input.data,
    [pkField]: pkValue,
  };

  // Auto-extend schemaHint with newly discovered fields when not in strict mode
  const nextSchemaHint: Record<string, FieldType> = { ...(tbl.schemaHint || {}) };
  let schemaChanged = false;
  if (!tbl.strictSchema) {
    for (const [k, v] of Object.entries(normalizedData)) {
      if (!nextSchemaHint[k] && v !== undefined && v !== null) {
        nextSchemaHint[k] = inferValueFieldType(v);
        schemaChanged = true;
      }
    }
  }

  const record: UserRecord = {
    id: compositeId,
    databaseId: tbl.databaseId,
    tableId: tbl.id,
    primaryKeyValue: pkString,
    data: normalizedData,
    revision: existing ? existing.revision + 1 : 1,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  };

  await targetDb.transaction(
    'rw',
    [targetDb.records, targetDb.tablesMeta, targetDb.databases, targetDb.syncQueue, targetDb.activityLogs],
    async () => {
      await targetDb.records.put(record);
      await targetDb.tablesMeta.update(tbl.id, {
        updatedAt: now,
        ...(schemaChanged ? { schemaHint: nextSchemaHint } : {}),
      });
      await targetDb.databases.update(tbl.databaseId, { updatedAt: now });

      if (input.enqueueSync) {
        const syncItem: SyncQueueItem = {
          id: generateId('sync'),
          databaseId: tbl.databaseId,
          tableName: tbl.name,
          recordKey: pkString,
          operation: existing ? 'UPDATE' : 'INSERT',
          status: 'PENDING',
          clientPayload: normalizedData,
          attempts: 0,
          maxAttempts: 3,
          clientTimestamp: now,
          createdAt: now,
          updatedAt: now,
        };
        await targetDb.syncQueue.put(syncItem);
      }

      await logActivity(
        'DATABASE',
        existing ? 'Updated record' : 'Inserted record',
        `${existing ? 'Updated' : 'Inserted'} key "${pkString}" in ${tbl.name} (rev ${record.revision})`,
        targetDb
      );
    }
  );

  return record;
}

export async function deleteRecord(
  recordId: string,
  enqueueSync = false,
  targetDb: OfflineKitDexie = db
): Promise<void> {
  const existing = await targetDb.records.get(recordId);
  if (!existing) return;
  const tbl = await targetDb.tablesMeta.get(existing.tableId);
  const now = new Date().toISOString();

  await targetDb.transaction(
    'rw',
    [targetDb.records, targetDb.tablesMeta, targetDb.databases, targetDb.syncQueue, targetDb.activityLogs],
    async () => {
      await targetDb.records.delete(recordId);
      if (tbl) {
        await targetDb.tablesMeta.update(tbl.id, { updatedAt: now });
        await targetDb.databases.update(tbl.databaseId, { updatedAt: now });
        if (enqueueSync) {
          await targetDb.syncQueue.put({
            id: generateId('sync'),
            databaseId: tbl.databaseId,
            tableName: tbl.name,
            recordKey: existing.primaryKeyValue,
            operation: 'DELETE',
            status: 'PENDING',
            clientPayload: { [tbl.primaryKey]: existing.primaryKeyValue, _deleted: true },
            attempts: 0,
            maxAttempts: 3,
            clientTimestamp: now,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      await logActivity(
        'DATABASE',
        'Deleted record',
        `Deleted key "${existing.primaryKeyValue}" from ${tbl?.name ?? 'table'}`,
        targetDb
      );
    }
  );
}

export async function bulkDeleteRecords(
  recordIds: string[],
  enqueueSync = false,
  targetDb: OfflineKitDexie = db
): Promise<number> {
  if (!recordIds.length) return 0;
  let deletedCount = 0;
  const now = new Date().toISOString();

  await targetDb.transaction(
    'rw',
    [targetDb.records, targetDb.tablesMeta, targetDb.databases, targetDb.syncQueue, targetDb.activityLogs],
    async () => {
      for (const id of recordIds) {
        const existing = await targetDb.records.get(id);
        if (!existing) continue;
        const tbl = await targetDb.tablesMeta.get(existing.tableId);
        await targetDb.records.delete(id);
        deletedCount++;
        if (tbl) {
          await targetDb.tablesMeta.update(tbl.id, { updatedAt: now });
          await targetDb.databases.update(tbl.databaseId, { updatedAt: now });
          if (enqueueSync) {
            await targetDb.syncQueue.put({
              id: generateId('sync'),
              databaseId: tbl.databaseId,
              tableName: tbl.name,
              recordKey: existing.primaryKeyValue,
              operation: 'DELETE',
              status: 'PENDING',
              clientPayload: { [tbl.primaryKey]: existing.primaryKeyValue, _deleted: true },
              attempts: 0,
              maxAttempts: 3,
              clientTimestamp: now,
              createdAt: now,
              updatedAt: now,
            });
          }
        }
      }

      if (deletedCount > 0) {
        await logActivity(
          'DATABASE',
          'Bulk deleted records',
          `Deleted ${deletedCount} record(s) in atomic transaction.`,
          targetDb
        );
      }
    }
  );

  return deletedCount;
}

export async function queryRecords(
  options: RecordQueryOptions,
  targetDb: OfflineKitDexie = db
): Promise<RecordQueryResult> {
  const allTableRecords = await targetDb.records.where('tableId').equals(options.tableId).toArray();
  const totalInTable = allTableRecords.length;

  let filtered = allTableRecords;

  if (options.filterField && options.filterValue !== undefined && options.filterValue !== '') {
    const field = options.filterField;
    const expected = options.filterValue;
    filtered = filtered.filter((r) => String(r.data[field] ?? '') === expected);
  }

  if (options.search && options.search.trim()) {
    const q = options.search.trim().toLowerCase();
    filtered = filtered.filter(
      (r) =>
        r.primaryKeyValue.toLowerCase().includes(q) ||
        JSON.stringify(r.data).toLowerCase().includes(q)
    );
  }

  const sortBy = options.sortBy || 'updatedAt';
  const sortDir = options.sortDir || 'desc';
  const dirMultiplier = sortDir === 'asc' ? 1 : -1;

  filtered.sort((a, b) => {
    if (sortBy === 'revision') {
      return (a.revision - b.revision) * dirMultiplier;
    }
    if (sortBy === 'primaryKeyValue') {
      return a.primaryKeyValue.localeCompare(b.primaryKeyValue, undefined, { numeric: true }) * dirMultiplier;
    }
    return a.updatedAt.localeCompare(b.updatedAt) * dirMultiplier;
  });

  const pageSize = Math.max(1, options.pageSize || 10);
  const totalFiltered = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const page = Math.min(Math.max(1, options.page || 1), totalPages);
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);

  return {
    items,
    totalFiltered,
    totalInTable,
    page,
    pageSize,
    totalPages,
  };
}

export async function ensureSeedData(targetDb: OfflineKitDexie = db): Promise<void> {
  const initializedFlag =
    typeof localStorage !== 'undefined' ? localStorage.getItem('offlinekit_seeded_v1') : null;
  const dbCount = await targetDb.databases.count();
  if (dbCount > 0 || initializedFlag === 'purged') {
    return;
  }

  await seedDemoEnvironment(targetDb);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('offlinekit_seeded_v1', 'true');
  }
}

export async function seedDemoEnvironment(targetDb: OfflineKitDexie = db): Promise<void> {
  const now = new Date();
  const iso = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();

  await targetDb.transaction(
    'rw',
    [targetDb.databases, targetDb.tablesMeta, targetDb.records, targetDb.syncQueue, targetDb.backups, targetDb.activityLogs],
    async () => {
      await targetDb.records.clear();
      await targetDb.tablesMeta.clear();
      await targetDb.databases.clear();
      await targetDb.syncQueue.clear();
      await targetDb.backups.clear();
      await targetDb.activityLogs.clear();

      const dbFieldOps: UserDatabaseMeta = {
        id: 'db_field_ops',
        name: 'FieldOps_EdgeDB',
        description: 'Offline-first turbine inspection & maintenance records with CRDT revision tracking.',
        version: 4,
        createdAt: iso(2880),
        updatedAt: iso(12),
      };

      const dbRetailPos: UserDatabaseMeta = {
        id: 'db_retail_pos',
        name: 'MobilePOS_Ledger',
        description: 'Local point-of-sale SKU catalog and store-and-forward offline receipt queue.',
        version: 2,
        createdAt: iso(1440),
        updatedAt: iso(45),
      };

      await targetDb.databases.bulkPut([dbFieldOps, dbRetailPos]);

      const tblInspections: UserTableMeta = {
        id: 'tbl_inspections',
        databaseId: dbFieldOps.id,
        name: 'turbine_inspections',
        primaryKey: 'inspectionId',
        indexedFields: ['status', 'sector', 'technician', 'updatedAt'],
        schemaHint: {
          inspectionId: 'string',
          sector: 'string',
          technician: 'string',
          status: 'string',
          vibrationMmS: 'number',
          passedSafety: 'boolean',
          notes: 'string',
        },
        strictSchema: false,
        createdAt: iso(2800),
        updatedAt: iso(12),
      };

      const tblSensors: UserTableMeta = {
        id: 'tbl_sensors',
        databaseId: dbFieldOps.id,
        name: 'telemetry_checkpoints',
        primaryKey: 'checkpointId',
        indexedFields: ['nodeId', 'batteryPct', 'synced'],
        schemaHint: {
          checkpointId: 'string',
          nodeId: 'string',
          batteryPct: 'number',
          tempCelsius: 'number',
          synced: 'boolean',
        },
        strictSchema: true,
        createdAt: iso(2400),
        updatedAt: iso(30),
      };

      const tblReceipts: UserTableMeta = {
        id: 'tbl_receipts',
        databaseId: dbRetailPos.id,
        name: 'offline_receipts',
        primaryKey: 'receiptId',
        indexedFields: ['terminalId', 'totalCents', 'status'],
        schemaHint: {
          receiptId: 'string',
          terminalId: 'string',
          totalCents: 'number',
          currency: 'string',
          status: 'string',
          itemsCount: 'number',
        },
        strictSchema: false,
        createdAt: iso(1400),
        updatedAt: iso(45),
      };

      await targetDb.tablesMeta.bulkPut([tblInspections, tblSensors, tblReceipts]);

      const sampleRecords: UserRecord[] = [
        {
          id: `${tblInspections.id}::INSP-9041`,
          databaseId: dbFieldOps.id,
          tableId: tblInspections.id,
          primaryKeyValue: 'INSP-9041',
          data: {
            inspectionId: 'INSP-9041',
            sector: 'North Sea Array B4',
            technician: 'Elena Rostova',
            status: 'COMPLETED',
            vibrationMmS: 1.84,
            passedSafety: true,
            notes: 'Blade pitch actuator calibrated offline during storm window.',
          },
          revision: 3,
          createdAt: iso(360),
          updatedAt: iso(12),
        },
        {
          id: `${tblInspections.id}::INSP-9042`,
          databaseId: dbFieldOps.id,
          tableId: tblInspections.id,
          primaryKeyValue: 'INSP-9042',
          data: {
            inspectionId: 'INSP-9042',
            sector: 'North Sea Array B7',
            technician: 'Marcus Vance',
            status: 'PENDING_REVIEW',
            vibrationMmS: 4.12,
            passedSafety: false,
            notes: 'High harmonic resonance detected on gearbox bearing #2.',
          },
          revision: 2,
          createdAt: iso(240),
          updatedAt: iso(28),
        },
        {
          id: `${tblInspections.id}::INSP-9043`,
          databaseId: dbFieldOps.id,
          tableId: tblInspections.id,
          primaryKeyValue: 'INSP-9043',
          data: {
            inspectionId: 'INSP-9043',
            sector: 'Coastal Substation C1',
            technician: 'Aria Chen',
            status: 'IN_PROGRESS',
            vibrationMmS: 2.05,
            passedSafety: true,
            notes: 'Thermal imaging captured locally; awaiting vessel uplink.',
          },
          revision: 1,
          createdAt: iso(110),
          updatedAt: iso(55),
        },
        {
          id: `${tblInspections.id}::INSP-9044`,
          databaseId: dbFieldOps.id,
          tableId: tblInspections.id,
          primaryKeyValue: 'INSP-9044',
          data: {
            inspectionId: 'INSP-9044',
            sector: 'Offshore Relay R9',
            technician: 'Devon Brooks',
            status: 'COMPLETED',
            vibrationMmS: 1.42,
            passedSafety: true,
            notes: 'Anemometer firmware patched via local diagnostic cable.',
          },
          revision: 4,
          createdAt: iso(420),
          updatedAt: iso(80),
        },
        {
          id: `${tblSensors.id}::CHK-301`,
          databaseId: dbFieldOps.id,
          tableId: tblSensors.id,
          primaryKeyValue: 'CHK-301',
          data: {
            checkpointId: 'CHK-301',
            nodeId: 'NODE-TURB-08',
            batteryPct: 94,
            tempCelsius: 41.6,
            synced: true,
          },
          revision: 1,
          createdAt: iso(190),
          updatedAt: iso(190),
        },
        {
          id: `${tblSensors.id}::CHK-302`,
          databaseId: dbFieldOps.id,
          tableId: tblSensors.id,
          primaryKeyValue: 'CHK-302',
          data: {
            checkpointId: 'CHK-302',
            nodeId: 'NODE-TURB-12',
            batteryPct: 68,
            tempCelsius: 53.2,
            synced: false,
          },
          revision: 2,
          createdAt: iso(95),
          updatedAt: iso(30),
        },
        {
          id: `${tblReceipts.id}::RCPT-7701`,
          databaseId: dbRetailPos.id,
          tableId: tblReceipts.id,
          primaryKeyValue: 'RCPT-7701',
          data: {
            receiptId: 'RCPT-7701',
            terminalId: 'POS-HANDHELD-04',
            totalCents: 14850,
            currency: 'USD',
            status: 'QUEUED_OFFLINE',
            itemsCount: 6,
          },
          revision: 1,
          createdAt: iso(60),
          updatedAt: iso(45),
        },
        {
          id: `${tblReceipts.id}::RCPT-7702`,
          databaseId: dbRetailPos.id,
          tableId: tblReceipts.id,
          primaryKeyValue: 'RCPT-7702',
          data: {
            receiptId: 'RCPT-7702',
            terminalId: 'POS-HANDHELD-04',
            totalCents: 6200,
            currency: 'USD',
            status: 'SETTLED_LOCAL',
            itemsCount: 2,
          },
          revision: 1,
          createdAt: iso(50),
          updatedAt: iso(40),
        },
      ];

      await targetDb.records.bulkPut(sampleRecords);

      const sampleSyncQueue: SyncQueueItem[] = [
        {
          id: 'sync_01_conflict',
          databaseId: dbFieldOps.id,
          tableName: 'turbine_inspections',
          recordKey: 'INSP-9042',
          operation: 'UPDATE',
          status: 'CONFLICT',
          clientPayload: {
            inspectionId: 'INSP-9042',
            sector: 'North Sea Array B7',
            technician: 'Marcus Vance',
            status: 'PENDING_REVIEW',
            vibrationMmS: 4.12,
            passedSafety: false,
            notes: 'Client offline edit: High harmonic resonance on bearing #2, lock-out tag applied.',
          },
          serverPayload: {
            inspectionId: 'INSP-9042',
            sector: 'North Sea Array B7',
            technician: 'Supervisor Dispatch',
            status: 'SCHEDULED_REPAIR',
            vibrationMmS: 3.95,
            passedSafety: false,
            notes: 'Remote dispatch edit: Assigned maintenance crew Bravo for tomorrow 06:00 UTC.',
          },
          attempts: 2,
          maxAttempts: 3,
          lastError: 'HTTP 409 Conflict: Remote revision (rev 3) diverges from base revision (rev 1).',
          clientTimestamp: iso(18),
          serverTimestamp: iso(14),
          createdAt: iso(25),
          updatedAt: iso(14),
        },
        {
          id: 'sync_02_pending',
          databaseId: dbFieldOps.id,
          tableName: 'telemetry_checkpoints',
          recordKey: 'CHK-302',
          operation: 'UPDATE',
          status: 'PENDING',
          clientPayload: {
            checkpointId: 'CHK-302',
            nodeId: 'NODE-TURB-12',
            batteryPct: 68,
            tempCelsius: 53.2,
            synced: false,
          },
          attempts: 0,
          maxAttempts: 3,
          clientTimestamp: iso(10),
          createdAt: iso(10),
          updatedAt: iso(10),
        },
        {
          id: 'sync_03_pending_pos',
          databaseId: dbRetailPos.id,
          tableName: 'offline_receipts',
          recordKey: 'RCPT-7701',
          operation: 'INSERT',
          status: 'PENDING',
          clientPayload: {
            receiptId: 'RCPT-7701',
            terminalId: 'POS-HANDHELD-04',
            totalCents: 14850,
            currency: 'USD',
            status: 'QUEUED_OFFLINE',
            itemsCount: 6,
          },
          attempts: 1,
          maxAttempts: 3,
          lastError: 'Simulated uplink timeout after 1500ms (queued for backoff retry)',
          clientTimestamp: iso(8),
          createdAt: iso(15),
          updatedAt: iso(8),
        },
      ];

      await targetDb.syncQueue.bulkPut(sampleSyncQueue);

      const initialBackupPayload = JSON.stringify(
        {
          format: 'offlinekit-backup-v1',
          schemaVersion: 1,
          appVersion: '1.0.0',
          exportedAt: iso(60),
          databases: [dbFieldOps, dbRetailPos],
          tables: [tblInspections, tblSensors, tblReceipts],
          records: sampleRecords,
        },
        null,
        2
      );

      await targetDb.backups.put({
        id: 'bkp_initial_seed',
        label: 'Auto-Snapshot · Pre-Flight Baseline',
        createdAt: iso(60),
        databaseCount: 2,
        tableCount: 3,
        recordCount: sampleRecords.length,
        sizeBytes: initialBackupPayload.length,
        checksum: 'sha256:9f84c2e1b7a0482d',
        payloadJson: initialBackupPayload,
      });

      await targetDb.activityLogs.bulkPut([
        {
          id: 'act_1',
          category: 'SYSTEM',
          action: 'Local-first storage mounted',
          detail: 'Initialized IndexedDB workspace with 2 databases and 8 records.',
          timestamp: iso(120),
        },
        {
          id: 'act_2',
          category: 'BACKUP',
          action: 'Baseline snapshot created',
          detail: 'Saved "Auto-Snapshot · Pre-Flight Baseline" (sha256:9f84c2e1b7a0482d).',
          timestamp: iso(60),
        },
        {
          id: 'act_3',
          category: 'SYNC',
          action: 'Revision conflict detected',
          detail: 'Key INSP-9042 in turbine_inspections flagged HTTP 409 Conflict.',
          timestamp: iso(14),
        },
        {
          id: 'act_4',
          category: 'DATABASE',
          action: 'Updated record',
          detail: 'Updated key "INSP-9041" in turbine_inspections (rev 3).',
          timestamp: iso(12),
        },
      ]);
    }
  );
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('offlinekit_seeded_v1', 'true');
  }
}

export async function purgeAllData(targetDb: OfflineKitDexie = db): Promise<void> {
  await targetDb.transaction(
    'rw',
    [targetDb.databases, targetDb.tablesMeta, targetDb.records, targetDb.syncQueue, targetDb.backups, targetDb.activityLogs],
    async () => {
      await targetDb.records.clear();
      await targetDb.tablesMeta.clear();
      await targetDb.databases.clear();
      await targetDb.syncQueue.clear();
      await targetDb.backups.clear();
      await targetDb.activityLogs.clear();
      await logActivity(
        'SYSTEM',
        'Purged all local data',
        'Cleared all databases, tables, records, sync queues, and backups.',
        targetDb
      );
    }
  );
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('offlinekit_seeded_v1', 'purged');
  }
}

export interface NativeOriginIdbInfo {
  supported: boolean;
  databases: { name: string; version: number }[];
  securityNote: string;
}

export async function inspectOriginIndexedDatabases(): Promise<NativeOriginIdbInfo> {
  if (
    typeof indexedDB === 'undefined' ||
    typeof indexedDB.databases !== 'function'
  ) {
    return {
      supported: false,
      databases: [{ name: 'OfflineKitCoreDB', version: 1 }],
      securityNote:
        'Browser does not expose indexedDB.databases() enumeration. Under Same-Origin Policy, only the active OfflineKitCoreDB instance is directly accessible.',
    };
  }
  try {
    const rawList = await indexedDB.databases();
    const list = (rawList || [])
      .filter((d): d is { name: string; version: number } => Boolean(d && d.name))
      .map((d) => ({ name: d.name, version: d.version ?? 1 }));
    return {
      supported: true,
      databases: list.length > 0 ? list : [{ name: 'OfflineKitCoreDB', version: 1 }],
      securityNote:
        'Browsers enforce strict Same-Origin Policy isolation: web apps can only inspect IndexedDB databases created on this exact origin (protocol + host + port) and can never access databases from other websites.',
    };
  } catch (err) {
    return {
      supported: false,
      databases: [{ name: 'OfflineKitCoreDB', version: 1 }],
      securityNote: `indexedDB.databases() restricted in this context (${(err as Error).message}).`,
    };
  }
}

