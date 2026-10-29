import React, { useState } from 'react';
import {
  Download,
  Upload,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  X,
  FileJson,
  Trash2,
  Sparkles,
  Copy,
  Check,
  RefreshCw,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  db,
  type BackupSnapshotMeta,
  type UserDatabaseMeta,
} from '../db/offlineDb';
import {
  createBackupSnapshot,
  validateAndPreviewBackup,
  applyBackupRestore,
  type BackupValidationPreview,
  type RestoreMode,
} from '../utils/backupEngine';

interface BackupRestoreModalProps {
  isOpen: boolean;
  onClose: () => void;
  databases: UserDatabaseMeta[];
  backups: BackupSnapshotMeta[];
  onRefresh: () => Promise<void>;
}

export const BackupRestoreModal: React.FC<BackupRestoreModalProps> = ({
  isOpen,
  onClose,
  databases,
  backups,
  onRefresh,
}) => {
  const [activeTab, setActiveTab] = useState<'export' | 'import'>('export');
  const [snapshotLabel, setSnapshotLabel] = useState('');
  const [filterDbId, setFilterDbId] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [copiedSnapId, setCopiedSnapId] = useState<string | null>(null);

  // Import & Validation State
  const [importJsonText, setImportJsonText] = useState('');
  const [preview, setPreview] = useState<BackupValidationPreview | null>(null);
  const [restoreMode, setRestoreMode] = useState<RestoreMode>('MERGE_SKIP_CONFLICTS');
  const [conflictOverrides, setConflictOverrides] = useState<Record<string, 'LOCAL' | 'BACKUP'>>({});
  const [createSafetyBackupFirst, setCreateSafetyBackupFirst] = useState(true);
  const [confirmOverwriteChecked, setConfirmOverwriteChecked] = useState(false);

  const handleCreateSnapshot = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorBanner(null);
    setIsBusy(true);
    try {
      const created = await createBackupSnapshot(
        snapshotLabel,
        filterDbId || undefined
      );
      setSnapshotLabel('');
      await onRefresh();
      setStatusMessage(`Created snapshot "${created.label}" (${created.checksum})`);
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleDownloadSnapshot = (snap: BackupSnapshotMeta) => {
    const blob = new Blob([snap.payloadJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = snap.label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    a.href = url;
    a.download = `offlinekit-${safeName}-${snap.id.slice(0, 8)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopySnapshotJson = async (snap: BackupSnapshotMeta) => {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(snap.payloadJson);
      setCopiedSnapId(snap.id);
      setTimeout(() => setCopiedSnapId(null), 1800);
    }
  };

  const handleDeleteSnapshot = async (id: string) => {
    await db.backups.delete(id);
    await onRefresh();
  };

  const handleValidateImport = async (raw: string) => {
    setImportJsonText(raw);
    setErrorBanner(null);
    setConfirmOverwriteChecked(false);
    setConflictOverrides({});
    if (!raw.trim()) {
      setPreview(null);
      return;
    }
    const result = await validateAndPreviewBackup(raw);
    setPreview(result);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorBanner(null);
    if (file.size > 50 * 1024 * 1024) {
      setErrorBanner('Selected file exceeds 50 MB maximum import limit.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => {
      setErrorBanner('Failed to read the selected file. The file may be unreadable or locked.');
    };
    reader.onload = async (ev) => {
      const text = String(ev.target?.result ?? '');
      await handleValidateImport(text);
    };
    reader.readAsText(file);
  };

  const handleLoadSnapshotForRestore = async (snap: BackupSnapshotMeta) => {
    setActiveTab('import');
    setStatusMessage(null);
    await handleValidateImport(snap.payloadJson);
  };

  const hasBackupOverride = Object.values(conflictOverrides).includes('BACKUP');
  const requiresConfirmation =
    restoreMode === 'CLEAN_REPLACE' ||
    ((restoreMode === 'UPSERT_OVERWRITE' || restoreMode === 'KEEP_NEWER_TIMESTAMP' || hasBackupOverride) &&
      (preview?.summary.recordsConflicting ?? 0) > 0);

  const handleExecuteRestore = async () => {
    if (!preview || !preview.valid || !preview.payload) return;
    if (requiresConfirmation && !confirmOverwriteChecked) return;

    setErrorBanner(null);
    setIsBusy(true);
    try {
      const res = await applyBackupRestore(preview.payload, restoreMode, db, {
        createSafetyBackupFirst,
        conflictOverrides,
      });
      await onRefresh();
      setStatusMessage(
        `Restore complete (${restoreMode}): ${res.inserted} inserted, ${res.overwritten} overwritten, ${res.skipped} skipped.${
          res.safetySnapshotId ? ' Pre-restore safety snapshot saved.' : ''
        }`
      );
      const revalidated = await validateAndPreviewBackup(importJsonText);
      setPreview(revalidated);
      setConfirmOverwriteChecked(false);
      setConflictOverrides({});
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-3 sm:p-6 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="backup-modal-title"
        >
          <motion.div
            initial={{ scale: 0.96, y: 14, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.96, y: 12, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            className="liquid-glass-elevated w-full max-w-4xl rounded-3xl p-5 sm:p-7 space-y-5 my-auto max-h-[90vh] overflow-y-auto"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-4 border-b border-th-subtle pb-4">
              <div>
                <h2
                  id="backup-modal-title"
                  className="text-xl font-bold text-th-heading flex items-center gap-2.5"
                >
                  <FileJson className="w-5 h-5 text-sky-600 dark:text-sky-400" />
                  <span>Backup &amp; Restore Engine</span>
                </h2>
                <p className="text-xs text-th-secondary mt-1">
                  Export deterministic JSON snapshots with SHA-256 checksums, validate schema compatibility, preview conflicts, and restore with atomic IndexedDB rollback protection.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-2 min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-th-muted hover:text-th-heading cursor-pointer"
                aria-label="Close Backup and Restore modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mode Switcher */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="inline-flex p-1 rounded-2xl bg-th-subtle border border-th-strong">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('export');
                    setStatusMessage(null);
                    setErrorBanner(null);
                  }}
                  className={`relative px-4 py-2 min-h-[38px] rounded-xl text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                    activeTab === 'export'
                      ? 'text-slate-950'
                      : 'text-th-secondary hover:text-th-heading'
                  }`}
                >
                  {activeTab === 'export' && (
                    <motion.div
                      layoutId="backup-tab-pill"
                      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                      className="absolute inset-0 rounded-xl bg-sky-400"
                    />
                  )}
                  <span className="relative z-10">
                    Export &amp; Local Snapshots ({backups.length})
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('import');
                    setStatusMessage(null);
                    setErrorBanner(null);
                  }}
                  className={`relative px-4 py-2 min-h-[38px] rounded-xl text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                    activeTab === 'import'
                      ? 'text-slate-950'
                      : 'text-th-secondary hover:text-th-heading'
                  }`}
                >
                  {activeTab === 'import' && (
                    <motion.div
                      layoutId="backup-tab-pill"
                      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                      className="absolute inset-0 rounded-xl bg-sky-400"
                    />
                  )}
                  <span className="relative z-10">Import, Validate &amp; Restore</span>
                </button>
              </div>

              {statusMessage && (
                <div className="text-xs font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{statusMessage}</span>
                </div>
              )}
            </div>

            {errorBanner && (
              <div className="p-3.5 rounded-2xl bg-rose-500/15 border border-rose-500/35 text-xs font-semibold text-rose-700 dark:text-rose-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{errorBanner}</span>
              </div>
            )}

            {activeTab === 'export' ? (
              <div className="space-y-6">
                {/* Create Snapshot Form */}
                <form
                  onSubmit={handleCreateSnapshot}
                  className="p-4 sm:p-5 rounded-2xl bg-th-subtle border border-th-subtle grid grid-cols-1 sm:grid-cols-12 gap-3 items-end"
                >
                  <div className="sm:col-span-5">
                    <label className="block text-xs font-bold text-th-secondary mb-1">
                      Snapshot Label
                    </label>
                    <input
                      type="text"
                      value={snapshotLabel}
                      onChange={(e) => setSnapshotLabel(e.target.value)}
                      placeholder="e.g., Pre-migration checkpoint v2"
                      className="w-full px-3.5 py-2 min-h-[40px] rounded-xl text-xs bg-th-input border border-th-strong text-th-primary"
                    />
                  </div>

                  <div className="sm:col-span-4">
                    <label className="block text-xs font-bold text-th-secondary mb-1">
                      Scope
                    </label>
                    <select
                      value={filterDbId}
                      onChange={(e) => setFilterDbId(e.target.value)}
                      className="w-full px-3 py-2 min-h-[40px] rounded-xl text-xs bg-th-input border border-th-strong text-th-primary"
                    >
                      <option value="">All Local Databases ({databases.length})</option>
                      {databases.map((d) => (
                        <option key={d.id} value={d.id}>
                          Only {d.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-3">
                    <button
                      type="submit"
                      disabled={isBusy}
                      className="w-full px-4 py-2 min-h-[40px] rounded-xl text-xs font-bold bg-sky-500 text-slate-950 hover:bg-sky-400 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap shadow-sm"
                    >
                      {isBusy ? 'Snapshotting...' : 'Create Snapshot'}
                    </button>
                  </div>
                </form>

                {/* Saved Snapshots List */}
                <div className="space-y-3">
                  <h3 className="text-xs font-bold text-th-secondary">
                    Saved Snapshots in IndexedDB ({backups.length})
                  </h3>

                  {backups.length === 0 ? (
                    <div className="py-8 text-center text-xs text-th-muted border border-dashed border-th-strong rounded-2xl">
                      No snapshots created yet.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-200 dark:divide-white/10">
                      {backups.map((snap) => (
                        <div
                          key={snap.id}
                          className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="space-y-1">
                            <div className="font-bold text-sm text-th-heading">
                              {snap.label}
                            </div>
                            <div className="text-xs font-mono text-th-muted flex flex-wrap items-center gap-2">
                              <span>{snap.checksum}</span>
                              <span>·</span>
                              <span>{snap.databaseCount} DBs</span>
                              <span>·</span>
                              <span>{snap.tableCount} tables</span>
                              <span>·</span>
                              <span>{snap.recordCount} records</span>
                              <span>·</span>
                              <span>{(snap.sizeBytes / 1024).toFixed(1)} KB</span>
                              <span>·</span>
                              <span>{new Date(snap.createdAt).toLocaleTimeString()}</span>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 self-start sm:self-center shrink-0">
                            <button
                              type="button"
                              onClick={() => handleLoadSnapshotForRestore(snap)}
                              className="px-3 py-1.5 min-h-[36px] rounded-xl text-xs font-semibold liquid-glass-interactive cursor-pointer whitespace-nowrap"
                            >
                              Preview &amp; Restore
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCopySnapshotJson(snap)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-xl text-xs font-semibold liquid-glass-interactive cursor-pointer whitespace-nowrap"
                              title="Copy JSON to clipboard"
                            >
                              {copiedSnapId === snap.id ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                  <span>Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" />
                                  <span>Copy JSON</span>
                                </>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDownloadSnapshot(snap)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-xl text-xs font-bold bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30 hover:bg-sky-500/25 transition-colors cursor-pointer whitespace-nowrap"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>Download .json</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteSnapshot(snap.id)}
                              className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl text-th-muted hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                              title="Delete snapshot"
                              aria-label={`Delete snapshot ${snap.label}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                {/* File Upload or Paste JSON */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <label className="inline-flex items-center gap-2 px-4 py-2 min-h-[40px] rounded-xl text-xs font-bold liquid-glass-interactive cursor-pointer w-fit">
                    <Upload className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                    <span>Upload Backup .json File</span>
                    <input
                      type="file"
                      accept=".json,application/json"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>

                  {backups.length > 0 && (
                    <button
                      type="button"
                      onClick={() => handleLoadSnapshotForRestore(backups[0])}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Load latest local snapshot for diff testing</span>
                    </button>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-th-secondary mb-1.5">
                    Backup JSON Payload (`offlinekit-backup-v1` schema)
                  </label>
                  <textarea
                    rows={6}
                    value={importJsonText}
                    onChange={(e) => handleValidateImport(e.target.value)}
                    placeholder='Paste an "offlinekit-backup-v1" JSON backup file here to validate schema, detect duplicates/orphans, and preview conflicts...'
                    className="w-full p-3.5 rounded-2xl bg-th-code border border-th-strong font-mono text-xs text-th-primary focus:outline-none focus:border-sky-500"
                  />
                </div>

                {/* Schema Validation & Diff Preview Report */}
                {preview && (
                  <div className="space-y-4">
                    {!preview.valid ? (
                      <div className="p-4 rounded-2xl bg-rose-500/12 border border-rose-500/35 space-y-2">
                        <div className="flex items-center gap-2 text-xs font-bold text-rose-700 dark:text-rose-400">
                          <AlertTriangle className="w-4 h-4" />
                          <span>Schema &amp; Integrity Validation Failed</span>
                        </div>
                        <ul className="list-disc list-inside text-xs text-rose-700 dark:text-rose-300 space-y-1 font-mono">
                          {preview.errors.map((err, i) => (
                            <li key={i}>{err}</li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="p-4 rounded-2xl bg-emerald-500/12 border border-emerald-500/35 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs font-bold text-emerald-800 dark:text-emerald-300">
                            <ShieldCheck className="w-4 h-4" />
                            <span>
                              Schema Validated · Format: offlinekit-backup-v1 (v{preview.schemaVersion})
                            </span>
                          </div>
                          <span className="text-xs font-mono font-semibold text-emerald-800 dark:text-emerald-300">
                            {preview.checksum}
                          </span>
                        </div>

                        {preview.warnings.length > 0 && (
                          <div className="p-3.5 rounded-2xl bg-amber-500/12 border border-amber-500/35 space-y-1.5 text-xs">
                            <div className="font-bold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                              <AlertTriangle className="w-4 h-4 shrink-0" />
                              <span>Validation Warnings ({preview.warnings.length})</span>
                            </div>
                            <ul className="list-disc list-inside font-mono text-[11px] text-amber-800 dark:text-amber-200 space-y-0.5">
                              {preview.warnings.map((w, idx) => (
                                <li key={idx}>{w}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Diff Summary Counters */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                          <div className="p-3.5 rounded-2xl bg-th-subtle border border-th-subtle">
                            <div className="text-th-secondary font-medium">Databases &amp; Tables</div>
                            <div className="text-base font-bold font-mono tabular-nums text-th-heading mt-1">
                              {preview.summary.databasesTotal} DBs · {preview.summary.tablesTotal} Tbls
                            </div>
                            <div className="text-[11px] font-mono text-sky-700 dark:text-sky-400">
                              +{preview.summary.databasesNew} new DB, +{preview.summary.tablesNew} new Tbl
                            </div>
                          </div>

                          <div className="p-3.5 rounded-2xl bg-th-subtle border border-th-subtle">
                            <div className="text-th-secondary font-medium">New Records</div>
                            <div className="text-lg font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400 mt-1">
                              +{preview.summary.recordsNew}
                            </div>
                          </div>

                          <div className="p-3.5 rounded-2xl bg-th-subtle border border-th-subtle">
                            <div className="text-th-secondary font-medium">Identical / Skipped</div>
                            <div className="text-lg font-bold font-mono tabular-nums text-th-heading mt-1">
                              {preview.summary.recordsIdentical}
                            </div>
                          </div>

                          <div className="p-3.5 rounded-2xl bg-th-subtle border border-th-subtle">
                            <div className="text-th-secondary font-medium">Conflicts Detected</div>
                            <div
                              className={`text-lg font-bold font-mono tabular-nums mt-1 ${
                                preview.summary.recordsConflicting > 0
                                  ? 'text-amber-700 dark:text-amber-400'
                                  : 'text-th-heading'
                              }`}
                            >
                              {preview.summary.recordsConflicting}
                            </div>
                          </div>
                        </div>

                        {/* Conflict Details List with Per-Record Override */}
                        {preview.conflicts.length > 0 && (
                          <div className="p-4 rounded-2xl bg-amber-500/12 border border-amber-500/35 space-y-3">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                              <div className="font-bold text-amber-800 dark:text-amber-300 flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4 shrink-0" />
                                <span>
                                  {preview.conflicts.length} Primary-Key Conflict
                                  {preview.conflicts.length > 1 ? 's' : ''} Detected Against Local Storage
                                </span>
                              </div>
                              <span className="text-[11px] text-th-secondary">
                                Optional: Override individual conflicting records below
                              </span>
                            </div>

                            <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                              {preview.conflicts.map((c) => {
                                const override = conflictOverrides[c.recordId];
                                return (
                                  <div
                                    key={c.recordId}
                                    className="p-3 rounded-xl bg-th-input border border-th-subtle text-xs font-mono space-y-2"
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2 text-th-heading font-bold">
                                      <span>
                                        {c.tableName} → Key: {c.primaryKeyValue}
                                      </span>
                                      <div className="flex items-center gap-1.5 font-sans">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setConflictOverrides((prev) => ({
                                              ...prev,
                                              [c.recordId]:
                                                prev[c.recordId] === 'LOCAL' ? undefined! : 'LOCAL',
                                            }))
                                          }
                                          className={`px-2 py-1 rounded-lg text-[11px] font-bold border cursor-pointer ${
                                            override === 'LOCAL'
                                              ? 'bg-emerald-500/20 border-emerald-500 text-emerald-700 dark:text-emerald-300'
                                              : 'bg-th-subtle border-th-strong text-th-secondary'
                                          }`}
                                        >
                                          Keep Local (v{c.localRevision})
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setConflictOverrides((prev) => ({
                                              ...prev,
                                              [c.recordId]:
                                                prev[c.recordId] === 'BACKUP' ? undefined! : 'BACKUP',
                                            }))
                                          }
                                          className={`px-2 py-1 rounded-lg text-[11px] font-bold border cursor-pointer ${
                                            override === 'BACKUP'
                                              ? 'bg-sky-500/20 border-sky-500 text-sky-700 dark:text-sky-300'
                                              : 'bg-th-subtle border-th-strong text-th-secondary'
                                          }`}
                                        >
                                          Use Backup (v{c.incomingRevision})
                                        </button>
                                      </div>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                                      <div className="p-2 rounded bg-th-subtle text-th-primary truncate">
                                        <span className="text-th-muted font-semibold block">
                                          Local IndexedDB ({new Date(c.localUpdatedAt).toLocaleTimeString()}):
                                        </span>
                                        {JSON.stringify(c.localData)}
                                      </div>
                                      <div className="p-2 rounded bg-sky-500/12 text-th-primary truncate">
                                        <span className="text-sky-700 dark:text-sky-400 font-semibold block">
                                          Incoming Backup ({new Date(c.incomingUpdatedAt).toLocaleTimeString()}):
                                        </span>
                                        {JSON.stringify(c.incomingData)}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Restore Strategy & Confirmation */}
                        <div className="p-4 rounded-2xl bg-th-subtle border border-th-subtle space-y-4">
                          <div>
                            <label className="block text-xs font-bold text-th-heading mb-2">
                              Default Conflict Resolution &amp; Restore Mode
                            </label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
                              <button
                                type="button"
                                onClick={() => setRestoreMode('MERGE_SKIP_CONFLICTS')}
                                className={`p-3 rounded-xl border text-left cursor-pointer transition-colors ${
                                  restoreMode === 'MERGE_SKIP_CONFLICTS'
                                    ? 'border-sky-500 bg-sky-500/15'
                                    : 'border-th-strong bg-th-input'
                                }`}
                              >
                                <div className="font-bold text-th-heading">
                                  Merge (Skip Conflicts)
                                </div>
                                <div className="text-[11px] text-th-secondary mt-0.5">
                                  Insert new records only; preserve existing local records.
                                </div>
                              </button>

                              <button
                                type="button"
                                onClick={() => setRestoreMode('KEEP_NEWER_TIMESTAMP')}
                                className={`p-3 rounded-xl border text-left cursor-pointer transition-colors ${
                                  restoreMode === 'KEEP_NEWER_TIMESTAMP'
                                    ? 'border-indigo-500 bg-indigo-500/15'
                                    : 'border-th-strong bg-th-input'
                                }`}
                              >
                                <div className="font-bold text-th-heading">
                                  Keep Newer Timestamp
                                </div>
                                <div className="text-[11px] text-th-secondary mt-0.5">
                                  Compare `updatedAt` timestamps and keep whichever revision is newer.
                                </div>
                              </button>

                              <button
                                type="button"
                                onClick={() => setRestoreMode('UPSERT_OVERWRITE')}
                                className={`p-3 rounded-xl border text-left cursor-pointer transition-colors ${
                                  restoreMode === 'UPSERT_OVERWRITE'
                                    ? 'border-amber-500 bg-amber-500/15'
                                    : 'border-th-strong bg-th-input'
                                }`}
                              >
                                <div className="font-bold text-th-heading">
                                  Upsert (Overwrite)
                                </div>
                                <div className="text-[11px] text-th-secondary mt-0.5">
                                  Insert new records and overwrite conflicting keys with backup data.
                                </div>
                              </button>

                              <button
                                type="button"
                                onClick={() => setRestoreMode('CLEAN_REPLACE')}
                                className={`p-3 rounded-xl border text-left cursor-pointer transition-colors ${
                                  restoreMode === 'CLEAN_REPLACE'
                                    ? 'border-rose-500 bg-rose-500/15'
                                    : 'border-th-strong bg-th-input'
                                }`}
                              >
                                <div className="font-bold text-th-heading">
                                  Clean Replace All
                                </div>
                                <div className="text-[11px] text-th-secondary mt-0.5">
                                  Wipe existing databases first and restore exact snapshot state.
                                </div>
                              </button>
                            </div>
                          </div>

                          <div className="space-y-2.5 pt-1 border-t border-th-subtle">
                            <label className="flex items-center gap-2.5 text-xs font-medium text-th-secondary cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={createSafetyBackupFirst}
                                onChange={(e) => setCreateSafetyBackupFirst(e.target.checked)}
                                className="w-4 h-4 rounded accent-sky-500"
                              />
                              <span>
                                Create an automatic <strong>Pre-Restore Safety Point</strong> in IndexedDB before applying changes
                              </span>
                            </label>

                            {requiresConfirmation && (
                              <label className="flex items-center gap-2.5 text-xs font-bold text-amber-800 dark:text-amber-300 cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={confirmOverwriteChecked}
                                  onChange={(e) => setConfirmOverwriteChecked(e.target.checked)}
                                  className="w-4 h-4 rounded accent-amber-500"
                                />
                                <span>
                                  I confirm overwriting existing local IndexedDB records with this backup payload.
                                </span>
                              </label>
                            )}
                          </div>

                          <div className="flex justify-end">
                            <button
                              type="button"
                              disabled={isBusy || (requiresConfirmation && !confirmOverwriteChecked)}
                              onClick={handleExecuteRestore}
                              className="inline-flex items-center gap-2 px-5 py-2.5 min-h-[42px] rounded-xl text-xs font-bold bg-sky-500 text-slate-950 hover:bg-sky-400 disabled:opacity-45 cursor-pointer disabled:cursor-not-allowed shadow-sm"
                            >
                              {isBusy && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                              <span>Execute Atomic Restore ({restoreMode})</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
