import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Play,
  X,
  HardDrive,
  Cpu,
  Wifi,
  WifiOff,
  FolderArchive,
  RotateCcw,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { db, logActivity } from '../db/offlineDb';
import {
  runInBrowserStorageTests,
  writeReloadVerificationMarker,
  inspectReloadVerificationMarker,
  type TestCaseResult,
  type ReloadPersistenceMarker,
} from '../utils/inBrowserTestSuite';

interface DiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefreshApp: () => Promise<void>;
  isOnline?: boolean;
  simulatedNetMode?: 'ONLINE' | 'FLAKY' | 'OFFLINE';
}

interface ProbeCheck {
  id: string;
  label: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  value: string;
  guidance: string;
}

interface CacheBucketSummary {
  bucketName: string;
  entryCount: number;
  sampleUrls: string[];
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export const DiagnosticsModal: React.FC<DiagnosticsModalProps> = ({
  isOpen,
  onClose,
  onRefreshApp,
  isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true,
  simulatedNetMode = 'ONLINE',
}) => {
  const [checks, setChecks] = useState<ProbeCheck[]>([]);
  const [isProbing, setIsProbing] = useState(false);
  const [quotaInfo, setQuotaInfo] = useState<{
    usage: number;
    quota: number;
    persisted: boolean | null;
  } | null>(null);

  const [cacheBuckets, setCacheBuckets] = useState<CacheBucketSummary[]>([]);
  const [reloadProbe, setReloadProbe] = useState<{
    marker: ReloadPersistenceMarker | null;
    verifiedInIndexedDb: boolean;
    currentDbCount: number;
    currentRecordCount: number;
  } | null>(null);

  const [testResults, setTestResults] = useState<TestCaseResult[] | null>(null);
  const [isRunningTests, setIsRunningTests] = useState(false);

  const runEnvironmentProbes = useCallback(async () => {
    setIsProbing(true);
    const list: ProbeCheck[] = [];

    // 1. IndexedDB Availability & Read/Write Latency Probe
    const idbSupported =
      typeof window !== 'undefined' && 'indexedDB' in window && !!window.indexedDB;
    let idbLatencyMs = 0;
    let idbReadWriteOk = false;
    if (idbSupported) {
      const t0 = performance.now();
      try {
        await db.open();
        await db.databases.count();
        idbLatencyMs = Math.max(1, Math.round(performance.now() - t0));
        idbReadWriteOk = true;
      } catch {
        idbReadWriteOk = false;
      }
    }
    list.push({
      id: 'idb',
      label: 'IndexedDB Engine & Read Probe',
      status: idbSupported && idbReadWriteOk ? 'PASS' : 'FAIL',
      value:
        idbSupported && idbReadWriteOk
          ? `Active · Dexie v4 (${idbLatencyMs} ms read latency)`
          : 'Unavailable or Blocked',
      guidance:
        idbSupported && idbReadWriteOk
          ? 'Transactional IndexedDB object stores are mounted and verified with live read probe.'
          : 'IndexedDB is disabled or blocked by browser privacy settings.',
    });

    // 2. Service Worker Registration & Controller Lifecycle Status
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        const activeReg = regs.find((r) => r.active || r.waiting || r.installing);
        const hasController = Boolean(navigator.serviceWorker.controller);
        const swState = activeReg?.active
          ? 'activated'
          : activeReg?.waiting
          ? 'waiting'
          : activeReg?.installing
          ? 'installing'
          : 'unregistered';

        list.push({
          id: 'sw',
          label: 'Service Worker Lifecycle',
          status: activeReg?.active ? 'PASS' : 'WARN',
          value: activeReg
            ? `State: ${swState.toUpperCase()} · Controller: ${hasController ? 'Active' : 'Pending Reload'}`
            : 'Supported · No Active Registration Yet',
          guidance: activeReg?.active
            ? `Scope: ${activeReg.scope} — Service Worker is intercepting network requests for offline capability.`
            : 'Service Worker API is supported. Note: In development mode (`vite`), Service Worker precaching activates in production builds (`npm run build && npm run preview`) or when devOptions are enabled.',
        });
      } catch (err) {
        list.push({
          id: 'sw',
          label: 'Service Worker Lifecycle',
          status: 'WARN',
          value: 'Restricted by Sandbox Context',
          guidance: `Browser prevented SW inspection (${(err as Error).message}). Open app in a top-level tab for full Service Worker lifecycle control.`,
        });
      }
    } else {
      list.push({
        id: 'sw',
        label: 'Service Worker Lifecycle',
        status: 'FAIL',
        value: 'Not Supported',
        guidance: 'Service Workers require a modern browser and a secure HTTPS or localhost origin.',
      });
    }

    // 3. Cache Storage API & Precached Assets Inspection
    const cacheSupported = typeof window !== 'undefined' && 'caches' in window;
    const buckets: CacheBucketSummary[] = [];
    let totalCachedAssets = 0;
    if (cacheSupported) {
      try {
        const keys = await window.caches.keys();
        for (const key of keys) {
          const cache = await window.caches.open(key);
          const reqs = await cache.keys();
          totalCachedAssets += reqs.length;
          buckets.push({
            bucketName: key,
            entryCount: reqs.length,
            sampleUrls: reqs.slice(0, 6).map((r) => {
              try {
                return new URL(r.url).pathname;
              } catch {
                return r.url;
              }
            }),
          });
        }
      } catch {
        // ignore sandbox restriction
      }
    }
    setCacheBuckets(buckets);
    list.push({
      id: 'cache',
      label: 'CacheStorage Asset Inventory',
      status: cacheSupported ? (totalCachedAssets > 0 ? 'PASS' : 'WARN') : 'FAIL',
      value: cacheSupported
        ? `${buckets.length} bucket(s) · ${totalCachedAssets} cached asset(s)`
        : 'Unavailable',
      guidance:
        totalCachedAssets > 0
          ? 'Application shell bundles and static assets are stored in CacheStorage for offline reload.'
          : 'CacheStorage API is available, but 0 precached assets are currently stored. Build and serve production bundle (`npm run build`) to populate Workbox precache.',
    });

    // 4. Storage Quota & Persistence
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
      try {
        const est = await navigator.storage.estimate();
        const persisted = navigator.storage.persisted
          ? await navigator.storage.persisted()
          : null;
        const usage = est.usage ?? 0;
        const quota = est.quota ?? 0;
        setQuotaInfo({ usage, quota, persisted });
        list.push({
          id: 'quota',
          label: 'Storage Manager Quota Estimate',
          status: 'PASS',
          value: `${formatBytes(usage)} used of ${formatBytes(quota)}`,
          guidance: persisted
            ? 'Origin storage is marked Persistent (browser will not evict local IndexedDB under storage pressure).'
            : 'Storage is currently Best-Effort. You can request Persistent Storage below.',
        });
      } catch {
        list.push({
          id: 'quota',
          label: 'Storage Manager Quota Estimate',
          status: 'WARN',
          value: 'Estimate Restricted',
          guidance: 'StorageManager API could not query origin quota in this frame.',
        });
      }
    }

    // 5. Inspect Reload Persistence Marker
    const probeStatus = await inspectReloadVerificationMarker();
    setReloadProbe(probeStatus);

    setChecks(list);
    setIsProbing(false);
    await logActivity(
      'DIAGNOSTICS',
      'Ran environment diagnostics',
      `Probed IndexedDB (${idbLatencyMs}ms), Service Worker, CacheStorage (${totalCachedAssets} assets), and StorageManager quota.`
    );
    await onRefreshApp();
  }, [onRefreshApp]);

  useEffect(() => {
    if (isOpen) {
      runEnvironmentProbes();
    }
  }, [isOpen, runEnvironmentProbes]);

  const handleRequestPersistence = async () => {
    if (navigator.storage && navigator.storage.persist) {
      const granted = await navigator.storage.persist();
      setQuotaInfo((prev) => (prev ? { ...prev, persisted: granted } : prev));
      await runEnvironmentProbes();
    }
  };

  const handleWriteReloadMarker = async (triggerReloadAfter: boolean) => {
    await writeReloadVerificationMarker();
    const updated = await inspectReloadVerificationMarker();
    setReloadProbe(updated);
    await onRefreshApp();
    if (triggerReloadAfter && typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  const handleExecuteTestSuite = async () => {
    setIsRunningTests(true);
    try {
      const res = await runInBrowserStorageTests();
      setTestResults(res);
      const passedCount = res.filter((r) => r.passed).length;
      await logActivity(
        'DIAGNOSTICS',
        'Executed storage & resilience test suite',
        `${passedCount}/${res.length} IndexedDB CRUD, persistence, backup conflict, and rollback assertions passed.`
      );
      await onRefreshApp();
    } finally {
      setIsRunningTests(false);
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
          aria-labelledby="diagnostics-modal-title"
        >
          <motion.div
            initial={{ scale: 0.96, y: 14, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.96, y: 12, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            className="liquid-glass-elevated w-full max-w-4xl rounded-3xl p-5 sm:p-7 space-y-6 my-auto max-h-[90vh] overflow-y-auto"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-4 border-b border-th-subtle pb-4">
              <div>
                <h2
                  id="diagnostics-modal-title"
                  className="text-xl font-bold text-th-heading flex items-center gap-2.5"
                >
                  <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  <span>Offline Testing &amp; Storage Diagnostics</span>
                </h2>
                <p className="text-xs text-th-secondary mt-1">
                  Inspect real browser network state vs. simulated Sync Lab modes, verify Service Worker &amp; CacheStorage assets, test page-reload persistence, and run 9 automated E2E storage assertions.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-2 min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-th-muted hover:text-th-heading cursor-pointer"
                aria-label="Close Diagnostics modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Real Browser Network vs Simulated Network Distinction */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-4 rounded-2xl bg-th-subtle border border-th-subtle space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-th-heading flex items-center gap-1.5">
                    {isOnline ? (
                      <Wifi className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <WifiOff className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    )}
                    <span>Real Browser Network (`navigator.onLine`)</span>
                  </span>
                  <span
                    className={`font-mono font-bold ${
                      isOnline
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    {isOnline ? 'ONLINE' : 'BROWSER OFFLINE'}
                  </span>
                </div>
                <p className="text-th-secondary leading-relaxed">
                  Reflects actual OS network adapter / DevTools Network offline state. To test genuine offline reload, toggle <strong>Offline</strong> in Browser DevTools → Network tab and refresh.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-th-subtle border border-th-subtle space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-th-heading flex items-center gap-1.5">
                    <RefreshCw className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                    <span>Sync Lab Uplink Mode [SIMULATION ONLY]</span>
                  </span>
                  <span className="font-mono font-bold text-sky-700 dark:text-sky-400">
                    SIMULATED: {simulatedNetMode}
                  </span>
                </div>
                <p className="text-th-secondary leading-relaxed">
                  Applies only to the Sync Playground outbox queue to test retry backoff and HTTP 409 conflict strategies without disconnecting your browser.
                </p>
              </div>
            </div>

            {/* Storage Quota Visual Bar */}
            {quotaInfo && (
              <div className="p-4 rounded-2xl bg-th-subtle border border-th-subtle space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                  <div className="font-bold text-th-heading flex items-center gap-2">
                    <HardDrive className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                    <span>Origin Storage Quota Allocation</span>
                  </div>
                  <div className="font-mono font-semibold text-th-secondary tabular-nums">
                    {formatBytes(quotaInfo.usage)} used / {formatBytes(quotaInfo.quota)} total (
                    {quotaInfo.quota > 0
                      ? ((quotaInfo.usage / quotaInfo.quota) * 100).toFixed(3)
                      : '0.00'}
                    %)
                  </div>
                </div>

                <div className="w-full h-2.5 rounded-full bg-slate-300 dark:bg-slate-800 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{
                      width: `${Math.max(
                        2,
                        Math.min(
                          100,
                          quotaInfo.quota > 0 ? (quotaInfo.usage / quotaInfo.quota) * 100 : 2
                        )
                      )}%`,
                    }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                    className="h-full bg-gradient-to-r from-sky-500 to-indigo-500 rounded-full"
                  />
                </div>

                <div className="flex items-center justify-between text-xs pt-1">
                  <span className="text-th-secondary">
                    Eviction Policy:{' '}
                    <strong className="text-th-heading">
                      {quotaInfo.persisted ? 'Persistent (Protected)' : 'Best-Effort Standard'}
                    </strong>
                  </span>
                  {!quotaInfo.persisted && (
                    <button
                      type="button"
                      onClick={handleRequestPersistence}
                      className="text-xs font-bold text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
                    >
                      Request Persistent Storage Permission →
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Environment Probe Matrix */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-th-secondary flex items-center gap-1.5">
                  <Wifi className="w-3.5 h-3.5" />
                  <span>Browser Capability &amp; Service Worker Probes</span>
                </h3>
                <button
                  type="button"
                  onClick={runEnvironmentProbes}
                  disabled={isProbing}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-xl text-xs font-semibold liquid-glass-interactive cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isProbing ? 'animate-spin' : ''}`} />
                  <span>Re-probe Environment</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {checks.map((chk) => (
                  <div
                    key={chk.id}
                    className="p-4 rounded-2xl bg-th-subtle border border-th-subtle space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-th-heading">
                        {chk.label}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-mono font-bold ${
                          chk.status === 'PASS'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : chk.status === 'WARN'
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-rose-700 dark:text-rose-400'
                        }`}
                      >
                        {chk.status === 'PASS' ? (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        ) : (
                          <AlertTriangle className="w-3.5 h-3.5" />
                        )}
                        {chk.status}
                      </span>
                    </div>
                    <div className="text-xs font-mono font-semibold text-sky-700 dark:text-sky-300">
                      {chk.value}
                    </div>
                    <p className="text-xs text-th-secondary leading-relaxed">
                      {chk.guidance}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* CacheStorage Asset Inspector */}
            {cacheBuckets.length > 0 && (
              <div className="p-4 rounded-2xl bg-th-subtle border border-th-subtle space-y-2.5 text-xs">
                <div className="font-bold text-th-heading flex items-center gap-2">
                  <FolderArchive className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <span>Cached Application Assets (`window.caches`)</span>
                </div>
                <div className="space-y-2">
                  {cacheBuckets.map((b) => (
                    <div
                      key={b.bucketName}
                      className="p-3 rounded-xl bg-th-input border border-th-subtle space-y-1 font-mono"
                    >
                      <div className="flex items-center justify-between font-bold text-th-heading">
                        <span>{b.bucketName}</span>
                        <span className="text-sky-700 dark:text-sky-400">
                          {b.entryCount} cached URLs
                        </span>
                      </div>
                      <div className="text-[11px] text-th-secondary truncate">
                        Sample assets: {b.sampleUrls.join(', ') || 'none'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Page Reload & IndexedDB Persistence Verification Tool */}
            <div className="p-4 sm:p-5 rounded-2xl bg-th-subtle border border-th-subtle space-y-3 text-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-th-heading flex items-center gap-2">
                    <RotateCcw className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                    <span>Page Refresh &amp; Offline Reload Persistence Verification</span>
                  </h3>
                  <p className="text-xs text-th-secondary mt-0.5">
                    Write a timestamped checkpoint marker to IndexedDB, reload the browser tab, and verify that local records survive across page refreshes.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleWriteReloadMarker(false)}
                    className="px-3 py-2 min-h-[38px] rounded-xl font-semibold liquid-glass-interactive cursor-pointer whitespace-nowrap"
                  >
                    Write Checkpoint Marker
                  </button>
                  <button
                    type="button"
                    onClick={() => handleWriteReloadMarker(true)}
                    className="px-3.5 py-2 min-h-[38px] rounded-xl font-bold bg-sky-500 text-slate-950 hover:bg-sky-400 cursor-pointer whitespace-nowrap"
                  >
                    Write Marker &amp; Reload Page
                  </button>
                </div>
              </div>

              {reloadProbe?.marker ? (
                <div className="p-3.5 rounded-xl bg-emerald-500/12 border border-emerald-500/35 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>
                        Checkpoint Marker `{reloadProbe.marker.markerId}`{' '}
                        {reloadProbe.verifiedInIndexedDb
                          ? 'Verified in IndexedDB Audit Log'
                          : 'Stored'}
                      </span>
                    </div>
                    <div className="font-mono text-[11px] text-th-secondary">
                      Written at {new Date(reloadProbe.marker.writtenAt).toLocaleTimeString()} (
                      {reloadProbe.marker.dbCountAtWrite} DBs,{' '}
                      {reloadProbe.marker.recordCountAtWrite} records) · Current IndexedDB:{' '}
                      {reloadProbe.currentDbCount} DBs, {reloadProbe.currentRecordCount} records
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-th-muted font-mono text-[11px]">
                  No reload verification marker recorded yet in this session.
                </div>
              )}
            </div>

            {/* Automated Storage & Backup Unit Test Runner */}
            <div className="p-5 rounded-3xl bg-th-subtle border border-th-subtle space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-th-heading flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <span>In-Browser E2E Storage, Backup &amp; Rollback Test Suite (9 Cases)</span>
                  </h3>
                  <p className="text-xs text-th-secondary mt-0.5">
                    Executes 9 repeatable integration tests against an isolated ephemeral IndexedDB database (`OfflineKit_TestSandbox`), verifying CRUD, filtering, strict schema guards, connection close/reopen persistence, conflict strategies, and atomic transaction rollback.
                  </p>
                </div>

                <motion.button
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  disabled={isRunningTests}
                  onClick={handleExecuteTestSuite}
                  className="inline-flex items-center gap-2 px-4 py-2 min-h-[40px] rounded-xl text-xs font-bold bg-sky-500 text-slate-950 hover:bg-sky-400 transition-colors cursor-pointer whitespace-nowrap shrink-0 shadow-sm"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>{isRunningTests ? 'Running 9 Tests...' : 'Run 9-Case Test Suite'}</span>
                </motion.button>
              </div>

              {testResults && (
                <div className="divide-y divide-slate-200 dark:divide-white/10 text-xs">
                  {testResults.map((tr, i) => (
                    <motion.div
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04 }}
                      key={tr.id}
                      className="py-2.5 flex items-start justify-between gap-3"
                    >
                      <div className="space-y-0.5">
                        <div className="font-bold text-th-heading flex items-center gap-2">
                          {tr.passed ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                          )}
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-th-input border border-th-subtle text-th-secondary">
                            {tr.category}
                          </span>
                          <span>{tr.name}</span>
                        </div>
                        <div className="text-th-secondary font-mono pl-6">
                          {tr.assertionDetail}
                        </div>
                      </div>
                      <span className="font-mono text-th-muted tabular-nums shrink-0 font-semibold">
                        {tr.durationMs} ms
                      </span>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
