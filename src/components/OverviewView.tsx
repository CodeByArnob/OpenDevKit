import React, { useState, useMemo } from 'react';
import {
  Database,
  FileJson,
  RefreshCw,
  ShieldCheck,
  HardDrive,
  ArrowUpRight,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Wifi,
  WifiOff,
  Layers,
  Clock,
  PieChart as PieChartIcon,
  FolderArchive,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { motion } from 'motion/react';
import type {
  ActivityLogItem,
  BackupSnapshotMeta,
  SyncQueueItem,
  UserDatabaseMeta,
  UserRecord,
  UserTableMeta,
} from '../db/offlineDb';

export interface RuntimeHealthMetrics {
  idbConnected: boolean;
  idbReadLatencyMs: number;
  swStatus: 'checking' | 'active' | 'installing' | 'unregistered' | 'restricted' | 'unsupported';
  cachedAssetCount: number;
}

interface OverviewViewProps {
  databases: UserDatabaseMeta[];
  tables: UserTableMeta[];
  records: UserRecord[];
  syncQueue: SyncQueueItem[];
  backups: BackupSnapshotMeta[];
  activityLogs: ActivityLogItem[];
  isOnline: boolean;
  simulatedNetMode: 'ONLINE' | 'FLAKY' | 'OFFLINE';
  storageQuota: { usageBytes: number; quotaBytes: number } | null;
  runtimeHealth?: RuntimeHealthMetrics;
  onNavigateTab: (tab: 'overview' | 'database' | 'sync' | 'utilities' | 'settings') => void;
  onSelectDatabase: (dbId: string) => void;
  onOpenBackupModal: () => void;
  onOpenDiagnosticsModal: () => void;
  onQuickCreateSnapshot: () => Promise<void>;
}

const CHART_PALETTE = [
  '#0ea5e9', // Sky Blue
  '#6366f1', // Indigo
  '#a855f7', // Violet
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ec4899', // Rose
];

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}

function formatRelativeTime(isoString: string): string {
  const diffSec = Math.round((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diffSec < 15) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

interface StorageBreakdownDatum {
  id: string;
  name: string;
  recordCount: number;
  tableCount: number;
  bytes: number;
  color: string;
  percentage: number;
}

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.055,
      delayChildren: 0.02,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.28,
      ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
    },
  },
};

export const OverviewView: React.FC<OverviewViewProps> = ({
  databases,
  tables,
  records,
  syncQueue,
  backups,
  activityLogs,
  isOnline,
  simulatedNetMode,
  storageQuota,
  runtimeHealth,
  onNavigateTab,
  onSelectDatabase,
  onOpenBackupModal,
  onOpenDiagnosticsModal,
}) => {
  const [hoveredDbId, setHoveredDbId] = useState<string | null>(null);

  const pendingOrFailed = syncQueue.filter((item) => item.status !== 'SYNCED');
  const conflictCount = syncQueue.filter((item) => item.status === 'CONFLICT').length;
  const latestBackup = backups[0] ?? null;

  const backupHealthState = !latestBackup
    ? {
        label: 'No Snapshot Yet',
        tone: 'text-amber-700 dark:text-amber-400',
        detail: 'Create your first JSON backup',
      }
    : latestBackup.recordCount === records.length &&
      latestBackup.databaseCount === databases.length
    ? {
        label: 'Verified & Current',
        tone: 'text-emerald-700 dark:text-emerald-400',
        detail: `${latestBackup.checksum.slice(0, 15)} · ${formatRelativeTime(latestBackup.createdAt)}`,
      }
    : {
        label: 'Drift Detected',
        tone: 'text-sky-700 dark:text-sky-400',
        detail: `${Math.abs(records.length - latestBackup.recordCount)} record delta since snapshot`,
      };

  const estimatedPayloadBytes = useMemo(
    () => records.reduce((sum, r) => sum + JSON.stringify(r.data).length, 0),
    [records]
  );

  // Compute Recharts Donut Data for Storage Usage Breakdown
  const storageBreakdownData: StorageBreakdownDatum[] = useMemo(() => {
    const totalRecs = Math.max(1, records.length);
    return databases.map((dbItem, idx) => {
      const dbRecords = records.filter((r) => r.databaseId === dbItem.id);
      const dbTables = tables.filter((t) => t.databaseId === dbItem.id);
      const dbBytes = dbRecords.reduce((sum, r) => sum + JSON.stringify(r.data).length, 0);
      return {
        id: dbItem.id,
        name: dbItem.name,
        recordCount: dbRecords.length,
        tableCount: dbTables.length,
        bytes: dbBytes,
        color: CHART_PALETTE[idx % CHART_PALETTE.length],
        percentage: records.length > 0 ? Math.round((dbRecords.length / totalRecs) * 100) : 0,
      };
    });
  }, [databases, tables, records]);

  const activeSlice = useMemo(
    () => storageBreakdownData.find((d) => d.id === hoveredDbId) ?? null,
    [storageBreakdownData, hoveredDbId]
  );

  const hasNonZeroRecords = records.length > 0;
  const chartData = hasNonZeroRecords
    ? storageBreakdownData.filter((d) => d.recordCount > 0)
    : [{ id: 'empty', name: 'Empty', recordCount: 1, tableCount: 0, bytes: 0, color: '#64748b', percentage: 0 }];

  const swDisplayLabel = useMemo(() => {
    if (!runtimeHealth) return 'Probing...';
    switch (runtimeHealth.swStatus) {
      case 'active':
        return `Active (${runtimeHealth.cachedAssetCount} cached assets)`;
      case 'installing':
        return 'Installing / Waiting';
      case 'unregistered':
        return 'Dev Mode (SW builds on prod)';
      case 'restricted':
        return 'Sandbox Restricted';
      case 'unsupported':
        return 'Unsupported';
      default:
        return 'Checking...';
    }
  }, [runtimeHealth]);

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="space-y-7"
    >
      {/* Hero Section & Primary Status Card */}
      <motion.section
        variants={itemVariants}
        className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch"
      >
        <div className="lg:col-span-7 liquid-glass rounded-3xl p-6 sm:p-8 flex flex-col justify-between relative overflow-hidden">
          {/* Subtle Ambient Radial Highlight */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 -right-24 w-64 h-64 rounded-full bg-sky-500/10 blur-3xl"
          />

          <div className="space-y-4 relative">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-sky-700 dark:text-sky-400">
              <span>Offline-First Developer Workbench</span>
              <span aria-hidden="true">·</span>
              <span>IndexedDB + Service Worker PWA</span>
            </div>

            <h1
              className="text-3xl sm:text-4xl lg:text-[2.6rem] font-bold tracking-tight text-th-heading leading-[1.12]"
              style={{ textWrap: 'balance' }}
            >
              Build resilient apps. Work anywhere.
            </h1>

            <p className="text-sm sm:text-base text-th-secondary max-w-2xl leading-relaxed">
              Inspect local IndexedDB object stores, simulate offline mutation queues and conflict resolution strategies, and export deterministic JSON snapshots with zero cloud dependencies.
            </p>
          </div>

          {/* Quick Action Buttons */}
          <div className="pt-6 mt-6 border-t border-th-subtle flex flex-wrap items-center gap-3 relative">
            <motion.button
              whileHover={{ y: -1.5 }}
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={() => onNavigateTab('database')}
              className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl text-xs sm:text-sm font-bold bg-sky-500 text-slate-950 hover:bg-sky-400 transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 shadow-sm"
            >
              <Database className="w-4 h-4" />
              <span>Explore Database</span>
            </motion.button>

            <motion.button
              whileHover={{ y: -1.5 }}
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={onOpenBackupModal}
              className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl text-xs sm:text-sm font-semibold liquid-glass-interactive text-th-primary cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
            >
              <FileJson className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <span>Create Backup</span>
            </motion.button>

            <motion.button
              whileHover={{ y: -1.5 }}
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={onOpenDiagnosticsModal}
              className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl text-xs sm:text-sm font-semibold liquid-glass-interactive text-th-primary cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
            >
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>Run Diagnostics</span>
            </motion.button>
          </div>
        </div>

        {/* Large Glass Status Card: Reflects Real Live Application State */}
        <div className="lg:col-span-5 liquid-glass-elevated rounded-3xl p-6 sm:p-8 flex flex-col justify-between">
          <div>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <motion.div
                  initial={{ scale: 0.85, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 360, damping: 24, delay: 0.1 }}
                  className={`w-11 h-11 rounded-2xl border flex items-center justify-center shrink-0 ${
                    runtimeHealth?.idbConnected !== false
                      ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-600 dark:text-emerald-400'
                      : 'bg-amber-500/15 border-amber-500/35 text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {runtimeHealth?.idbConnected !== false ? (
                    <CheckCircle2 className="w-6 h-6" />
                  ) : (
                    <AlertTriangle className="w-6 h-6" />
                  )}
                </motion.div>
                <div>
                  <h2 className="text-lg font-bold text-th-heading">
                    {runtimeHealth?.idbConnected !== false
                      ? 'Local-first environment ready'
                      : 'IndexedDB connection degraded'}
                  </h2>
                  <p className="text-xs text-th-muted mt-0.5 font-medium font-mono">
                    Dexie v4 · {runtimeHealth ? `${runtimeHealth.idbReadLatencyMs}ms read probe` : 'Active'}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-5 space-y-3 text-xs">
              <div className="flex items-center justify-between py-2 border-b border-th-subtle">
                <span className="text-th-secondary font-medium flex items-center gap-2">
                  {isOnline ? (
                    <Wifi className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <WifiOff className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                  )}
                  <span>Browser Network (`navigator.onLine`)</span>
                </span>
                <span className="font-mono font-semibold text-th-heading">
                  {isOnline ? 'Online' : 'Offline Mode'}
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-th-subtle">
                <span className="text-th-secondary font-medium flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                  <span>Sync Lab Uplink [SIMULATED]</span>
                </span>
                <span className="font-mono font-semibold text-th-heading">
                  {simulatedNetMode === 'ONLINE'
                    ? 'Sim: Online'
                    : simulatedNetMode === 'FLAKY'
                    ? 'Sim: Flaky (40% Drop)'
                    : 'Sim: Air-Gap Offline'}
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-th-subtle">
                <span className="text-th-secondary font-medium flex items-center gap-2">
                  <FolderArchive className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>Service Worker &amp; Cache</span>
                </span>
                <span className="font-mono font-semibold text-th-heading">
                  {swDisplayLabel}
                </span>
              </div>

              <div className="flex items-center justify-between py-2">
                <span className="text-th-secondary font-medium flex items-center gap-2">
                  <HardDrive className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  <span>IndexedDB Payload Footprint</span>
                </span>
                <span className="font-mono font-semibold text-th-heading tabular-nums">
                  {formatBytes(estimatedPayloadBytes)}
                  {storageQuota && storageQuota.usageBytes > 0
                    ? ` / ${formatBytes(storageQuota.usageBytes)} origin`
                    : ''}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-th-subtle flex items-center justify-between text-xs text-th-muted">
            <span>100% local IndexedDB persistence</span>
            <button
              type="button"
              onClick={onOpenDiagnosticsModal}
              className="font-bold text-sky-700 dark:text-sky-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
            >
              <span>Inspect SW &amp; Run 9 Tests</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </motion.section>

      {/* Four Metric Cards: Databases, Records, Queued Operations, Backup Health */}
      <motion.section
        variants={itemVariants}
        aria-label="Environment metrics"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
      >
        {/* Card 1: Databases */}
        <motion.div
          whileHover={{ y: -2 }}
          transition={{ duration: 0.16 }}
          className="liquid-glass rounded-2xl p-5 flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-xs text-th-secondary">
            <span className="font-semibold">Local Databases</span>
            <Database className="w-4 h-4 text-sky-600 dark:text-sky-400" />
          </div>
          <div className="mt-3">
            <div className="text-3xl font-bold font-mono tabular-nums text-th-heading">
              {databases.length}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 text-xs text-th-muted">
              <span className="font-mono tabular-nums font-semibold text-th-secondary">{tables.length}</span>
              <span>object stores configured</span>
            </div>
          </div>
        </motion.div>

        {/* Card 2: Records */}
        <motion.div
          whileHover={{ y: -2 }}
          transition={{ duration: 0.16 }}
          className="liquid-glass rounded-2xl p-5 flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-xs text-th-secondary">
            <span className="font-semibold">Stored Records</span>
            <Layers className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="mt-3">
            <div className="text-3xl font-bold font-mono tabular-nums text-th-heading">
              {records.length}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 text-xs text-th-muted">
              <span className="font-mono tabular-nums font-semibold text-th-secondary">{formatBytes(estimatedPayloadBytes)}</span>
              <span>·</span>
              <span>CRDT revision tracked</span>
            </div>
          </div>
        </motion.div>

        {/* Card 3: Queued Operations */}
        <motion.div
          whileHover={{ y: -2 }}
          transition={{ duration: 0.16 }}
          className="liquid-glass rounded-2xl p-5 flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-xs text-th-secondary">
            <span className="font-semibold">Queued Operations</span>
            {conflictCount > 0 ? (
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            ) : (
              <RefreshCw className="w-4 h-4 text-sky-600 dark:text-sky-400" />
            )}
          </div>
          <div className="mt-3">
            <div className="text-3xl font-bold font-mono tabular-nums text-th-heading">
              {pendingOrFailed.length}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 text-xs">
              {conflictCount > 0 ? (
                <button
                  type="button"
                  onClick={() => onNavigateTab('sync')}
                  className="text-amber-700 dark:text-amber-400 font-bold hover:underline cursor-pointer"
                >
                  {conflictCount} conflict{conflictCount > 1 ? 's' : ''} awaiting resolution →
                </button>
              ) : (
                <span className="text-th-muted">
                  Outbox mutations ready to flush
                </span>
              )}
            </div>
          </div>
        </motion.div>

        {/* Card 4: Backup Health */}
        <motion.div
          whileHover={{ y: -2 }}
          transition={{ duration: 0.16 }}
          className="liquid-glass rounded-2xl p-5 flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-xs text-th-secondary">
            <span className="font-semibold">Backup Health</span>
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="mt-3">
            <div className={`text-xl font-bold tracking-tight ${backupHealthState.tone}`}>
              {backupHealthState.label}
            </div>
            <div className="mt-2 text-xs text-th-muted font-mono truncate">
              {backupHealthState.detail}
            </div>
          </div>
        </motion.div>
      </motion.section>

      {/* Storage Usage Breakdown Card (Recharts Donut Chart + Interactive Breakdown Table) */}
      <motion.section
        variants={itemVariants}
        aria-label="Storage Usage Breakdown"
        className="liquid-glass rounded-3xl p-6 sm:p-7"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-5 border-b border-th-subtle">
          <div>
            <div className="flex items-center gap-2">
              <PieChartIcon className="w-4 h-4 text-sky-600 dark:text-sky-400" />
              <h2 className="text-base font-bold text-th-heading">
                Storage Usage Breakdown
              </h2>
            </div>
            <p className="text-xs text-th-secondary mt-0.5">
              Distribution of stored IndexedDB records and serialized JSON payload bytes across local databases.
            </p>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono text-th-muted tabular-nums">
            <span>Total Records: <strong className="text-th-heading">{records.length}</strong></span>
            <span>·</span>
            <span>Payload Size: <strong className="text-th-heading">{formatBytes(estimatedPayloadBytes)}</strong></span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center pt-5">
          {/* Donut Chart Canvas */}
          <div className="lg:col-span-5 relative h-60 flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="recordCount"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={68}
                  outerRadius={94}
                  paddingAngle={chartData.length > 1 ? 4 : 0}
                  stroke="none"
                  isAnimationActive={true}
                  animationDuration={550}
                  onMouseEnter={(_, idx) => {
                    const entry = chartData[idx];
                    if (entry && entry.id !== 'empty') {
                      setHoveredDbId(entry.id);
                    }
                  }}
                  onMouseLeave={() => setHoveredDbId(null)}
                >
                  {chartData.map((entry) => {
                    const isDimmed = hoveredDbId !== null && hoveredDbId !== entry.id;
                    return (
                      <Cell
                        key={entry.id}
                        fill={entry.color}
                        style={{
                          opacity: isDimmed ? 0.35 : 1,
                          transition: 'opacity 160ms ease',
                          cursor: entry.id !== 'empty' ? 'pointer' : 'default',
                        }}
                        onClick={() => {
                          if (entry.id !== 'empty') {
                            onSelectDatabase(entry.id);
                            onNavigateTab('database');
                          }
                        }}
                      />
                    );
                  })}
                </Pie>
                {hasNonZeroRecords && (
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const data = payload[0].payload as StorageBreakdownDatum;
                      return (
                        <div className="liquid-glass-elevated rounded-2xl px-3.5 py-2.5 text-xs shadow-lg">
                          <div className="font-mono font-bold text-th-heading flex items-center gap-2">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: data.color }}
                            />
                            <span>{data.name}</span>
                          </div>
                          <div className="mt-1 font-mono text-th-secondary tabular-nums">
                            {data.recordCount} records ({data.percentage}%) · {formatBytes(data.bytes)}
                          </div>
                        </div>
                      );
                    }}
                  />
                )}
              </PieChart>
            </ResponsiveContainer>

            {/* Center Donut Metric Readout */}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-4">
              <span className="text-[11px] font-semibold text-th-muted truncate max-w-[120px]">
                {activeSlice ? activeSlice.name : 'All Databases'}
              </span>
              <span className="text-2xl font-bold font-mono tabular-nums text-th-heading mt-0.5">
                {activeSlice ? activeSlice.recordCount : records.length}
              </span>
              <span className="text-[11px] font-mono font-semibold text-sky-700 dark:text-sky-400 tabular-nums">
                {activeSlice
                  ? `${activeSlice.percentage}% · ${formatBytes(activeSlice.bytes)}`
                  : `records stored`}
              </span>
            </div>
          </div>

          {/* Interactive Legend & Proportional Breakdown List */}
          <div className="lg:col-span-7 space-y-3">
            {storageBreakdownData.length === 0 ? (
              <div className="py-8 text-center text-xs text-th-muted">
                No local databases available to chart. Create a database in the Explorer to visualize record distribution.
              </div>
            ) : (
              storageBreakdownData.map((item) => {
                const isHighlighted = hoveredDbId === item.id;
                return (
                  <motion.div
                    key={item.id}
                    whileHover={{ x: 3 }}
                    transition={{ duration: 0.15 }}
                    onMouseEnter={() => setHoveredDbId(item.id)}
                    onMouseLeave={() => setHoveredDbId(null)}
                    onClick={() => {
                      onSelectDatabase(item.id);
                      onNavigateTab('database');
                    }}
                    className={`p-3.5 rounded-2xl border transition-colors cursor-pointer ${
                      isHighlighted
                        ? 'bg-sky-500/12 border-sky-500/45'
                        : 'bg-th-subtle border-th-subtle'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="font-mono font-bold text-th-heading truncate">
                          {item.name}
                        </span>
                        <span className="text-th-muted font-mono">
                          · {item.tableCount} tables
                        </span>
                      </div>

                      <div className="font-mono tabular-nums text-right shrink-0 flex items-center gap-2">
                        <span className="font-bold text-th-heading">
                          {item.recordCount} recs
                        </span>
                        <span className="text-th-muted">·</span>
                        <span className="text-th-secondary">
                          {formatBytes(item.bytes)}
                        </span>
                        <span className="text-sky-700 dark:text-sky-400 font-bold w-9 text-right">
                          {item.percentage}%
                        </span>
                      </div>
                    </div>

                    {/* Animated Progress Bar */}
                    <div className="mt-2.5 w-full h-1.5 rounded-full bg-slate-300/70 dark:bg-slate-800 overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.max(item.recordCount > 0 ? 4 : 0, item.percentage)}%` }}
                        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                        className="h-full rounded-full"
                        style={{ backgroundColor: item.color }}
                      />
                    </div>
                  </motion.div>
                );
              })
            )}
          </div>
        </div>
      </motion.section>

      {/* Lower Split: Active Databases Overview + Recent Activity Audit Trail */}
      <motion.section
        variants={itemVariants}
        className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start"
      >
        {/* Local Databases Inventory */}
        <div className="lg:col-span-7 liquid-glass rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-th-heading">
                Local Database Workspaces
              </h2>
              <p className="text-xs text-th-secondary mt-0.5">
                Select a database to inspect schemas, run queries, or mutate JSON records.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('database')}
              className="px-3 py-1.5 min-h-[38px] rounded-xl text-xs font-bold text-sky-700 dark:text-sky-400 hover:bg-sky-500/10 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              Open Explorer →
            </button>
          </div>

          {databases.length === 0 ? (
            <div className="py-10 text-center space-y-3 border border-dashed border-th-strong rounded-2xl">
              <p className="text-sm font-bold text-th-heading">
                No local databases mounted
              </p>
              <p className="text-xs text-th-secondary max-w-sm mx-auto">
                Create a new database in the Explorer or restore from a JSON snapshot.
              </p>
              <button
                type="button"
                onClick={() => onNavigateTab('database')}
                className="px-4 py-2 min-h-[40px] rounded-xl text-xs font-bold bg-sky-500 text-slate-950 hover:bg-sky-400 transition-colors cursor-pointer"
              >
                Create First Database
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-white/10">
              {databases.map((dbItem) => {
                const dbTables = tables.filter((t) => t.databaseId === dbItem.id);
                const dbRecords = records.filter((r) => r.databaseId === dbItem.id);
                return (
                  <div
                    key={dbItem.id}
                    className="py-4 first:pt-1 last:pb-1 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2.5">
                        <span className="font-mono text-sm font-bold text-th-heading">
                          {dbItem.name}
                        </span>
                        <span className="text-xs text-th-muted font-mono">
                          · v{dbItem.version}
                        </span>
                      </div>
                      <p className="text-xs text-th-secondary line-clamp-1">
                        {dbItem.description}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-th-muted font-mono">
                        <span>{dbTables.length} tables</span>
                        <span>·</span>
                        <span>{dbRecords.length} records</span>
                        <span>·</span>
                        <span>Updated {formatRelativeTime(dbItem.updatedAt)}</span>
                      </div>
                    </div>

                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      type="button"
                      onClick={() => {
                        onSelectDatabase(dbItem.id);
                        onNavigateTab('database');
                      }}
                      className="self-start sm:self-center px-3.5 py-2 min-h-[40px] rounded-xl text-xs font-semibold liquid-glass-interactive text-th-primary cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Inspect Store
                    </motion.button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent Activity Log */}
        <div className="lg:col-span-5 liquid-glass rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-sky-600 dark:text-sky-400" />
              <h2 className="text-base font-bold text-th-heading">
                Recent Local Activity
              </h2>
            </div>
            <span className="text-xs text-th-muted font-mono tabular-nums font-semibold">
              {activityLogs.length} events
            </span>
          </div>

          {activityLogs.length === 0 ? (
            <div className="py-8 text-center text-xs text-th-muted">
              No local operations recorded yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-white/10 max-h-[340px] overflow-y-auto pr-1">
              {activityLogs.slice(0, 8).map((log) => (
                <div key={log.id} className="py-3 first:pt-0 last:pb-0 space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-bold text-th-heading">
                      {log.action}
                    </span>
                    <span className="text-th-muted font-mono tabular-nums inline-flex items-center gap-1 shrink-0">
                      <Clock className="w-3 h-3" />
                      {formatRelativeTime(log.timestamp)}
                    </span>
                  </div>
                  <p className="text-xs text-th-secondary leading-relaxed">
                    {log.detail}
                  </p>
                  <div className="text-[11px] text-th-muted font-mono">
                    {log.category} ·{' '}
                    {new Date(log.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.section>
    </motion.div>
  );
};
