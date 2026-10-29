import React, { useState, useMemo, useEffect } from 'react';
import {
  Database,
  Plus,
  Trash2,
  Search,
  Edit3,
  Eye,
  ChevronLeft,
  ChevronRight,
  Table as TableIcon,
  Check,
  Copy,
  X,
  AlertTriangle,
  FileJson,
  Send,
  Filter,
  ArrowUpDown,
  SlidersHorizontal,
  ShieldCheck,
  Code2,
  ListFilter,
  RefreshCw,
} from 'lucide-react';
import {
  createDatabase,
  updateDatabase,
  deleteDatabase,
  createTable,
  updateTableSchema,
  deleteTable,
  upsertRecord,
  deleteRecord,
  bulkDeleteRecords,
  validateRecordAgainstSchema,
  inspectOriginIndexedDatabases,
  type NativeOriginIdbInfo,
  type FieldType,
  type UserDatabaseMeta,
  type UserTableMeta,
  type UserRecord,
} from '../db/offlineDb';

interface DatabaseExplorerViewProps {
  databases: UserDatabaseMeta[];
  tables: UserTableMeta[];
  records: UserRecord[];
  selectedDbId: string | null;
  onSelectDbId: (id: string | null) => void;
  onRefresh: () => Promise<void>;
  onOpenBackupModal: () => void;
}

const FIELD_TYPES: FieldType[] = ['string', 'number', 'boolean', 'object', 'array'];

export const DatabaseExplorerView: React.FC<DatabaseExplorerViewProps> = ({
  databases,
  tables,
  records,
  selectedDbId,
  onSelectDbId,
  onRefresh,
  onOpenBackupModal,
}) => {
  const activeDb = useMemo(
    () => databases.find((d) => d.id === selectedDbId) ?? databases[0] ?? null,
    [databases, selectedDbId]
  );

  const dbTables = useMemo(
    () => (activeDb ? tables.filter((t) => t.databaseId === activeDb.id) : []),
    [tables, activeDb]
  );

  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);

  useEffect(() => {
    if (dbTables.length > 0 && (!selectedTableId || !dbTables.some((t) => t.id === selectedTableId))) {
      setSelectedTableId(dbTables[0].id);
    } else if (dbTables.length === 0) {
      setSelectedTableId(null);
    }
  }, [dbTables, selectedTableId]);

  const activeTable = useMemo(
    () => dbTables.find((t) => t.id === selectedTableId) ?? dbTables[0] ?? null,
    [dbTables, selectedTableId]
  );

  // Search, Filter, Sort & Pagination State
  const [searchQuery, setSearchQuery] = useState('');
  const [filterField, setFilterField] = useState<string>('');
  const [filterValue, setFilterValue] = useState<string>('');
  const [sortBy, setSortBy] = useState<'updatedAt' | 'primaryKeyValue' | 'revision'>('updatedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);

  // Bulk Selection State
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([]);

  useEffect(() => {
    setPage(1);
    setSelectedRecordIds([]);
  }, [activeTable?.id, searchQuery, filterField, filterValue, sortBy, sortDir, pageSize]);

  useEffect(() => {
    setFilterField('');
    setFilterValue('');
  }, [activeTable?.id]);

  // All records belonging to activeTable
  const allTableRecords = useMemo(() => {
    if (!activeTable) return [];
    return records.filter((r) => r.tableId === activeTable.id);
  }, [records, activeTable]);

  // Available filterable fields and distinct values for the active table
  const availableFilterFields = useMemo(() => {
    if (!activeTable) return [];
    const fieldSet = new Set<string>([
      ...activeTable.indexedFields,
      ...Object.keys(activeTable.schemaHint || {}),
    ]);
    fieldSet.delete(activeTable.primaryKey);
    return Array.from(fieldSet);
  }, [activeTable]);

  const distinctFieldValues = useMemo(() => {
    if (!filterField) return [];
    const vals = new Set<string>();
    for (const r of allTableRecords) {
      const v = r.data[filterField];
      if (v !== undefined && v !== null && typeof v !== 'object') {
        vals.add(String(v));
      }
    }
    return Array.from(vals).slice(0, 30);
  }, [allTableRecords, filterField]);

  // Filtered + Sorted records
  const tableRecords = useMemo(() => {
    let list = [...allTableRecords];

    if (filterField && filterValue !== '') {
      list = list.filter((r) => String(r.data[filterField] ?? '') === filterValue);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (r) =>
          r.primaryKeyValue.toLowerCase().includes(q) ||
          JSON.stringify(r.data).toLowerCase().includes(q)
      );
    }

    const dirMultiplier = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      if (sortBy === 'revision') {
        return (a.revision - b.revision) * dirMultiplier;
      }
      if (sortBy === 'primaryKeyValue') {
        return a.primaryKeyValue.localeCompare(b.primaryKeyValue, undefined, { numeric: true }) * dirMultiplier;
      }
      return a.updatedAt.localeCompare(b.updatedAt) * dirMultiplier;
    });

    return list;
  }, [allTableRecords, filterField, filterValue, searchQuery, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(tableRecords.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedRecords = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return tableRecords.slice(start, start + pageSize);
  }, [tableRecords, currentPage, pageSize]);

  // Loading & Feedback State
  const [isMutating, setIsMutating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusToast, setStatusToast] = useState<string | null>(null);
  const [originIdbInfo, setOriginIdbInfo] = useState<NativeOriginIdbInfo | null>(null);

  useEffect(() => {
    inspectOriginIndexedDatabases().then(setOriginIdbInfo);
  }, [databases.length]);

  const showToast = (msg: string) => {
    setStatusToast(msg);
    setTimeout(() => setStatusToast(null), 3500);
  };

  // Create / Edit Database Modal State
  const [showDbModal, setShowDbModal] = useState(false);
  const [editingDb, setEditingDb] = useState<UserDatabaseMeta | null>(null);
  const [dbNameInput, setDbNameInput] = useState('');
  const [dbDescInput, setDbDescInput] = useState('');
  const [dbVersionInput, setDbVersionInput] = useState('1');

  // Create / Edit Table & Schema Modal State
  const [showTableModal, setShowTableModal] = useState(false);
  const [editingTable, setEditingTable] = useState<UserTableMeta | null>(null);
  const [tableNameInput, setTableNameInput] = useState('');
  const [tablePkInput, setTablePkInput] = useState('id');
  const [tableIndexesInput, setTableIndexesInput] = useState('status, updatedAt');
  const [tableStrictSchema, setTableStrictSchema] = useState(false);
  const [schemaFields, setSchemaFields] = useState<{ name: string; type: FieldType }[]>([
    { name: 'id', type: 'string' },
    { name: 'status', type: 'string' },
  ]);

  // Record Editor Modal State (Supports Form Builder + Raw JSON Editor)
  const [recordEditorOpen, setRecordEditorOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<UserRecord | null>(null);
  const [editorMode, setEditorMode] = useState<'form' | 'json'>('form');
  const [recordFormFields, setRecordFormFields] = useState<
    { key: string; type: FieldType; value: string }[]
  >([]);
  const [recordJsonInput, setRecordJsonInput] = useState('');
  const [enqueueToSyncLab, setEnqueueToSyncLab] = useState(true);

  const [inspectingRecord, setInspectingRecord] = useState<UserRecord | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState<{
    type: 'database' | 'table' | 'record' | 'bulk_records';
    id: string;
    label: string;
    ids?: string[];
  } | null>(null);

  // Open Create Database Modal
  const openCreateDatabaseModal = () => {
    setErrorMsg(null);
    setEditingDb(null);
    setDbNameInput('');
    setDbDescInput('');
    setDbVersionInput('1');
    setShowDbModal(true);
  };

  // Open Edit Database Modal
  const openEditDatabaseModal = (dbMeta: UserDatabaseMeta) => {
    setErrorMsg(null);
    setEditingDb(dbMeta);
    setDbNameInput(dbMeta.name);
    setDbDescInput(dbMeta.description);
    setDbVersionInput(String(dbMeta.version));
    setShowDbModal(true);
  };

  const handleSaveDatabase = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsMutating(true);
    try {
      if (editingDb) {
        const updated = await updateDatabase(editingDb.id, {
          name: dbNameInput,
          description: dbDescInput,
          version: Number(dbVersionInput) || editingDb.version,
        });
        await onRefresh();
        setShowDbModal(false);
        showToast(`Updated database "${updated.name}" (v${updated.version})`);
      } else {
        const created = await createDatabase({
          name: dbNameInput,
          description: dbDescInput,
          version: Number(dbVersionInput) || 1,
        });
        await onRefresh();
        onSelectDbId(created.id);
        setShowDbModal(false);
        showToast(`Created database "${created.name}"`);
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setIsMutating(false);
    }
  };

  // Open Create Table Modal
  const openCreateTableModal = () => {
    if (!activeDb) return;
    setErrorMsg(null);
    setEditingTable(null);
    setTableNameInput('');
    setTablePkInput('id');
    setTableIndexesInput('status, updatedAt');
    setTableStrictSchema(false);
    setSchemaFields([
      { name: 'id', type: 'string' },
      { name: 'status', type: 'string' },
      { name: 'notes', type: 'string' },
    ]);
    setShowTableModal(true);
  };

  // Open Edit Table / Schema Inspector Modal
  const openEditTableModal = (tbl: UserTableMeta) => {
    setErrorMsg(null);
    setEditingTable(tbl);
    setTableNameInput(tbl.name);
    setTablePkInput(tbl.primaryKey);
    setTableIndexesInput(tbl.indexedFields.join(', '));
    setTableStrictSchema(Boolean(tbl.strictSchema));
    const entries = Object.entries(tbl.schemaHint || {}).map(([name, type]) => ({
      name,
      type,
    }));
    setSchemaFields(
      entries.length > 0 ? entries : [{ name: tbl.primaryKey, type: 'string' }]
    );
    setShowTableModal(true);
  };

  const handleSaveTable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDb) return;
    setErrorMsg(null);
    setIsMutating(true);
    try {
      const indexedFields = tableIndexesInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const pk = (editingTable ? editingTable.primaryKey : tablePkInput.trim()) || 'id';
      const schemaHint: Record<string, FieldType> = { [pk]: 'string' };
      for (const f of schemaFields) {
        const cleanField = f.name.trim();
        if (cleanField) {
          schemaHint[cleanField] = f.type;
        }
      }

      if (editingTable) {
        const updated = await updateTableSchema(editingTable.id, {
          name: tableNameInput,
          indexedFields,
          schemaHint,
          strictSchema: tableStrictSchema,
        });
        await onRefresh();
        setShowTableModal(false);
        showToast(`Updated schema for table "${updated.name}"`);
      } else {
        const created = await createTable({
          databaseId: activeDb.id,
          name: tableNameInput,
          primaryKey: pk,
          indexedFields,
          schemaHint,
          strictSchema: tableStrictSchema,
        });
        await onRefresh();
        setSelectedTableId(created.id);
        setShowTableModal(false);
        showToast(`Created object store "${created.name}"`);
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setIsMutating(false);
    }
  };

  // Helper to convert form fields array into a typed JSON object
  const buildObjectFromFormFields = (
    fields: { key: string; type: FieldType; value: string }[]
  ): { obj: Record<string, unknown>; parseError: string | null } => {
    const obj: Record<string, unknown> = {};
    for (const item of fields) {
      const k = item.key.trim();
      if (!k) continue;
      if (item.type === 'number') {
        const num = Number(item.value);
        if (item.value.trim() === '' || Number.isNaN(num)) {
          return { obj, parseError: `Field "${k}" must be a valid number.` };
        }
        obj[k] = num;
      } else if (item.type === 'boolean') {
        obj[k] = item.value === 'true';
      } else if (item.type === 'object' || item.type === 'array') {
        try {
          const parsed = JSON.parse(item.value || (item.type === 'array' ? '[]' : '{}'));
          if (item.type === 'array' && !Array.isArray(parsed)) {
            return { obj, parseError: `Field "${k}" must be a JSON array.` };
          }
          if (item.type === 'object' && (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))) {
            return { obj, parseError: `Field "${k}" must be a JSON object.` };
          }
          obj[k] = parsed;
        } catch (err) {
          return { obj, parseError: `Invalid JSON in field "${k}": ${(err as Error).message}` };
        }
      } else {
        obj[k] = item.value;
      }
    }
    return { obj, parseError: null };
  };

  const populateFormFieldsFromObject = (
    dataObj: Record<string, unknown>,
    tbl: UserTableMeta
  ): { key: string; type: FieldType; value: string }[] => {
    const combinedKeys = Array.from(
      new Set([...Object.keys(tbl.schemaHint || {}), ...Object.keys(dataObj)])
    );
    return combinedKeys.map((key) => {
      const val = dataObj[key];
      const schemaType = tbl.schemaHint?.[key];
      let inferredType: FieldType = schemaType || 'string';
      if (val !== undefined && val !== null) {
        if (Array.isArray(val)) inferredType = 'array';
        else if (typeof val === 'object') inferredType = 'object';
        else if (typeof val === 'number') inferredType = 'number';
        else if (typeof val === 'boolean') inferredType = 'boolean';
        else inferredType = 'string';
      }
      let strValue = '';
      if (val === undefined || val === null) {
        strValue =
          inferredType === 'boolean'
            ? 'false'
            : inferredType === 'number'
            ? '0'
            : inferredType === 'array'
            ? '[]'
            : inferredType === 'object'
            ? '{}'
            : '';
      } else if (typeof val === 'object') {
        strValue = JSON.stringify(val);
      } else {
        strValue = String(val);
      }
      return { key, type: inferredType, value: strValue };
    });
  };

  const openAddRecordModal = () => {
    if (!activeTable) return;
    setErrorMsg(null);
    setEditingRecord(null);
    const pk = activeTable.primaryKey;
    const sampleId = `${activeTable.name.slice(0, 4).toUpperCase()}-${Math.floor(
      1000 + Math.random() * 9000
    )}`;
    const template: Record<string, unknown> = {};
    const schemaEntries = Object.entries(activeTable.schemaHint || {});
    if (schemaEntries.length > 0) {
      for (const [field, type] of schemaEntries) {
        if (field === pk) {
          template[field] = sampleId;
        } else if (type === 'number') {
          template[field] = 0;
        } else if (type === 'boolean') {
          template[field] = true;
        } else if (type === 'array') {
          template[field] = [];
        } else if (type === 'object') {
          template[field] = {};
        } else {
          template[field] = field === 'status' ? 'ACTIVE' : '';
        }
      }
    } else {
      template[pk] = sampleId;
      template.status = 'ACTIVE';
    }
    setRecordFormFields(populateFormFieldsFromObject(template, activeTable));
    setRecordJsonInput(JSON.stringify(template, null, 2));
    setEditorMode('form');
    setRecordEditorOpen(true);
  };

  const openEditRecordModal = (rec: UserRecord) => {
    if (!activeTable) return;
    setErrorMsg(null);
    setEditingRecord(rec);
    setRecordFormFields(populateFormFieldsFromObject(rec.data, activeTable));
    setRecordJsonInput(JSON.stringify(rec.data, null, 2));
    setEditorMode('form');
    setRecordEditorOpen(true);
  };

  const handleSwitchEditorMode = (nextMode: 'form' | 'json') => {
    if (!activeTable || nextMode === editorMode) return;
    setErrorMsg(null);
    if (nextMode === 'json') {
      const { obj, parseError } = buildObjectFromFormFields(recordFormFields);
      if (parseError) {
        setErrorMsg(parseError);
        return;
      }
      setRecordJsonInput(JSON.stringify(obj, null, 2));
      setEditorMode('json');
    } else {
      try {
        const parsed = JSON.parse(recordJsonInput);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          setErrorMsg('Record JSON must be a valid object before switching to Form view.');
          return;
        }
        setRecordFormFields(
          populateFormFieldsFromObject(parsed as Record<string, unknown>, activeTable)
        );
        setEditorMode('form');
      } catch (err) {
        setErrorMsg(`Fix JSON syntax before switching to Form view: ${(err as Error).message}`);
      }
    }
  };

  // Live Schema Validation Preview inside Record Editor
  const liveRecordValidation = useMemo(() => {
    if (!activeTable || !recordEditorOpen) return null;
    if (editorMode === 'form') {
      const { obj, parseError } = buildObjectFromFormFields(recordFormFields);
      if (parseError) {
        return { valid: false, errors: [parseError], warnings: [] };
      }
      return validateRecordAgainstSchema(activeTable, obj);
    } else {
      try {
        const parsed = JSON.parse(recordJsonInput);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          return { valid: false, errors: ['Root JSON value must be an object.'], warnings: [] };
        }
        return validateRecordAgainstSchema(activeTable, parsed as Record<string, unknown>);
      } catch (err) {
        return { valid: false, errors: [`JSON Syntax Error: ${(err as Error).message}`], warnings: [] };
      }
    }
  }, [activeTable, recordEditorOpen, editorMode, recordFormFields, recordJsonInput]);

  const handleSaveRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTable) return;
    setErrorMsg(null);

    let payloadData: Record<string, unknown>;
    if (editorMode === 'form') {
      const { obj, parseError } = buildObjectFromFormFields(recordFormFields);
      if (parseError) {
        setErrorMsg(parseError);
        return;
      }
      payloadData = obj;
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(recordJsonInput);
      } catch (err) {
        setErrorMsg(`Invalid JSON payload: ${(err as Error).message}`);
        return;
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setErrorMsg('Record data must be a valid JSON object.');
        return;
      }
      payloadData = parsed as Record<string, unknown>;
    }

    setIsMutating(true);
    try {
      const saved = await upsertRecord({
        tableId: activeTable.id,
        data: payloadData,
        enqueueSync: enqueueToSyncLab,
      });
      await onRefresh();
      setRecordEditorOpen(false);
      showToast(
        `${editingRecord ? 'Updated' : 'Inserted'} record "${saved.primaryKeyValue}" (rev ${saved.revision})`
      );
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setIsMutating(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    setIsMutating(true);
    try {
      if (confirmDelete.type === 'database') {
        await deleteDatabase(confirmDelete.id);
        onSelectDbId(null);
      } else if (confirmDelete.type === 'table') {
        await deleteTable(confirmDelete.id);
        setSelectedTableId(null);
      } else if (confirmDelete.type === 'record') {
        await deleteRecord(confirmDelete.id, true);
        setSelectedRecordIds((prev) => prev.filter((id) => id !== confirmDelete.id));
      } else if (confirmDelete.type === 'bulk_records' && confirmDelete.ids) {
        await bulkDeleteRecords(confirmDelete.ids, true);
        setSelectedRecordIds([]);
      }
      await onRefresh();
      showToast(`Deleted ${confirmDelete.label}`);
    } finally {
      setIsMutating(false);
      setConfirmDelete(null);
    }
  };

  const toggleSelectRecord = (id: string) => {
    setSelectedRecordIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAllCurrentPage = () => {
    const pageIds = paginatedRecords.map((r) => r.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedRecordIds.includes(id));
    if (allSelected) {
      setSelectedRecordIds((prev) => prev.filter((id) => !pageIds.includes(id)));
    } else {
      setSelectedRecordIds((prev) => Array.from(new Set([...prev, ...pageIds])));
    }
  };

  const handleCopyJson = async (text: string, id: string) => {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Database Selector Bar */}
      <div className="liquid-glass rounded-3xl p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-th-heading">
            Local Database Explorer
          </h1>
          <p className="text-xs sm:text-sm text-th-secondary mt-0.5">
            Create IndexedDB object stores, enforce typed schemas, filter and sort records, and execute transactional CRUD mutations.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={openCreateDatabaseModal}
            className="inline-flex items-center gap-2 px-3.5 py-2 min-h-[42px] rounded-xl text-xs font-bold bg-sky-500 text-slate-950 hover:bg-sky-400 transition-colors cursor-pointer whitespace-nowrap shrink-0 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>New Database</span>
          </button>

          <button
            type="button"
            onClick={onOpenBackupModal}
            className="inline-flex items-center gap-2 px-3.5 py-2 min-h-[42px] rounded-xl text-xs font-semibold liquid-glass-interactive text-th-primary cursor-pointer whitespace-nowrap shrink-0"
          >
            <FileJson className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span>Export / Restore JSON</span>
          </button>
        </div>
      </div>

      {statusToast && (
        <div
          role="status"
          className="liquid-glass-elevated rounded-2xl px-4 py-3 text-xs font-bold text-emerald-700 dark:text-emerald-400 flex items-center justify-between"
        >
          <span>{statusToast}</span>
          <button
            type="button"
            onClick={() => setStatusToast(null)}
            className="text-th-muted hover:text-th-heading cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Explorer Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Sidebar: Databases & Tables Tree */}
        <div className="lg:col-span-4 space-y-5">
          {/* Databases List */}
          <div className="liquid-glass rounded-3xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-th-heading flex items-center gap-2">
                <Database className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                <span>Databases ({databases.length})</span>
              </h2>
            </div>

            {databases.length === 0 ? (
              <div className="py-6 text-center space-y-2">
                <p className="text-xs text-th-muted">
                  No databases in IndexedDB. Click &ldquo;New Database&rdquo; to create your first persistent workspace.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {databases.map((dbItem) => {
                  const isSelected = activeDb?.id === dbItem.id;
                  const countTables = tables.filter((t) => t.databaseId === dbItem.id).length;
                  const countRecords = records.filter((r) => r.databaseId === dbItem.id).length;
                  return (
                    <div
                      key={dbItem.id}
                      className={`rounded-2xl p-3.5 transition-colors border ${
                        isSelected
                          ? 'bg-sky-500/12 border-sky-500/45 dark:bg-sky-500/15 dark:border-sky-400/45'
                          : 'border-th-subtle hover:bg-slate-900/5 dark:hover:bg-white/5'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => onSelectDbId(dbItem.id)}
                          className="text-left flex-1 cursor-pointer min-w-0"
                        >
                          <div className="font-mono text-sm font-bold text-th-heading truncate">
                            {dbItem.name}
                          </div>
                          <div className="text-xs text-th-secondary mt-0.5 line-clamp-1">
                            {dbItem.description}
                          </div>
                          <div className="mt-2 text-[11px] font-mono text-th-muted">
                            v{dbItem.version} · {countTables} tables · {countRecords} records
                          </div>
                        </button>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => openEditDatabaseModal(dbItem)}
                            className="p-1.5 min-h-[34px] min-w-[34px] flex items-center justify-center rounded-xl text-th-muted hover:text-sky-600 dark:hover:text-sky-400 hover:bg-sky-500/10 transition-colors cursor-pointer"
                            title={`Edit database ${dbItem.name}`}
                            aria-label={`Edit database ${dbItem.name}`}
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setConfirmDelete({
                                type: 'database',
                                id: dbItem.id,
                                label: `database "${dbItem.name}"`,
                              })
                            }
                            className="p-1.5 min-h-[34px] min-w-[34px] flex items-center justify-center rounded-xl text-th-muted hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                            title={`Delete database ${dbItem.name}`}
                            aria-label={`Delete database ${dbItem.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Tables in Active Database */}
          {activeDb && (
            <div className="liquid-glass rounded-3xl p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-th-heading flex items-center gap-2 min-w-0">
                  <TableIcon className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                  <span className="truncate">Object Stores in {activeDb.name}</span>
                </h2>
                <button
                  type="button"
                  onClick={openCreateTableModal}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 min-h-[34px] rounded-xl text-xs font-bold text-sky-700 dark:text-sky-400 hover:bg-sky-500/10 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Table</span>
                </button>
              </div>

              {dbTables.length === 0 ? (
                <div className="py-6 text-center space-y-2">
                  <p className="text-xs text-th-muted">No object stores in this database yet.</p>
                  <button
                    type="button"
                    onClick={openCreateTableModal}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold bg-sky-500 text-slate-950 cursor-pointer"
                  >
                    Create First Table
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {dbTables.map((tbl) => {
                    const isSelected = activeTable?.id === tbl.id;
                    const rowCount = records.filter((r) => r.tableId === tbl.id).length;
                    return (
                      <div
                        key={tbl.id}
                        className={`rounded-2xl p-3 transition-colors border flex items-center justify-between gap-2 ${
                          isSelected
                            ? 'bg-indigo-500/12 border-indigo-500/45 dark:bg-indigo-500/15 dark:border-indigo-400/45'
                            : 'border-th-subtle hover:bg-slate-900/5 dark:hover:bg-white/5'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedTableId(tbl.id)}
                          className="text-left flex-1 cursor-pointer min-w-0"
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs font-bold text-th-heading truncate">
                              {tbl.name}
                            </span>
                            {tbl.strictSchema && (
                              <span
                                className="text-[10px] font-mono font-bold text-emerald-700 dark:text-emerald-400"
                                title="Strict Schema Validation Active"
                              >
                                [STRICT]
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] font-mono text-th-muted mt-0.5 truncate">
                            pk: {tbl.primaryKey} · {rowCount} rows
                          </div>
                        </button>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => openEditTableModal(tbl)}
                            className="p-1.5 min-h-[34px] min-w-[34px] flex items-center justify-center rounded-xl text-th-muted hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-500/10 transition-colors cursor-pointer"
                            title={`Inspect or edit schema for ${tbl.name}`}
                            aria-label={`Inspect or edit schema for ${tbl.name}`}
                          >
                            <SlidersHorizontal className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setConfirmDelete({
                                type: 'table',
                                id: tbl.id,
                                label: `table "${tbl.name}"`,
                              })
                            }
                            className="p-1.5 min-h-[34px] min-w-[34px] flex items-center justify-center rounded-xl text-th-muted hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                            title={`Delete table ${tbl.name}`}
                            aria-label={`Delete table ${tbl.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Browser Origin IndexedDB Scope & Security Disclosure */}
          {originIdbInfo && (
            <div className="liquid-glass rounded-3xl p-4 space-y-2 text-xs">
              <div className="flex items-center justify-between font-bold text-th-heading">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>Browser Origin IDB Scope</span>
                </span>
                <span className="font-mono text-[11px] text-sky-700 dark:text-sky-400">
                  {originIdbInfo.supported ? 'indexedDB.databases()' : 'Core Instance'}
                </span>
              </div>
              <div className="font-mono text-[11px] text-th-primary bg-th-subtle border border-th-subtle rounded-xl px-2.5 py-1.5">
                {originIdbInfo.databases.map((d) => `${d.name} (v${d.version})`).join(', ')}
              </div>
              <p className="text-[11px] text-th-muted leading-relaxed">
                {originIdbInfo.securityNote}
              </p>
            </div>
          )}
        </div>

        {/* Right Workspace: Table Records Explorer, Schema Bar, Search, Filter, Sort & Pagination */}
        <div className="lg:col-span-8 liquid-glass rounded-3xl p-5 sm:p-6 space-y-5">
          {!activeTable ? (
            <div className="py-16 text-center space-y-3">
              <Database className="w-8 h-8 text-th-muted mx-auto" />
              <h3 className="text-base font-bold text-th-heading">
                Select or Create an Object Store Table
              </h3>
              <p className="text-xs text-th-secondary max-w-md mx-auto">
                Choose a database and table on the left panel to inspect records, configure schema fields, or insert new local documents.
              </p>
            </div>
          ) : (
            <>
              {/* Table Header & Primary Key / Schema Metadata */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b border-th-subtle">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-base sm:text-lg font-bold text-th-heading">
                      {activeTable.name}
                    </span>
                    <span className="text-xs font-mono text-th-muted">
                      · pk: <strong className="text-th-secondary">{activeTable.primaryKey}</strong>
                    </span>
                    <span
                      className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-lg border ${
                        activeTable.strictSchema
                          ? 'bg-emerald-500/12 border-emerald-500/35 text-emerald-700 dark:text-emerald-300'
                          : 'bg-th-subtle border-th-subtle text-th-muted'
                      }`}
                    >
                      {activeTable.strictSchema ? 'Strict Schema Enforced' : 'Dynamic Schema Mode'}
                    </span>
                  </div>

                  {/* Object-Store Schema Field Types Summary */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-th-secondary">
                    <span className="text-th-muted font-sans font-semibold">Schema Fields:</span>
                    {Object.entries(activeTable.schemaHint || {}).map(([field, type]) => (
                      <span key={field} className="inline-flex items-center gap-1">
                        <span className="font-bold text-th-heading">{field}</span>
                        <span className="text-sky-700 dark:text-sky-400">:{type}</span>
                      </span>
                    ))}
                  </div>

                  <div className="text-[11px] text-th-muted font-mono">
                    Indexed Keys: {activeTable.indexedFields.join(', ') || 'none'}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEditTableModal(activeTable)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-xl text-xs font-semibold liquid-glass-interactive text-th-primary cursor-pointer whitespace-nowrap"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                    <span>Edit Schema</span>
                  </button>

                  <button
                    type="button"
                    onClick={openAddRecordModal}
                    className="inline-flex items-center gap-2 px-4 py-2 min-h-[40px] rounded-xl text-xs font-bold bg-sky-500 text-slate-950 hover:bg-sky-400 transition-colors cursor-pointer whitespace-nowrap shadow-sm"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Insert Record</span>
                  </button>
                </div>
              </div>

              {/* Search, Field Filter, Sort & Page Size Controls */}
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-th-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={`Search ${activeTable.name} by primary key or JSON value...`}
                      aria-label="Search records"
                      className="w-full pl-10 pr-4 py-2 min-h-[40px] rounded-xl text-xs bg-th-input border border-th-strong text-th-primary focus:outline-none focus:border-sky-500"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-th-secondary font-medium shrink-0">
                    {/* Sort Selector */}
                    <div className="flex items-center gap-1.5">
                      <ArrowUpDown className="w-3.5 h-3.5 text-th-muted" />
                      <select
                        aria-label="Sort records by field"
                        value={`${sortBy}:${sortDir}`}
                        onChange={(e) => {
                          const [field, dir] = e.target.value.split(':') as [
                            'updatedAt' | 'primaryKeyValue' | 'revision',
                            'asc' | 'desc',
                          ];
                          setSortBy(field);
                          setSortDir(dir);
                        }}
                        className="px-2.5 py-2 min-h-[40px] rounded-xl bg-th-input border border-th-strong text-th-primary font-mono text-xs"
                      >
                        <option value="updatedAt:desc">Updated (Newest)</option>
                        <option value="updatedAt:asc">Updated (Oldest)</option>
                        <option value="primaryKeyValue:asc">Primary Key (A→Z)</option>
                        <option value="primaryKeyValue:desc">Primary Key (Z→A)</option>
                        <option value="revision:desc">Revision (High→Low)</option>
                        <option value="revision:asc">Revision (Low→High)</option>
                      </select>
                    </div>

                    {/* Page Size */}
                    <select
                      id="page-size-select"
                      aria-label="Rows per page"
                      value={pageSize}
                      onChange={(e) => setPageSize(Number(e.target.value))}
                      className="px-2.5 py-2 min-h-[40px] rounded-xl bg-th-input border border-th-strong text-th-primary font-mono text-xs"
                    >
                      <option value={5}>5 / page</option>
                      <option value={10}>10 / page</option>
                      <option value={25}>25 / page</option>
                    </select>
                  </div>
                </div>

                {/* Secondary Bar: Field Filter + Bulk Actions */}
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-th-secondary">
                      <Filter className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                      <span>Filter by Field:</span>
                    </span>
                    <select
                      aria-label="Select field to filter"
                      value={filterField}
                      onChange={(e) => {
                        setFilterField(e.target.value);
                        setFilterValue('');
                      }}
                      className="px-2.5 py-1.5 min-h-[36px] rounded-xl bg-th-input border border-th-strong text-th-primary font-mono text-xs"
                    >
                      <option value="">All Fields</option>
                      {availableFilterFields.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>

                    {filterField && (
                      <select
                        aria-label={`Select value for ${filterField}`}
                        value={filterValue}
                        onChange={(e) => setFilterValue(e.target.value)}
                        className="px-2.5 py-1.5 min-h-[36px] rounded-xl bg-th-input border border-th-strong text-th-primary font-mono text-xs"
                      >
                        <option value="">Any {filterField} value</option>
                        {distinctFieldValues.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    )}

                    {(searchQuery || filterField) && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery('');
                          setFilterField('');
                          setFilterValue('');
                        }}
                        className="px-2.5 py-1.5 min-h-[36px] rounded-xl text-xs font-semibold text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
                      >
                        Reset Filters
                      </button>
                    )}
                  </div>

                  {selectedRecordIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmDelete({
                          type: 'bulk_records',
                          id: 'bulk',
                          label: `${selectedRecordIds.length} selected record(s)`,
                          ids: selectedRecordIds,
                        })
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-xl text-xs font-bold bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/35 hover:bg-rose-500/25 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete Selected ({selectedRecordIds.length})</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Records Table */}
              {paginatedRecords.length === 0 ? (
                <div className="py-12 text-center space-y-3 border border-dashed border-th-strong rounded-2xl">
                  <p className="text-sm font-bold text-th-heading">
                    {searchQuery || filterValue ? 'No matching records found' : 'Table is empty'}
                  </p>
                  <p className="text-xs text-th-secondary">
                    {searchQuery || filterValue
                      ? 'Try clearing your search query or field filter.'
                      : `Insert your first persistent JSON record into "${activeTable.name}".`}
                  </p>
                  {!searchQuery && !filterValue && (
                    <button
                      type="button"
                      onClick={openAddRecordModal}
                      className="px-4 py-2 min-h-[40px] rounded-xl text-xs font-bold bg-sky-500 text-slate-950 cursor-pointer"
                    >
                      Insert First Record
                    </button>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-th-strong text-[11px] font-bold text-th-secondary">
                        <th className="py-3 pr-2 w-8">
                          <input
                            type="checkbox"
                            aria-label="Select all records on this page"
                            checked={
                              paginatedRecords.length > 0 &&
                              paginatedRecords.every((r) => selectedRecordIds.includes(r.id))
                            }
                            onChange={toggleSelectAllCurrentPage}
                            className="w-4 h-4 rounded accent-sky-500 cursor-pointer"
                          />
                        </th>
                        <th className="py-3 pr-4">Primary Key ({activeTable.primaryKey})</th>
                        <th className="py-3 px-4">JSON Document Preview</th>
                        <th className="py-3 px-4 text-right">Rev</th>
                        <th className="py-3 pl-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-white/10 text-xs">
                      {paginatedRecords.map((rec) => {
                        const previewEntries = Object.entries(rec.data)
                          .filter(([k]) => k !== activeTable.primaryKey)
                          .slice(0, 3);
                        const isChecked = selectedRecordIds.includes(rec.id);
                        return (
                          <tr
                            key={rec.id}
                            className={`transition-colors ${
                              isChecked
                                ? 'bg-sky-500/8 dark:bg-sky-500/10'
                                : 'hover:bg-slate-900/5 dark:hover:bg-white/5'
                            }`}
                          >
                            <td className="py-3.5 pr-2 align-top">
                              <input
                                type="checkbox"
                                aria-label={`Select record ${rec.primaryKeyValue}`}
                                checked={isChecked}
                                onChange={() => toggleSelectRecord(rec.id)}
                                className="w-4 h-4 rounded accent-sky-500 cursor-pointer mt-0.5"
                              />
                            </td>
                            <td className="py-3.5 pr-4 font-mono font-bold text-sky-700 dark:text-sky-400 whitespace-nowrap align-top">
                              {rec.primaryKeyValue}
                            </td>
                            <td className="py-3.5 px-4 font-mono text-th-primary max-w-xs sm:max-w-md align-top">
                              <div className="truncate">
                                {previewEntries.map(([k, v], idx) => (
                                  <span key={k}>
                                    {idx > 0 && <span className="text-th-muted"> · </span>}
                                    <span className="text-th-secondary font-semibold">{k}: </span>
                                    <span>
                                      {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                                    </span>
                                  </span>
                                ))}
                              </div>
                              <div className="text-[11px] text-th-muted mt-0.5">
                                Updated{' '}
                                {new Date(rec.updatedAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  second: '2-digit',
                                })}
                              </div>
                            </td>
                            <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-th-secondary align-top">
                              v{rec.revision}
                            </td>
                            <td className="py-3.5 pl-4 text-right whitespace-nowrap align-top">
                              <div className="inline-flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => setInspectingRecord(rec)}
                                  className="p-2 min-h-[36px] min-w-[36px] rounded-xl text-th-secondary hover:text-sky-600 dark:hover:text-sky-400 hover:bg-sky-500/10 transition-colors cursor-pointer"
                                  title="Inspect full JSON"
                                  aria-label={`Inspect JSON for ${rec.primaryKeyValue}`}
                                >
                                  <Eye className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openEditRecordModal(rec)}
                                  className="p-2 min-h-[36px] min-w-[36px] rounded-xl text-th-secondary hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-500/10 transition-colors cursor-pointer"
                                  title="Edit record"
                                  aria-label={`Edit record ${rec.primaryKeyValue}`}
                                >
                                  <Edit3 className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setConfirmDelete({
                                      type: 'record',
                                      id: rec.id,
                                      label: `record "${rec.primaryKeyValue}"`,
                                    })
                                  }
                                  className="p-2 min-h-[36px] min-w-[36px] rounded-xl text-th-secondary hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                                  title="Delete record"
                                  aria-label={`Delete record ${rec.primaryKeyValue}`}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination Footer */}
              <div className="pt-3 border-t border-th-subtle flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-th-secondary font-medium">
                <div className="font-mono tabular-nums">
                  Showing {tableRecords.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}–
                  {Math.min(currentPage * pageSize, tableRecords.length)} of {tableRecords.length}{' '}
                  filtered ({allTableRecords.length} total in table)
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={currentPage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="p-2 min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl liquid-glass-interactive disabled:opacity-45 cursor-pointer disabled:cursor-not-allowed text-th-primary"
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="font-mono tabular-nums px-2 font-semibold text-th-heading">
                    Page {currentPage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={currentPage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="p-2 min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl liquid-glass-interactive disabled:opacity-45 cursor-pointer disabled:cursor-not-allowed text-th-primary"
                    aria-label="Next page"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Modal: Create / Edit Database */}
      {showDbModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="db-modal-title"
        >
          <form
            onSubmit={handleSaveDatabase}
            className="liquid-glass-elevated w-full max-w-md rounded-3xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 id="db-modal-title" className="text-lg font-bold text-th-heading">
                {editingDb ? `Edit Database (${editingDb.name})` : 'Create Local Database'}
              </h3>
              <button
                type="button"
                onClick={() => setShowDbModal(false)}
                className="p-2 rounded-xl text-th-muted hover:text-th-heading cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {errorMsg && (
              <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/35 text-xs font-semibold text-rose-700 dark:text-rose-300">
                {errorMsg}
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-th-secondary mb-1">
                  Database Name *
                </label>
                <input
                  type="text"
                  required
                  value={dbNameInput}
                  onChange={(e) => setDbNameInput(e.target.value)}
                  placeholder="e.g., Fleet_Telemetry_DB"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-th-input border border-th-strong font-mono text-th-primary"
                />
              </div>

              <div>
                <label className="block font-bold text-th-secondary mb-1">
                  Schema Version
                </label>
                <input
                  type="number"
                  min={1}
                  value={dbVersionInput}
                  onChange={(e) => setDbVersionInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-th-input border border-th-strong font-mono text-th-primary"
                />
              </div>

              <div>
                <label className="block font-bold text-th-secondary mb-1">
                  Description
                </label>
                <input
                  type="text"
                  value={dbDescInput}
                  onChange={(e) => setDbDescInput(e.target.value)}
                  placeholder="Purpose of this local object store workspace"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-th-input border border-th-strong text-th-primary"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDbModal(false)}
                className="px-4 py-2 min-h-[40px] rounded-xl text-xs font-semibold liquid-glass-interactive cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isMutating}
                className="px-4 py-2 min-h-[40px] rounded-xl text-xs font-bold bg-sky-500 text-slate-950 hover:bg-sky-400 disabled:opacity-50 cursor-pointer"
              >
                {isMutating
                  ? 'Saving...'
                  : editingDb
                  ? 'Save Changes'
                  : 'Create Database'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Create / Edit Table & Schema Inspector */}
      {showTableModal && activeDb && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="table-modal-title"
        >
          <form
            onSubmit={handleSaveTable}
            className="liquid-glass-elevated w-full max-w-lg rounded-3xl p-6 space-y-4 my-auto max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h3 id="table-modal-title" className="text-lg font-bold text-th-heading">
                {editingTable
                  ? `Object Store Schema · ${editingTable.name}`
                  : `Add Object Store to ${activeDb.name}`}
              </h3>
              <button
                type="button"
                onClick={() => setShowTableModal(false)}
                className="p-2 rounded-xl text-th-muted hover:text-th-heading cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {errorMsg && (
              <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/35 text-xs font-semibold text-rose-700 dark:text-rose-300">
                {errorMsg}
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-th-secondary mb-1">
                    Table Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={tableNameInput}
                    onChange={(e) => setTableNameInput(e.target.value)}
                    placeholder="e.g., work_orders"
                    className="w-full px-3.5 py-2 rounded-xl bg-th-input border border-th-strong font-mono text-th-primary"
                  />
                </div>

                <div>
                  <label className="block font-bold text-th-secondary mb-1">
                    Primary Key Field {editingTable && '(Immutable)'}
                  </label>
                  <input
                    type="text"
                    required
                    disabled={Boolean(editingTable)}
                    value={tablePkInput}
                    onChange={(e) => setTablePkInput(e.target.value)}
                    placeholder="id"
                    className="w-full px-3.5 py-2 rounded-xl bg-th-input border border-th-strong font-mono text-th-primary disabled:opacity-60"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-th-secondary mb-1">
                  Indexed Fields (comma-separated)
                </label>
                <input
                  type="text"
                  value={tableIndexesInput}
                  onChange={(e) => setTableIndexesInput(e.target.value)}
                  placeholder="status, assignedTo, updatedAt"
                  className="w-full px-3.5 py-2 rounded-xl bg-th-input border border-th-strong font-mono text-th-primary"
                />
              </div>

              {/* Schema Columns Definition */}
              <div className="pt-2 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-th-secondary">
                    Schema Field Definitions
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setSchemaFields((prev) => [...prev, { name: '', type: 'string' }])
                    }
                    className="inline-flex items-center gap-1 text-xs font-bold text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Schema Field</span>
                  </button>
                </div>

                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {schemaFields.map((sf, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={sf.name}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSchemaFields((prev) =>
                            prev.map((item, i) => (i === idx ? { ...item, name: val } : item))
                          );
                        }}
                        placeholder="Field name"
                        className="flex-1 px-3 py-1.5 rounded-xl bg-th-input border border-th-strong font-mono text-xs text-th-primary"
                      />
                      <select
                        value={sf.type}
                        onChange={(e) => {
                          const nextType = e.target.value as FieldType;
                          setSchemaFields((prev) =>
                            prev.map((item, i) => (i === idx ? { ...item, type: nextType } : item))
                          );
                        }}
                        className="px-2.5 py-1.5 rounded-xl bg-th-input border border-th-strong font-mono text-xs text-th-primary"
                      >
                        {FIELD_TYPES.map((ft) => (
                          <option key={ft} value={ft}>
                            {ft}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() =>
                          setSchemaFields((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="p-1.5 rounded-xl text-th-muted hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer"
                        title="Remove field"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <label className="flex items-start gap-2.5 pt-2 text-xs font-medium text-th-secondary cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={tableStrictSchema}
                  onChange={(e) => setTableStrictSchema(e.target.checked)}
                  className="w-4 h-4 rounded accent-sky-500 mt-0.5"
                />
                <div>
                  <span className="font-bold text-th-heading block">
                    Enforce Strict Schema Validation
                  </span>
                  <span className="text-[11px] text-th-muted">
                    When enabled, inserting or updating records with missing schema fields or mismatched data types will be rejected.
                  </span>
                </div>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowTableModal(false)}
                className="px-4 py-2 min-h-[40px] rounded-xl text-xs font-semibold liquid-glass-interactive cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isMutating}
                className="px-4 py-2 min-h-[40px] rounded-xl text-xs font-bold bg-sky-500 text-slate-950 hover:bg-sky-400 disabled:opacity-50 cursor-pointer"
              >
                {isMutating
                  ? 'Saving...'
                  : editingTable
                  ? 'Save Schema'
                  : 'Create Table'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Insert / Edit Record (Form Builder + Raw JSON Editor + Live Schema Validator) */}
      {recordEditorOpen && activeTable && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="record-editor-title"
        >
          <form
            onSubmit={handleSaveRecord}
            className="liquid-glass-elevated w-full max-w-2xl rounded-3xl p-6 space-y-4 my-auto max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="record-editor-title" className="text-lg font-bold text-th-heading">
                  {editingRecord
                    ? `Edit Record (${editingRecord.primaryKeyValue})`
                    : `Insert Record into ${activeTable.name}`}
                </h3>
                <p className="text-xs text-th-muted font-mono">
                  Primary key field: &ldquo;{activeTable.primaryKey}&rdquo; ·{' '}
                  {activeTable.strictSchema ? 'Strict Schema Active' : 'Dynamic Schema'}
                </p>
              </div>

              {/* Editor Mode Switcher: Form Builder vs Raw JSON */}
              <div className="flex items-center gap-2">
                <div className="inline-flex p-1 rounded-xl bg-th-subtle border border-th-strong text-xs">
                  <button
                    type="button"
                    onClick={() => handleSwitchEditorMode('form')}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-bold cursor-pointer ${
                      editorMode === 'form'
                        ? 'bg-sky-500 text-slate-950'
                        : 'text-th-secondary hover:text-th-heading'
                    }`}
                  >
                    <ListFilter className="w-3.5 h-3.5" />
                    <span>Form</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSwitchEditorMode('json')}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-bold cursor-pointer ${
                      editorMode === 'json'
                        ? 'bg-sky-500 text-slate-950'
                        : 'text-th-secondary hover:text-th-heading'
                    }`}
                  >
                    <Code2 className="w-3.5 h-3.5" />
                    <span>JSON</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setRecordEditorOpen(false)}
                  className="p-2 rounded-xl text-th-muted hover:text-th-heading cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {errorMsg && (
              <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/35 text-xs font-semibold text-rose-700 dark:text-rose-300">
                {errorMsg}
              </div>
            )}

            {editorMode === 'form' ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-th-secondary">
                    Structured Document Fields
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setRecordFormFields((prev) => [
                        ...prev,
                        { key: '', type: 'string', value: '' },
                      ])
                    }
                    className="inline-flex items-center gap-1 font-bold text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Custom Field</span>
                  </button>
                </div>

                <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
                  {recordFormFields.map((fieldItem, idx) => {
                    const isPk = fieldItem.key === activeTable.primaryKey;
                    return (
                      <div
                        key={idx}
                        className="p-2.5 rounded-2xl bg-th-subtle border border-th-subtle grid grid-cols-1 sm:grid-cols-12 gap-2 items-center text-xs"
                      >
                        <div className="sm:col-span-4">
                          <input
                            type="text"
                            disabled={isPk}
                            value={fieldItem.key}
                            onChange={(e) => {
                              const k = e.target.value;
                              setRecordFormFields((prev) =>
                                prev.map((it, i) => (i === idx ? { ...it, key: k } : it))
                              );
                            }}
                            placeholder="Field key"
                            className="w-full px-2.5 py-1.5 rounded-xl bg-th-input border border-th-strong font-mono text-xs text-th-primary disabled:opacity-70"
                          />
                        </div>

                        <div className="sm:col-span-3">
                          <select
                            value={fieldItem.type}
                            onChange={(e) => {
                              const nextType = e.target.value as FieldType;
                              setRecordFormFields((prev) =>
                                prev.map((it, i) =>
                                  i === idx
                                    ? {
                                        ...it,
                                        type: nextType,
                                        value:
                                          nextType === 'boolean'
                                            ? 'true'
                                            : nextType === 'number'
                                            ? '0'
                                            : nextType === 'array'
                                            ? '[]'
                                            : nextType === 'object'
                                            ? '{}'
                                            : it.value,
                                      }
                                    : it
                                )
                              );
                            }}
                            className="w-full px-2.5 py-1.5 rounded-xl bg-th-input border border-th-strong font-mono text-xs text-th-primary"
                          >
                            {FIELD_TYPES.map((ft) => (
                              <option key={ft} value={ft}>
                                {ft}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="sm:col-span-4">
                          {fieldItem.type === 'boolean' ? (
                            <select
                              value={fieldItem.value}
                              onChange={(e) => {
                                const v = e.target.value;
                                setRecordFormFields((prev) =>
                                  prev.map((it, i) => (i === idx ? { ...it, value: v } : it))
                                );
                              }}
                              className="w-full px-2.5 py-1.5 rounded-xl bg-th-input border border-th-strong font-mono text-xs text-th-primary"
                            >
                              <option value="true">true</option>
                              <option value="false">false</option>
                            </select>
                          ) : (
                            <input
                              type={fieldItem.type === 'number' ? 'number' : 'text'}
                              step="any"
                              value={fieldItem.value}
                              onChange={(e) => {
                                const v = e.target.value;
                                setRecordFormFields((prev) =>
                                  prev.map((it, i) => (i === idx ? { ...it, value: v } : it))
                                );
                              }}
                              placeholder={
                                fieldItem.type === 'array'
                                  ? '["item"]'
                                  : fieldItem.type === 'object'
                                  ? '{"key":"val"}'
                                  : 'Value'
                              }
                              className="w-full px-2.5 py-1.5 rounded-xl bg-th-input border border-th-strong font-mono text-xs text-th-primary"
                            />
                          )}
                        </div>

                        <div className="sm:col-span-1 flex justify-end">
                          {!isPk && (
                            <button
                              type="button"
                              onClick={() =>
                                setRecordFormFields((prev) => prev.filter((_, i) => i !== idx))
                              }
                              className="p-1.5 rounded-xl text-th-muted hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer"
                              title="Remove field"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-bold text-th-secondary mb-1.5">
                  Record JSON Payload
                </label>
                <textarea
                  rows={9}
                  value={recordJsonInput}
                  onChange={(e) => setRecordJsonInput(e.target.value)}
                  className="w-full p-3.5 rounded-2xl bg-th-code border border-th-strong font-mono text-xs text-th-primary focus:outline-none focus:border-sky-500"
                />
              </div>
            )}

            {/* Live Schema Validation Banner */}
            {liveRecordValidation && (
              <div
                className={`p-3 rounded-xl border text-xs ${
                  !liveRecordValidation.valid
                    ? 'bg-rose-500/12 border-rose-500/35 text-rose-700 dark:text-rose-300'
                    : liveRecordValidation.warnings.length > 0
                    ? 'bg-amber-500/12 border-amber-500/35 text-amber-800 dark:text-amber-300'
                    : 'bg-emerald-500/12 border-emerald-500/35 text-emerald-800 dark:text-emerald-300'
                }`}
              >
                {!liveRecordValidation.valid ? (
                  <div className="space-y-1">
                    <div className="font-bold flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>Schema Validation Errors:</span>
                    </div>
                    <ul className="list-disc list-inside font-mono text-[11px]">
                      {liveRecordValidation.errors.map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </div>
                ) : liveRecordValidation.warnings.length > 0 ? (
                  <div className="space-y-1">
                    <div className="font-bold flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>Type Warnings (Dynamic Mode Allowed):</span>
                    </div>
                    <ul className="list-disc list-inside font-mono text-[11px]">
                      {liveRecordValidation.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="font-bold flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                    <span>Payload matches object store schema</span>
                  </div>
                )}
              </div>
            )}

            <label className="flex items-center gap-2.5 text-xs font-medium text-th-secondary cursor-pointer select-none">
              <input
                type="checkbox"
                checked={enqueueToSyncLab}
                onChange={(e) => setEnqueueToSyncLab(e.target.checked)}
                className="w-4 h-4 rounded accent-sky-500"
              />
              <Send className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
              <span>Also enqueue mutation into Sync Lab outbox queue</span>
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRecordEditorOpen(false)}
                className="px-4 py-2 min-h-[40px] rounded-xl text-xs font-semibold liquid-glass-interactive cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isMutating || (liveRecordValidation !== null && !liveRecordValidation.valid)}
                className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[40px] rounded-xl text-xs font-bold bg-sky-500 text-slate-950 hover:bg-sky-400 disabled:opacity-45 cursor-pointer disabled:cursor-not-allowed"
              >
                {isMutating && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>{editingRecord ? 'Save Revision' : 'Insert Record'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Inspect Raw JSON */}
      {inspectingRecord && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="inspect-json-title"
        >
          <div className="liquid-glass-elevated w-full max-w-xl rounded-3xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 id="inspect-json-title" className="text-lg font-bold text-th-heading font-mono">
                  {inspectingRecord.primaryKeyValue}
                </h3>
                <p className="text-xs text-th-muted font-mono">
                  Revision v{inspectingRecord.revision} · Updated{' '}
                  {new Date(inspectingRecord.updatedAt).toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectingRecord(null)}
                className="p-2 rounded-xl text-th-muted hover:text-th-heading cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <pre className="p-4 rounded-2xl bg-th-code border border-th-strong font-mono text-xs text-th-primary overflow-x-auto max-h-[360px]">
              {JSON.stringify(
                {
                  _meta: {
                    id: inspectingRecord.id,
                    databaseId: inspectingRecord.databaseId,
                    tableId: inspectingRecord.tableId,
                    revision: inspectingRecord.revision,
                    createdAt: inspectingRecord.createdAt,
                    updatedAt: inspectingRecord.updatedAt,
                  },
                  data: inspectingRecord.data,
                },
                null,
                2
              )}
            </pre>

            <div className="flex justify-between items-center pt-2">
              <button
                type="button"
                onClick={() =>
                  handleCopyJson(
                    JSON.stringify(inspectingRecord.data, null, 2),
                    inspectingRecord.id
                  )
                }
                className="inline-flex items-center gap-2 px-3.5 py-2 min-h-[40px] rounded-xl text-xs font-semibold liquid-glass-interactive cursor-pointer"
              >
                {copiedId === inspectingRecord.id ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span>Copied JSON</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Payload</span>
                  </>
                )}
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const rec = inspectingRecord;
                    setInspectingRecord(null);
                    openEditRecordModal(rec);
                  }}
                  className="px-4 py-2 min-h-[40px] rounded-xl text-xs font-bold bg-sky-500 text-slate-950 hover:bg-sky-400 cursor-pointer"
                >
                  Edit Record
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog for Destructive Actions */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-delete-title"
        >
          <div className="liquid-glass-elevated w-full max-w-md rounded-3xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-600 dark:text-rose-400">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 id="confirm-delete-title" className="text-lg font-bold text-th-heading">
                Confirm Deletion
              </h3>
            </div>

            <p className="text-xs sm:text-sm text-th-secondary leading-relaxed">
              Are you sure you want to permanently delete{' '}
              <strong className="font-mono text-th-heading">{confirmDelete.label}</strong> from
              local IndexedDB storage?
              {confirmDelete.type === 'database' &&
                ' All child tables and stored records inside this database will also be removed.'}
              {confirmDelete.type === 'table' &&
                ' All records stored inside this table will also be removed.'}
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 min-h-[40px] rounded-xl text-xs font-semibold liquid-glass-interactive cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isMutating}
                onClick={handleConfirmDelete}
                className="px-4 py-2 min-h-[40px] rounded-xl text-xs font-bold bg-rose-500 text-white hover:bg-rose-600 disabled:opacity-50 cursor-pointer"
              >
                {isMutating ? 'Deleting...' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
