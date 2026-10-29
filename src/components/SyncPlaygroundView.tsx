import React, { useState } from 'react';
import {
  RefreshCw,
  Wifi,
  WifiOff,
  AlertTriangle,
  CheckCircle2,
  Play,
  Plus,
  GitMerge,
  Trash2,
  Info,
  RotateCcw,
  Clock,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  db,
  generateId,
  logActivity,
  type ConflictStrategy,
  type SyncQueueItem,
  type UserDatabaseMeta,
  type UserTableMeta,
} from '../db/offlineDb';

interface SyncPlaygroundViewProps {
  databases: UserDatabaseMeta[];
  tables: UserTableMeta[];
  syncQueue: SyncQueueItem[];
  simulatedNetMode: 'ONLINE' | 'FLAKY' | 'OFFLINE';
  onChangeSimulatedNetMode: (mode: 'ONLINE' | 'FLAKY' | 'OFFLINE') => void;
  onRefresh: () => Promise<void>;
}

export const SyncPlaygroundView: React.FC<SyncPlaygroundViewProps> = ({
  databases,
  tables,
  syncQueue,
  simulatedNetMode,
  onChangeSimulatedNetMode,
  onRefresh,
}) => {
  const [isFlushing, setIsFlushing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'CONFLICT' | 'FAILED' | 'SYNCED'>('ALL');
  const [activeConflictItem, setActiveConflictItem] = useState<SyncQueueItem | null>(null);
  const [manualMergeJson, setManualMergeJson] = useState<string>('');
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);

  // Enqueue Custom Mutation state
  const [selectedTableId, setSelectedTableId] = useState<string>(tables[0]?.id ?? '');
  const [operationType, setOperationType] = useState<'INSERT' | 'UPDATE' | 'DELETE'>('UPDATE');
  const [simulate409Conflict, setSimulate409Conflict] = useState(false);

  const filteredQueue = syncQueue.filter((item) =>
    statusFilter === 'ALL' ? true : item.status === statusFilter
  );

  const handleEnqueueTestMutation = async () => {
    const targetTable = tables.find((t) => t.id === selectedTableId) ?? tables[0];
    const targetDb = databases.find((d) => d.id === targetTable?.databaseId) ?? databases[0];
    const now = new Date().toISOString();
    const recordKey = `REC-${Math.floor(1000 + Math.random() * 9000)}`;
    const pkField = targetTable?.primaryKey ?? 'id';

    const clientPayload: Record<string, unknown> = {
      [pkField]: recordKey,
      status: 'CLIENT_MODIFIED',
      value: Math.round(Math.random() * 500),
      operator: 'local_field_device',
      updatedOfflineAt: now,
    };

    const serverPayload: Record<string, unknown> | undefined = simulate409Conflict
      ? {
          [pkField]: recordKey,
          status: 'REMOTE_DISPATCH_OVERRIDE',
          value: 999,
          operator: 'central_coordinator',
          updatedRemoteAt: new Date(Date.now() - 30_000).toISOString(),
        }
      : undefined;

    const item: SyncQueueItem = {
      id: generateId('sync'),
      databaseId: targetDb?.id ?? 'db_local',
      tableName: targetTable?.name ?? 'offline_store',
      recordKey,
      operation: operationType,
      status: simulate409Conflict ? 'CONFLICT' : 'PENDING',
      clientPayload,
      serverPayload,
      attempts: simulate409Conflict ? 1 : 0,
      maxAttempts: 3,
      lastError: simulate409Conflict
        ? 'Simulated HTTP 409 Conflict: Remote revision diverges from client base revision.'
        : undefined,
      clientTimestamp: now,
      serverTimestamp: simulate409Conflict
        ? new Date(Date.now() - 30_000).toISOString()
        : undefined,
      createdAt: now,
      updatedAt: now,
    };

    await db.syncQueue.put(item);
    await logActivity(
      'SYNC',
      simulate409Conflict ? 'Injected conflicting mutation' : 'Enqueued local mutation',
      `${operationType} ${recordKey} in ${item.tableName} (${item.status})`
    );
    await onRefresh();
    setFeedbackBanner(
      simulate409Conflict
        ? `Injected HTTP 409 Conflict for key "${recordKey}". Click "Resolve Conflict" below to test strategies.`
        : `Enqueued ${operationType} mutation for "${recordKey}" into local outbox.`
    );
  };

  const handleFlushQueue = async () => {
    const actionable = syncQueue.filter(
      (item) => item.status === 'PENDING' || item.status === 'FAILED'
    );
    if (actionable.length === 0) {
      setFeedbackBanner('No PENDING or FAILED mutations in outbox to flush.');
      return;
    }

    setIsFlushing(true);
    setFeedbackBanner(null);

    let syncedCount = 0;
    let failedCount = 0;

    for (const item of actionable) {
      await db.syncQueue.update(item.id, { status: 'SYNCING' });
      await onRefresh();
      await new Promise((r) => setTimeout(r, 180));

      const now = new Date().toISOString();
      if (simulatedNetMode === 'OFFLINE') {
        failedCount++;
        await db.syncQueue.update(item.id, {
          status: 'FAILED',
          attempts: item.attempts + 1,
          lastError: 'Simulated Network Offline: ERR_INTERNET_DISCONNECTED (queued for exponential backoff)',
          updatedAt: now,
        });
      } else if (simulatedNetMode === 'FLAKY' && Math.random() < 0.45) {
        failedCount++;
        await db.syncQueue.update(item.id, {
          status: 'FAILED',
          attempts: item.attempts + 1,
          lastError: 'Simulated Flaky Uplink: HTTP 504 Gateway Timeout after 1200ms',
          updatedAt: now,
        });
      } else {
        syncedCount++;
        await db.syncQueue.update(item.id, {
          status: 'SYNCED',
          attempts: item.attempts + 1,
          lastError: undefined,
          serverTimestamp: now,
          updatedAt: now,
        });
      }
    }

    await logActivity(
      'SYNC',
      `Flushed outbox (${simulatedNetMode})`,
      `${syncedCount} synced, ${failedCount} failed and scheduled for retry.`
    );
    await onRefresh();
    setIsFlushing(false);
    setFeedbackBanner(
      `Outbox flush finished under ${simulatedNetMode} link: ${syncedCount} synced, ${failedCount} failed.`
    );
  };

  const openConflictResolver = (item: SyncQueueItem) => {
    setActiveConflictItem(item);
    setMergeError(null);
    const mergedTemplate = {
      ...(item.serverPayload ?? {}),
      ...(item.clientPayload ?? {}),
      _mergedAt: new Date().toISOString(),
    };
    setManualMergeJson(JSON.stringify(mergedTemplate, null, 2));
  };

  const handleResolveConflict = async (strategy: ConflictStrategy) => {
    if (!activeConflictItem) return;
    setMergeError(null);

    let winningPayload: Record<string, unknown>;
    if (strategy === 'CLIENT_WINS') {
      winningPayload = activeConflictItem.clientPayload;
    } else if (strategy === 'SERVER_WINS') {
      winningPayload = activeConflictItem.serverPayload ?? activeConflictItem.clientPayload;
    } else if (strategy === 'LWW') {
      const clientTime = new Date(activeConflictItem.clientTimestamp).getTime();
      const serverTime = activeConflictItem.serverTimestamp
        ? new Date(activeConflictItem.serverTimestamp).getTime()
        : 0;
      winningPayload =
        clientTime >= serverTime
          ? activeConflictItem.clientPayload
          : (activeConflictItem.serverPayload ?? activeConflictItem.clientPayload);
    } else {
      try {
        const parsed = JSON.parse(manualMergeJson);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          setMergeError('Merged payload must be a JSON object.');
          return;
        }
        winningPayload = parsed as Record<string, unknown>;
      } catch (err) {
        setMergeError(`Invalid JSON in manual merge editor: ${(err as Error).message}`);
        return;
      }
    }

    const now = new Date().toISOString();
    await db.syncQueue.update(activeConflictItem.id, {
      status: 'SYNCED',
      resolvedPayload: winningPayload,
      resolutionStrategy: strategy,
      lastError: undefined,
      updatedAt: now,
    });

    // Also update matching local record in IndexedDB if the table exists
    const matchingTable = tables.find(
      (t) =>
        t.databaseId === activeConflictItem.databaseId &&
        t.name === activeConflictItem.tableName
    );
    if (matchingTable) {
      const compositeId = `${matchingTable.id}::${activeConflictItem.recordKey}`;
      const existingRec = await db.records.get(compositeId);
      await db.records.put({
        id: compositeId,
        databaseId: matchingTable.databaseId,
        tableId: matchingTable.id,
        primaryKeyValue: activeConflictItem.recordKey,
        data: winningPayload,
        revision: existingRec ? existingRec.revision + 1 : 1,
        createdAt: existingRec ? existingRec.createdAt : now,
        updatedAt: now,
      });
    }

    await logActivity(
      'SYNC',
      `Resolved conflict (${strategy})`,
      `Resolved key "${activeConflictItem.recordKey}" in ${activeConflictItem.tableName} using ${strategy}.`
    );

    setActiveConflictItem(null);
    await onRefresh();
    setFeedbackBanner(
      `Conflict on "${activeConflictItem.recordKey}" resolved with strategy ${strategy} and committed to local IndexedDB.`
    );
  };

  const handleClearSynced = async () => {
    const syncedIds = syncQueue.filter((i) => i.status === 'SYNCED').map((i) => i.id);
    if (syncedIds.length === 0) return;
    await db.syncQueue.bulkDelete(syncedIds);
    await onRefresh();
    setFeedbackBanner(`Pruned ${syncedIds.length} completed SYNCED item(s) from outbox history.`);
  };

  return (
    <div className="space-y-6">
      {/* Transparent Disclosure Banner: Simulated vs Real Persistence */}
      <div className="liquid-glass rounded-3xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-th-heading">
              Sync Playground &amp; Conflict Lab
            </h1>
            <p className="text-xs sm:text-sm text-th-secondary mt-0.5">
              Test local-first outbox queueing, exponential retry states, and deterministic conflict resolution strategies.
            </p>
          </div>

          {/* Simulated Network Condition Switcher with layoutId */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-th-secondary mr-1">
              Simulated Link:
            </span>
            <div className="inline-flex p-1 rounded-2xl bg-th-subtle border border-th-strong">
              {(['ONLINE', 'FLAKY', 'OFFLINE'] as const).map((mode) => {
                const isActive = simulatedNetMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onChangeSimulatedNetMode(mode)}
                    className={`relative px-3 py-1.5 min-h-[36px] rounded-xl text-xs font-bold transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                      isActive
                        ? mode === 'OFFLINE'
                          ? 'text-white'
                          : 'text-slate-950'
                        : 'text-th-secondary hover:text-th-heading'
                    }`}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="sync-net-mode-pill"
                        transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                        className={`absolute inset-0 rounded-xl ${
                          mode === 'ONLINE'
                            ? 'bg-emerald-400'
                            : mode === 'FLAKY'
                            ? 'bg-amber-400'
                            : 'bg-rose-600'
                        }`}
                      />
                    )}
                    <span className="relative z-10 flex items-center gap-1.5">
                      {mode === 'OFFLINE' ? (
                        <WifiOff className="w-3.5 h-3.5" />
                      ) : (
                        <Wifi className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {mode === 'ONLINE'
                          ? 'Online (100%)'
                          : mode === 'FLAKY'
                          ? 'Flaky (40% Drop)'
                          : 'Air-Gap Offline'}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Clear distinction notice between real local IndexedDB and simulated remote server */}
        <div className="p-3.5 rounded-2xl bg-sky-500/12 border border-sky-500/30 flex items-start gap-3 text-xs text-th-secondary">
          <Info className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
          <div>
            <strong className="text-th-heading">
              Architecture Note (Real Local Persistence vs. Simulated Remote Endpoint):
            </strong>{' '}
            Your outbox queue and resolved records are persisted in real browser <strong className="text-th-heading">IndexedDB</strong> (`OfflineKitCoreDB`). The remote replication endpoint is simulated locally so you can deterministically test network drops, HTTP 504 retries, and HTTP 409 revision conflicts while working completely offline.
          </div>
        </div>
      </div>

      <AnimatePresence>
        {feedbackBanner && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            role="status"
            className="liquid-glass-elevated rounded-2xl px-4 py-3 text-xs font-bold text-sky-700 dark:text-sky-300 flex items-center justify-between"
          >
            <span>{feedbackBanner}</span>
            <button
              type="button"
              onClick={() => setFeedbackBanner(null)}
              className="text-th-muted hover:text-th-heading ml-4 cursor-pointer"
            >
              Dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Outbox Controls & Mutation Generator */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Enqueue / Simulate Operations */}
        <div className="lg:col-span-4 liquid-glass rounded-3xl p-5 space-y-4">
          <h2 className="text-sm font-bold text-th-heading flex items-center gap-2">
            <Plus className="w-4 h-4 text-sky-600 dark:text-sky-400" />
            <span>Enqueue Local-First Mutation</span>
          </h2>

          <div className="space-y-3 text-xs">
            <div>
              <label className="block font-bold text-th-secondary mb-1">
                Target Object Store Table
              </label>
              <select
                value={selectedTableId}
                onChange={(e) => setSelectedTableId(e.target.value)}
                className="w-full px-3 py-2 min-h-[40px] rounded-xl bg-th-input border border-th-strong text-th-primary font-mono text-xs"
              >
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} (pk: {t.primaryKey})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-bold text-th-secondary mb-1">
                Mutation Operation
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['INSERT', 'UPDATE', 'DELETE'] as const).map((op) => (
                  <button
                    key={op}
                    type="button"
                    onClick={() => setOperationType(op)}
                    className={`py-2 min-h-[38px] rounded-xl font-mono font-bold text-xs border cursor-pointer transition-colors ${
                      operationType === op
                        ? 'bg-sky-500/15 border-sky-500 text-sky-700 dark:text-sky-300'
                        : 'border-th-strong bg-th-input text-th-secondary hover:text-th-heading'
                    }`}
                  >
                    {op}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-start gap-2.5 p-3 rounded-2xl bg-amber-500/12 border border-amber-500/30 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={simulate409Conflict}
                onChange={(e) => setSimulate409Conflict(e.target.checked)}
                className="w-4 h-4 mt-0.5 rounded accent-amber-500"
              />
              <div>
                <div className="font-bold text-amber-800 dark:text-amber-300">
                  Simulate Concurrent Remote Edit (HTTP 409)
                </div>
                <div className="text-[11px] text-th-secondary mt-0.5">
                  Attaches a diverging server revision so you can test LWW, Client-Wins, Server-Wins, or Manual Merge.
                </div>
              </div>
            </label>

            <motion.button
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={handleEnqueueTestMutation}
              className="w-full py-2.5 min-h-[42px] rounded-xl text-xs font-bold bg-sky-500 text-slate-950 hover:bg-sky-400 transition-colors cursor-pointer flex items-center justify-center gap-2 shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>{simulate409Conflict ? 'Inject Conflicting Mutation' : 'Append Mutation to Outbox'}</span>
            </motion.button>
          </div>
        </div>

        {/* Right Column: Outbox Queue List & Dispatcher */}
        <div className="lg:col-span-8 liquid-glass rounded-3xl p-5 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-th-subtle">
            <div className="flex flex-wrap items-center gap-1.5">
              {(['ALL', 'PENDING', 'CONFLICT', 'FAILED', 'SYNCED'] as const).map((st) => {
                const count =
                  st === 'ALL'
                    ? syncQueue.length
                    : syncQueue.filter((i) => i.status === st).length;
                const isSelected = statusFilter === st;
                return (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStatusFilter(st)}
                    className={`relative px-3 py-1.5 min-h-[36px] rounded-xl text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                      isSelected
                        ? 'text-slate-950'
                        : 'text-th-secondary hover:text-th-heading hover:bg-slate-900/5 dark:hover:bg-white/5'
                    }`}
                  >
                    {isSelected && (
                      <motion.div
                        layoutId="sync-filter-pill"
                        transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                        className="absolute inset-0 rounded-xl bg-sky-400"
                      />
                    )}
                    <span className="relative z-10">
                      {st} ({count})
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleClearSynced}
                className="px-3 py-2 min-h-[40px] rounded-xl text-xs font-semibold liquid-glass-interactive text-th-secondary hover:text-th-heading cursor-pointer whitespace-nowrap"
              >
                Prune Synced
              </button>

              <motion.button
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.98 }}
                type="button"
                disabled={isFlushing}
                onClick={handleFlushQueue}
                className="inline-flex items-center gap-2 px-4 py-2 min-h-[40px] rounded-xl text-xs font-bold bg-sky-500 text-slate-950 hover:bg-sky-400 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap shrink-0 shadow-sm"
              >
                {isFlushing ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                <span>Flush Outbox Queue</span>
              </motion.button>
            </div>
          </div>

          {filteredQueue.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <p className="text-sm font-bold text-th-heading">
                No mutations matching filter &ldquo;{statusFilter}&rdquo;
              </p>
              <p className="text-xs text-th-secondary">
                Use the panel on the left or edit records in the Database Explorer to populate the outbox.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-white/10">
              <AnimatePresence initial={false}>
                {filteredQueue.map((item) => (
                  <motion.div
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    key={item.id}
                    className="py-4 first:pt-1 last:pb-1 flex flex-col sm:flex-row sm:items-start justify-between gap-4"
                  >
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                        <span className="font-bold text-th-heading">
                          {item.operation}
                        </span>
                        <span className="text-th-muted">·</span>
                        <span className="text-sky-700 dark:text-sky-400 font-bold">
                          {item.tableName} / {item.recordKey}
                        </span>
                        <span className="text-th-muted">·</span>
                        <span
                          className={`font-bold ${
                            item.status === 'SYNCED'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : item.status === 'CONFLICT'
                              ? 'text-amber-700 dark:text-amber-400'
                              : item.status === 'FAILED'
                              ? 'text-rose-700 dark:text-rose-400'
                              : 'text-sky-700 dark:text-sky-300'
                          }`}
                        >
                          {item.status}
                        </span>
                        <span className="text-th-muted">·</span>
                        <span className="text-th-secondary tabular-nums">
                          Attempts: {item.attempts}/{item.maxAttempts}
                        </span>
                      </div>

                      <div className="text-xs font-mono text-th-secondary truncate">
                        Payload: {JSON.stringify(item.resolvedPayload ?? item.clientPayload)}
                      </div>

                      {item.lastError && (
                        <div className="text-xs font-semibold text-amber-800 dark:text-amber-400 flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>{item.lastError}</span>
                        </div>
                      )}

                      {item.resolutionStrategy && (
                        <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5 font-mono">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          <span>Resolved via {item.resolutionStrategy}</span>
                        </div>
                      )}

                      <div className="text-[11px] text-th-muted font-mono flex items-center gap-1.5">
                        <Clock className="w-3 h-3" />
                        <span>Client timestamp: {new Date(item.clientTimestamp).toLocaleTimeString()}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {item.status === 'CONFLICT' && (
                        <motion.button
                          whileHover={{ scale: 1.03 }}
                          whileTap={{ scale: 0.97 }}
                          type="button"
                          onClick={() => openConflictResolver(item)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[38px] rounded-xl text-xs font-bold bg-amber-500 text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
                        >
                          <GitMerge className="w-3.5 h-3.5" />
                          <span>Resolve Conflict</span>
                        </motion.button>
                      )}

                      {item.status === 'FAILED' && (
                        <button
                          type="button"
                          onClick={async () => {
                            await db.syncQueue.update(item.id, { status: 'PENDING', lastError: undefined });
                            await onRefresh();
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[38px] rounded-xl text-xs font-semibold liquid-glass-interactive cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Re-queue</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={async () => {
                          await db.syncQueue.delete(item.id);
                          await onRefresh();
                        }}
                        className="p-2 min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-th-muted hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                        title="Remove from queue"
                        aria-label={`Remove ${item.recordKey} from sync queue`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* Conflict Resolution Inspector Modal */}
      <AnimatePresence>
        {activeConflictItem && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-4 overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="conflict-modal-title"
          >
            <motion.div
              initial={{ scale: 0.96, y: 12, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.96, y: 12, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              className="liquid-glass-elevated w-full max-w-3xl rounded-3xl p-6 space-y-5 my-auto"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 id="conflict-modal-title" className="text-lg font-bold text-th-heading flex items-center gap-2">
                    <GitMerge className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                    <span>
                      Resolve Conflict: {activeConflictItem.tableName} / {activeConflictItem.recordKey}
                    </span>
                  </h3>
                  <p className="text-xs text-th-secondary mt-0.5">
                    Choose a deterministic strategy or manually merge fields to commit the winning state to IndexedDB.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveConflictItem(null)}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold liquid-glass-interactive cursor-pointer"
                >
                  Close
                </button>
              </div>

              {/* Side-by-Side Comparison */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="p-4 rounded-2xl bg-sky-500/12 border border-sky-500/35 space-y-2">
                  <div className="flex items-center justify-between font-bold text-sky-800 dark:text-sky-300">
                    <span>Local Client Outbox Version</span>
                    <span className="font-mono text-[11px]">
                      {new Date(activeConflictItem.clientTimestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <pre className="font-mono text-[11px] overflow-x-auto text-th-primary">
                    {JSON.stringify(activeConflictItem.clientPayload, null, 2)}
                  </pre>
                </div>

                <div className="p-4 rounded-2xl bg-indigo-500/12 border border-indigo-500/35 space-y-2">
                  <div className="flex items-center justify-between font-bold text-indigo-800 dark:text-indigo-300">
                    <span>Simulated Remote Server Version</span>
                    <span className="font-mono text-[11px]">
                      {activeConflictItem.serverTimestamp
                        ? new Date(activeConflictItem.serverTimestamp).toLocaleTimeString()
                        : 'N/A'}
                    </span>
                  </div>
                  <pre className="font-mono text-[11px] overflow-x-auto text-th-primary">
                    {JSON.stringify(activeConflictItem.serverPayload ?? {}, null, 2)}
                  </pre>
                </div>
              </div>

              {/* Manual Field Merge Editor */}
              <div>
                <label className="block text-xs font-bold text-th-secondary mb-1.5">
                  Custom Merged JSON Payload (used when clicking &ldquo;Apply Manual Merge&rdquo;)
                </label>
                <textarea
                  rows={5}
                  value={manualMergeJson}
                  onChange={(e) => setManualMergeJson(e.target.value)}
                  className="w-full p-3.5 rounded-2xl bg-th-code border border-th-strong font-mono text-xs text-th-primary"
                />
                {mergeError && (
                  <p className="text-xs font-semibold text-rose-600 dark:text-rose-400 mt-1">{mergeError}</p>
                )}
              </div>

              {/* 4 Resolution Buttons */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => handleResolveConflict('LWW')}
                  className="p-3 rounded-2xl liquid-glass-interactive text-left cursor-pointer"
                >
                  <div className="text-xs font-bold text-th-heading">
                    Last-Write-Wins (LWW)
                  </div>
                  <div className="text-[11px] text-th-secondary mt-0.5">
                    Compares timestamps; newest edit wins automatically.
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleResolveConflict('CLIENT_WINS')}
                  className="p-3 rounded-2xl liquid-glass-interactive text-left cursor-pointer"
                >
                  <div className="text-xs font-bold text-sky-700 dark:text-sky-400">
                    Client-Wins
                  </div>
                  <div className="text-[11px] text-th-secondary mt-0.5">
                    Overwrites remote state with local offline mutation.
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleResolveConflict('SERVER_WINS')}
                  className="p-3 rounded-2xl liquid-glass-interactive text-left cursor-pointer"
                >
                  <div className="text-xs font-bold text-indigo-700 dark:text-indigo-400">
                    Server-Wins
                  </div>
                  <div className="text-[11px] text-th-secondary mt-0.5">
                    Discards local mutation and adopts remote payload.
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleResolveConflict('MANUAL_MERGE')}
                  className="p-3 rounded-2xl bg-sky-500 text-slate-950 hover:bg-sky-400 text-left cursor-pointer transition-colors"
                >
                  <div className="text-xs font-bold">
                    Apply Manual Merge
                  </div>
                  <div className="text-[11px] text-slate-900/85 mt-0.5">
                    Commits custom JSON from the editor above.
                  </div>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
