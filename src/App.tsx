import { useState, useEffect, useCallback } from 'react';
import {
  LayoutGrid,
  Database,
  RefreshCw,
  Wrench,
  Settings,
  FileJson,
  ShieldCheck,
  Wifi,
  WifiOff,
  Sun,
  Moon,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  db,
  ensureSeedData,
  type ActivityLogItem,
  type BackupSnapshotMeta,
  type SyncQueueItem,
  type UserDatabaseMeta,
  type UserRecord,
  type UserTableMeta,
} from './db/offlineDb';
import { createBackupSnapshot } from './utils/backupEngine';
import {
  APP_VERSION,
  DEVELOPER_PROFILE,
  resolveInitialTheme,
  persistThemeSelection,
} from './utils/themeManager';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { OfflineKitLogo } from './components/OfflineKitLogo';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OverviewView, type RuntimeHealthMetrics } from './components/OverviewView';
import { DatabaseExplorerView } from './components/DatabaseExplorerView';
import { SyncPlaygroundView } from './components/SyncPlaygroundView';
import { DeveloperUtilitiesView } from './components/DeveloperUtilitiesView';
import { SettingsView } from './components/SettingsView';
import { BackupRestoreModal } from './components/BackupRestoreModal';
import { DiagnosticsModal } from './components/DiagnosticsModal';

export type NavTab = 'overview' | 'database' | 'sync' | 'utilities' | 'settings';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [selectedDbId, setSelectedDbId] = useState<string | null>(null);

  // Theme Preference: Use saved manual selection first; fallback to prefers-color-scheme
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined') {
      const prefersLight =
        window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
      return resolveInitialTheme(window.localStorage, prefersLight);
    }
    return 'dark';
  });

  const [reducedMotion, setReducedMotion] = useState<boolean>(() => {
    const saved = localStorage.getItem('offlinekit_reduced_motion');
    if (saved !== null) return saved === 'true';
    return typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
      root.style.colorScheme = 'dark';
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
      root.style.colorScheme = 'light';
    }
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', theme === 'dark' ? '#060913' : '#f1f5f9');
    }
    persistThemeSelection(theme, window.localStorage);
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    if (reducedMotion) {
      root.classList.add('reduce-motion');
    } else {
      root.classList.remove('reduce-motion');
    }
    localStorage.setItem('offlinekit_reduced_motion', String(reducedMotion));
  }, [reducedMotion]);

  // IndexedDB State
  const [isBooting, setIsBooting] = useState(true);
  const [databases, setDatabases] = useState<UserDatabaseMeta[]>([]);
  const [tables, setTables] = useState<UserTableMeta[]>([]);
  const [records, setRecords] = useState<UserRecord[]>([]);
  const [syncQueue, setSyncQueue] = useState<SyncQueueItem[]>([]);
  const [backups, setBackups] = useState<BackupSnapshotMeta[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLogItem[]>([]);
  const [storageQuota, setStorageQuota] = useState<{
    usageBytes: number;
    quotaBytes: number;
  } | null>(null);
  const [runtimeHealth, setRuntimeHealth] = useState<RuntimeHealthMetrics>({
    idbConnected: false,
    idbReadLatencyMs: 0,
    swStatus: 'checking',
    cachedAssetCount: 0,
  });

  // Simulated Network Mode for Sync Lab
  const [simulatedNetMode, setSimulatedNetMode] = useState<'ONLINE' | 'FLAKY' | 'OFFLINE'>('ONLINE');

  // Contextual Glass Modals
  const [backupModalOpen, setBackupModalOpen] = useState(false);
  const [diagnosticsModalOpen, setDiagnosticsModalOpen] = useState(false);

  const { isOnline } = useOnlineStatus();

  const refreshData = useCallback(async () => {
    const t0 = performance.now();
    const [dbs, tbls, recs, queue, bkps, logs] = await Promise.all([
      db.databases.orderBy('updatedAt').reverse().toArray(),
      db.tablesMeta.toArray(),
      db.records.orderBy('updatedAt').reverse().toArray(),
      db.syncQueue.orderBy('createdAt').reverse().toArray(),
      db.backups.orderBy('createdAt').reverse().toArray(),
      db.activityLogs.orderBy('timestamp').reverse().toArray(),
    ]);
    const idbReadLatencyMs = Math.max(1, Math.round(performance.now() - t0));

    setDatabases(dbs);
    setTables(tbls);
    setRecords(recs);
    setSyncQueue(queue);
    setBackups(bkps);
    setActivityLogs(logs);

    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
      try {
        const est = await navigator.storage.estimate();
        setStorageQuota({
          usageBytes: est.usage ?? 0,
          quotaBytes: est.quota ?? 0,
        });
      } catch {
        // ignore quota errors in restricted frames
      }
    }

    // Probe real Service Worker and CacheStorage status
    let swStatus: RuntimeHealthMetrics['swStatus'] = 'unsupported';
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        const active = regs.some((r) => r.active);
        const installingOrWaiting = regs.some((r) => r.installing || r.waiting);
        swStatus = active ? 'active' : installingOrWaiting ? 'installing' : 'unregistered';
      } catch {
        swStatus = 'restricted';
      }
    }

    let cachedAssetCount = 0;
    if (typeof window !== 'undefined' && 'caches' in window) {
      try {
        const keys = await window.caches.keys();
        for (const k of keys) {
          const cache = await window.caches.open(k);
          const reqs = await cache.keys();
          cachedAssetCount += reqs.length;
        }
      } catch {
        // ignore cache errors in restricted frames
      }
    }

    setRuntimeHealth({
      idbConnected: db.isOpen(),
      idbReadLatencyMs,
      swStatus,
      cachedAssetCount,
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await ensureSeedData();
        if (mounted) {
          await refreshData();
        }
      } finally {
        if (mounted) setIsBooting(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [refreshData]);

  const handleQuickCreateSnapshot = async () => {
    await createBackupSnapshot();
    await refreshData();
    setBackupModalOpen(true);
  };

  const pendingSyncCount = syncQueue.filter((i) => i.status !== 'SYNCED').length;

  const navItems: {
    id: NavTab;
    label: string;
    icon: typeof LayoutGrid;
    badge?: number;
  }[] = [
    { id: 'overview', label: 'Overview', icon: LayoutGrid },
    { id: 'database', label: 'Database', icon: Database, badge: databases.length },
    { id: 'sync', label: 'Sync Lab', icon: RefreshCw, badge: pendingSyncCount || undefined },
    { id: 'utilities', label: 'Utilities', icon: Wrench },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const springTransition = reducedMotion
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 420, damping: 32 };

  return (
    <div className="min-h-screen ambient-canvas text-th-primary flex flex-col">
      {/* Top Bar (3-Zone Contract: Brand Wordmark — Status / Workspace Context — Primary Action) */}
      <header className="sticky top-0 z-30 liquid-glass border-x-0 border-t-0 px-4 sm:px-8 py-3">
        <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-4 sm:gap-8">
          {/* Zone 1: Compact Logo & Title "OfflineKit" */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            type="button"
            onClick={() => setActiveTab('overview')}
            className="flex items-center gap-2.5 text-left cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-sky-500 rounded-xl"
          >
            <OfflineKitLogo className="w-8 h-8" />
            <span className="font-display text-lg font-bold tracking-tight text-th-heading">
              OfflineKit
            </span>
          </motion.button>

          {/* Zone 2: Connectivity & Quick Modal Triggers on Desktop */}
          <div className="hidden md:flex items-center gap-6 text-xs font-semibold text-th-secondary">
            <span
              className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              title="Real browser network connection status (navigator.onLine)"
            >
              {isOnline ? (
                <Wifi className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <WifiOff className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              )}
              <span>{isOnline ? 'Browser Online' : 'Browser Offline'}</span>
            </span>

            {simulatedNetMode !== 'ONLINE' && (
              <button
                type="button"
                onClick={() => setActiveTab('sync')}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-500/15 border border-amber-500/35 text-amber-800 dark:text-amber-300 font-mono text-[11px] cursor-pointer"
                title="Simulated Sync Lab network state (does not affect real browser network)"
              >
                <span>Sim: {simulatedNetMode}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setBackupModalOpen(true)}
              className="hover:text-sky-600 dark:hover:text-sky-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Backups ({backups.length})
            </button>

            <button
              type="button"
              onClick={() => setDiagnosticsModalOpen(true)}
              className="hover:text-sky-600 dark:hover:text-sky-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Diagnostics
            </button>
          </div>

          {/* Zone 3: Primary Actions (Theme Toggle & Install PWA) */}
          <div className="flex items-center gap-2.5 shrink-0">
            <motion.button
              whileTap={{ scale: 0.92, rotate: 12 }}
              type="button"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="px-3 py-2 min-h-[40px] rounded-xl liquid-glass-interactive flex items-center gap-2 text-xs font-semibold text-th-primary cursor-pointer focus-visible:outline-2 focus-visible:outline-sky-500"
              title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
              aria-label={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="hidden sm:inline">Light</span>
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span className="hidden sm:inline">Dark</span>
                </>
              )}
            </motion.button>

            <PWAInstallButton />
          </div>
        </div>
      </header>

      {/* Offline Banner when Browser Navigator is Offline */}
      <AnimatePresence>
        {!isOnline && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2 text-center text-xs font-semibold text-amber-800 dark:text-amber-200"
          >
            Browser Network is Offline (`navigator.onLine === false`) — OfflineKit is operating from local IndexedDB storage.
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Layout Container: Floating Glass Sidebar on Desktop + Main Content Viewport */}
      <div className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-8 pt-6 pb-28 lg:pb-12 flex flex-col lg:flex-row gap-6 items-start">
        {/* Desktop Floating Glass Sidebar with Shared Layout Spring Pill */}
        <aside
          aria-label="Primary Workspace Navigation"
          className="hidden lg:flex flex-col justify-between w-64 shrink-0 sticky top-22 liquid-glass-pill rounded-3xl p-4 min-h-[calc(100vh-7.5rem)]"
        >
          <div className="space-y-6">
            <nav className="space-y-1.5">
              {navItems.map(({ id, label, icon: Icon, badge }) => {
                const isActive = activeTab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveTab(id)}
                    className={`relative w-full flex items-center justify-between px-4 py-3 min-h-[44px] rounded-2xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      isActive
                        ? 'text-slate-950 font-bold'
                        : 'text-th-secondary hover:text-th-heading hover:bg-slate-900/5 dark:hover:bg-white/5'
                    }`}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="desktop-nav-pill"
                        transition={springTransition}
                        className="absolute inset-0 rounded-2xl bg-sky-400 dark:bg-sky-400 shadow-sm"
                      />
                    )}
                    <span className="relative z-10 flex items-center gap-3">
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{label}</span>
                    </span>
                    {badge !== undefined && badge > 0 && (
                      <span
                        className={`relative z-10 font-mono text-[11px] tabular-nums ${
                          isActive
                            ? 'text-slate-950 font-bold'
                            : 'text-th-muted'
                        }`}
                      >
                        {badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            {/* Quick Contextual Engines on Sidebar */}
            <div className="pt-4 border-t border-th-subtle space-y-1.5">
              <div className="px-3 pb-1 text-[11px] font-bold text-th-muted">
                Snapshots &amp; Health
              </div>
              <motion.button
                whileHover={{ x: 2 }}
                type="button"
                onClick={() => setBackupModalOpen(true)}
                className="w-full flex items-center gap-3 px-4 py-2.5 min-h-[40px] rounded-2xl text-xs font-semibold text-th-secondary hover:text-th-heading hover:bg-slate-900/5 dark:hover:bg-white/5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <FileJson className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                <span>Backup &amp; Restore</span>
              </motion.button>

              <motion.button
                whileHover={{ x: 2 }}
                type="button"
                onClick={() => setDiagnosticsModalOpen(true)}
                className="w-full flex items-center gap-3 px-4 py-2.5 min-h-[40px] rounded-2xl text-xs font-semibold text-th-secondary hover:text-th-heading hover:bg-slate-900/5 dark:hover:bg-white/5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>Run Diagnostics</span>
              </motion.button>
            </div>
          </div>

          {/* Bottom Storage Summary */}
          <div className="p-3.5 rounded-2xl bg-th-subtle border border-th-subtle space-y-1.5 text-xs">
            <div className="flex items-center justify-between font-semibold text-th-heading">
              <span>Local IndexedDB</span>
              <span
                className={`font-mono font-bold ${
                  runtimeHealth.idbConnected
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-amber-700 dark:text-amber-400'
                }`}
              >
                {runtimeHealth.idbConnected ? `Open (${runtimeHealth.idbReadLatencyMs}ms)` : 'Mounting'}
              </span>
            </div>
            <div className="text-[11px] text-th-muted font-mono tabular-nums">
              {databases.length} DBs · {tables.length} tables · {records.length} rows
            </div>
          </div>
        </aside>

        {/* Main Workspace Content with AnimatePresence Tab Transitions */}
        <main className="flex-1 w-full min-w-0">
          {isBooting ? (
            <div className="liquid-glass rounded-3xl p-12 text-center space-y-3">
              <RefreshCw className="w-6 h-6 text-sky-600 dark:text-sky-400 animate-spin mx-auto" />
              <div className="text-sm font-semibold text-th-heading">
                Mounting Local IndexedDB Environment...
              </div>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={reducedMotion ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reducedMotion ? undefined : { opacity: 0, y: -8 }}
                transition={{
                  duration: reducedMotion ? 0 : 0.2,
                  ease: [0.16, 1, 0.3, 1],
                }}
              >
                {activeTab === 'overview' && (
                  <OverviewView
                    databases={databases}
                    tables={tables}
                    records={records}
                    syncQueue={syncQueue}
                    backups={backups}
                    activityLogs={activityLogs}
                    isOnline={isOnline}
                    simulatedNetMode={simulatedNetMode}
                    storageQuota={storageQuota}
                    runtimeHealth={runtimeHealth}
                    onNavigateTab={setActiveTab}
                    onSelectDatabase={setSelectedDbId}
                    onOpenBackupModal={() => setBackupModalOpen(true)}
                    onOpenDiagnosticsModal={() => setDiagnosticsModalOpen(true)}
                    onQuickCreateSnapshot={handleQuickCreateSnapshot}
                  />
                )}

                {activeTab === 'database' && (
                  <DatabaseExplorerView
                    databases={databases}
                    tables={tables}
                    records={records}
                    selectedDbId={selectedDbId}
                    onSelectDbId={setSelectedDbId}
                    onRefresh={refreshData}
                    onOpenBackupModal={() => setBackupModalOpen(true)}
                  />
                )}

                {activeTab === 'sync' && (
                  <SyncPlaygroundView
                    databases={databases}
                    tables={tables}
                    syncQueue={syncQueue}
                    simulatedNetMode={simulatedNetMode}
                    onChangeSimulatedNetMode={setSimulatedNetMode}
                    onRefresh={refreshData}
                  />
                )}

                {activeTab === 'utilities' && (
                  <DeveloperUtilitiesView
                    databases={databases}
                    tables={tables}
                    records={records}
                  />
                )}

                {activeTab === 'settings' && (
                  <SettingsView
                    theme={theme}
                    onChangeTheme={setTheme}
                    reducedMotion={reducedMotion}
                    onChangeReducedMotion={setReducedMotion}
                    onRefresh={refreshData}
                    onOpenBackupModal={() => setBackupModalOpen(true)}
                    onOpenDiagnosticsModal={() => setDiagnosticsModalOpen(true)}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          )}

          {/* Subtle Open-Source Credit Footer */}
          <footer className="mt-8 pt-4 border-t border-th-subtle flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-th-muted">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-th-secondary">OfflineKit v{APP_VERSION}</span>
              <span>·</span>
              <span>Local-First Developer Toolkit</span>
            </div>
            <div className="flex items-center gap-3">
              <span>
                Built by{' '}
                <a
                  href={DEVELOPER_PROFILE.githubProfileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-th-secondary hover:text-sky-600 dark:hover:text-sky-400 hover:underline"
                >
                  {DEVELOPER_PROFILE.name}
                </a>
              </span>
              <span>·</span>
              <a
                href={DEVELOPER_PROFILE.repositoryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-th-secondary hover:text-sky-600 dark:hover:text-sky-400 hover:underline"
              >
                Source Code
              </a>
            </div>
          </footer>
        </main>
      </div>

      {/* Mobile Floating Pill Bottom Navigation Bar with Shared Layout Indicator */}
      <nav
        aria-label="Mobile Navigation"
        className="lg:hidden fixed bottom-3 left-3 right-3 z-40 liquid-glass-pill rounded-3xl px-2 py-1.5 grid grid-cols-5 items-center max-w-md mx-auto"
      >
        {navItems.map(({ id, label, icon: Icon }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`relative min-h-[48px] flex flex-col items-center justify-center rounded-2xl transition-colors cursor-pointer ${
                isActive
                  ? 'text-sky-700 dark:text-sky-300 font-bold'
                  : 'text-th-muted hover:text-th-heading'
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="mobile-nav-pill"
                  transition={springTransition}
                  className="absolute inset-1 rounded-xl bg-sky-500/15 border border-sky-500/35"
                />
              )}
              <Icon className="relative z-10 w-5 h-5" />
              <span className="relative z-10 text-[10px] tracking-tight mt-0.5 whitespace-nowrap">
                {label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Backup & Restore Engine Modal */}
      <BackupRestoreModal
        isOpen={backupModalOpen}
        onClose={() => setBackupModalOpen(false)}
        databases={databases}
        backups={backups}
        onRefresh={refreshData}
      />

      {/* Offline Readiness & Diagnostics Modal */}
      <DiagnosticsModal
        isOpen={diagnosticsModalOpen}
        onClose={() => setDiagnosticsModalOpen(false)}
        onRefreshApp={refreshData}
        isOnline={isOnline}
        simulatedNetMode={simulatedNetMode}
      />
    </div>
  );
}
