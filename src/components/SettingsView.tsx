import React, { useState } from 'react';
import {
  Sun,
  Moon,
  Sparkles,
  Download,
  RotateCcw,
  Trash2,
  Shield,
  AlertTriangle,
  CheckCircle2,
  FileJson,
  ShieldCheck,
  ExternalLink,
  Code2,
  UserCheck,
  Scale,
} from 'lucide-react';
import { purgeAllData, seedDemoEnvironment } from '../db/offlineDb';
import { createBackupSnapshot } from '../utils/backupEngine';
import { APP_VERSION, DEVELOPER_PROFILE } from '../utils/themeManager';
import { OfflineKitLogo } from './OfflineKitLogo';

interface SettingsViewProps {
  theme: 'dark' | 'light';
  onChangeTheme: (theme: 'dark' | 'light') => void;
  reducedMotion: boolean;
  onChangeReducedMotion: (reduced: boolean) => void;
  onRefresh: () => Promise<void>;
  onOpenBackupModal: () => void;
  onOpenDiagnosticsModal: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  theme,
  onChangeTheme,
  reducedMotion,
  onChangeReducedMotion,
  onRefresh,
  onOpenBackupModal,
  onOpenDiagnosticsModal,
}) => {
  const [confirmAction, setConfirmAction] = useState<'purge' | 'reseed' | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleInstantExportDownload = async () => {
    const snap = await createBackupSnapshot('Full Workspace Export');
    await onRefresh();
    const blob = new Blob([snap.payloadJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `offlinekit-full-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setFeedback(
      `Exported ${snap.recordCount} records across ${snap.databaseCount} databases (${snap.checksum}).`
    );
  };

  const handleConfirmAction = async () => {
    if (confirmAction === 'purge') {
      await purgeAllData();
      await onRefresh();
      setFeedback(
        'Purged all local databases, tables, records, sync queues, and snapshots from IndexedDB.'
      );
    } else if (confirmAction === 'reseed') {
      await seedDemoEnvironment();
      await onRefresh();
      setFeedback('Restored default FieldOps_EdgeDB and MobilePOS_Ledger demo workspace.');
    }
    setConfirmAction(null);
  };

  return (
    <div className="space-y-6">
      <div className="liquid-glass rounded-3xl p-5 sm:p-6">
        <h1 className="text-xl sm:text-2xl font-bold text-th-heading">
          Settings, Appearance &amp; Data Governance
        </h1>
        <p className="text-xs sm:text-sm text-th-secondary mt-0.5">
          Configure Liquid Glass theme modes, motion accessibility, local backup exports, deterministic storage lifecycle controls, and open-source project details.
        </p>
      </div>

      {feedback && (
        <div
          role="status"
          className="liquid-glass-elevated rounded-2xl px-4 py-3 text-xs font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Appearance & Accessibility */}
        <div className="lg:col-span-6 liquid-glass rounded-3xl p-6 space-y-6">
          <div>
            <h2 className="text-base font-bold text-th-heading">
              Appearance &amp; Motion
            </h2>
            <p className="text-xs text-th-secondary mt-0.5">
              Customize translucent glass contrast and animation behavior.
            </p>
          </div>

          {/* Theme Selection */}
          <div className="space-y-2.5">
            <label className="block text-xs font-bold text-th-secondary">
              Surface Theme
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => onChangeTheme('dark')}
                className={`p-4 rounded-2xl border text-left transition-colors cursor-pointer flex items-start gap-3 ${
                  theme === 'dark'
                    ? 'border-sky-500 bg-sky-500/15'
                    : 'border-th-strong bg-th-subtle hover:bg-slate-900/5 dark:hover:bg-white/5'
                }`}
              >
                <Moon className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold text-th-heading">
                    Midnight Liquid Glass
                  </div>
                  <div className="text-[11px] text-th-secondary mt-0.5">
                    Deep midnight slate with cyan &amp; indigo specular edges.
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => onChangeTheme('light')}
                className={`p-4 rounded-2xl border text-left transition-colors cursor-pointer flex items-start gap-3 ${
                  theme === 'light'
                    ? 'border-sky-500 bg-sky-500/15'
                    : 'border-th-strong bg-th-subtle hover:bg-slate-900/5 dark:hover:bg-white/5'
                }`}
              >
                <Sun className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold text-th-heading">
                    Daylight Frosted Glass
                  </div>
                  <div className="text-[11px] text-th-secondary mt-0.5">
                    High-contrast cool alabaster with crisp translucent panels.
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Reduced Motion Toggle */}
          <div className="pt-4 border-t border-th-subtle flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-bold text-th-heading flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span>Reduced Motion Mode</span>
              </div>
              <p className="text-xs text-th-secondary mt-0.5">
                Suppresses spring transitions and micro-animations across all panels (also respects OS `prefers-reduced-motion`).
              </p>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={reducedMotion}
              onClick={() => onChangeReducedMotion(!reducedMotion)}
              className={`px-4 py-2 min-h-[40px] rounded-xl text-xs font-bold transition-colors cursor-pointer shrink-0 ${
                reducedMotion
                  ? 'bg-sky-500 text-slate-950'
                  : 'liquid-glass-interactive text-th-primary'
              }`}
            >
              {reducedMotion ? 'Enabled' : 'Standard Motion'}
            </button>
          </div>
        </div>

        {/* Data Governance, Export & Deletion Controls */}
        <div className="lg:col-span-6 liquid-glass rounded-3xl p-6 space-y-5">
          <div>
            <h2 className="text-base font-bold text-th-heading">
              Data Management &amp; Export Controls
            </h2>
            <p className="text-xs text-th-secondary mt-0.5">
              Export portable JSON backups, reset demo datasets, or permanently purge browser storage.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleInstantExportDownload}
              className="p-3.5 rounded-2xl bg-sky-500 text-slate-950 hover:bg-sky-400 transition-colors text-left cursor-pointer flex items-center gap-3 shadow-sm"
            >
              <Download className="w-4 h-4 shrink-0" />
              <div>
                <div className="text-xs font-bold">Export All Data (.json)</div>
                <div className="text-[11px] text-slate-900/85 font-medium">
                  Download instant snapshot
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={onOpenBackupModal}
              className="p-3.5 rounded-2xl liquid-glass-interactive text-left cursor-pointer flex items-center gap-3"
            >
              <FileJson className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <div>
                <div className="text-xs font-bold text-th-heading">
                  Backup &amp; Restore Manager
                </div>
                <div className="text-[11px] text-th-secondary">
                  Diff preview &amp; conflict merge
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setConfirmAction('reseed')}
              className="p-3.5 rounded-2xl liquid-glass-interactive text-left cursor-pointer flex items-center gap-3"
            >
              <RotateCcw className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div>
                <div className="text-xs font-bold text-th-heading">
                  Reset to Demo Seed Data
                </div>
                <div className="text-[11px] text-th-secondary">
                  Restore sample databases &amp; queue
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setConfirmAction('purge')}
              className="p-3.5 rounded-2xl border border-rose-500/35 bg-rose-500/12 hover:bg-rose-500/20 text-left cursor-pointer flex items-center gap-3 transition-colors"
            >
              <Trash2 className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
              <div>
                <div className="text-xs font-bold text-rose-700 dark:text-rose-300">
                  Purge All Local Data
                </div>
                <div className="text-[11px] text-rose-700/85 dark:text-rose-300/85">
                  Wipe IndexedDB &amp; start empty
                </div>
              </div>
            </button>
          </div>

          <div className="pt-3 border-t border-th-subtle flex items-center justify-between text-xs">
            <span className="text-th-secondary">
              Need to verify Service Worker or IndexedDB health?
            </span>
            <button
              type="button"
              onClick={onOpenDiagnosticsModal}
              className="font-bold text-sky-700 dark:text-sky-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Open Diagnostics</span>
            </button>
          </div>
        </div>
      </div>

      {/* Transparent Privacy & Storage Mechanics Documentation */}
      <div className="liquid-glass rounded-3xl p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <Shield className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          <h2 className="text-base font-bold text-th-heading">
            How Local Storage, Export, Import &amp; Deletion Work
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-xs text-th-secondary leading-relaxed">
          <div className="space-y-1.5">
            <h3 className="font-bold text-th-heading">
              1. 100% On-Device IndexedDB Storage
            </h3>
            <p>
              All databases, tables, JSON records, sync queue items, and activity logs are stored inside your browser&apos;s native{' '}
              <code className="text-th-heading font-semibold">IndexedDB</code> under the database name{' '}
              <code className="text-th-heading font-semibold">OfflineKitCoreDB</code> via Dexie.js. No network requests, analytics beacons, or external servers ever receive your data.
            </p>
          </div>

          <div className="space-y-1.5">
            <h3 className="font-bold text-th-heading">
              2. Deterministic Export &amp; Conflict-Safe Import
            </h3>
            <p>
              When you export a backup, OfflineKit serializes your selected databases, schemas, and records into a human-readable{' '}
              <code className="text-th-heading font-semibold">offlinekit-backup-v1</code> JSON file with an integrity checksum. Importing a file runs client-side schema validation and computes primary-key diffs before writing a single byte.
            </p>
          </div>

          <div className="space-y-1.5">
            <h3 className="font-bold text-th-heading">
              3. Verifiable Deletion &amp; Purge
            </h3>
            <p>
              Deleting a record, table, or database executes an atomic read-write transaction in IndexedDB that removes all child records immediately. Clicking{' '}
              <strong className="text-th-heading">Purge All Local Data</strong> clears every object store in{' '}
              <code className="text-th-heading font-semibold">OfflineKitCoreDB</code> and prevents automatic re-seeding until you explicitly request demo data.
            </p>
          </div>
        </div>
      </div>

      {/* Settings -> About Section */}
      <section
        aria-labelledby="about-offlinekit-heading"
        className="liquid-glass rounded-3xl p-6 space-y-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-th-subtle">
          <div className="flex items-center gap-3.5">
            <OfflineKitLogo className="w-11 h-11" />
            <div>
              <div className="flex items-center gap-2.5">
                <h2
                  id="about-offlinekit-heading"
                  className="text-base sm:text-lg font-bold text-th-heading"
                >
                  About OfflineKit
                </h2>
                <span className="font-mono text-xs font-bold px-2.5 py-0.5 rounded-lg bg-sky-500/15 border border-sky-500/35 text-sky-700 dark:text-sky-300">
                  v{APP_VERSION}
                </span>
              </div>
              <p className="text-xs text-th-secondary mt-0.5">
                Open-source local-first developer workbench for building and testing resilient offline web applications.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <a
              href={DEVELOPER_PROFILE.githubProfileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3.5 py-2 min-h-[40px] rounded-xl text-xs font-semibold liquid-glass-interactive text-th-primary cursor-pointer whitespace-nowrap"
            >
              <UserCheck className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
              <span>GitHub Profile</span>
              <ExternalLink className="w-3 h-3 text-th-muted" />
            </a>

            <a
              href={DEVELOPER_PROFILE.repositoryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3.5 py-2 min-h-[40px] rounded-xl text-xs font-bold bg-sky-500 text-slate-950 hover:bg-sky-400 transition-colors cursor-pointer whitespace-nowrap shadow-sm"
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>Source Code</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="p-4 rounded-2xl bg-th-subtle border border-th-subtle space-y-1">
            <div className="text-th-muted font-semibold flex items-center gap-1.5">
              <UserCheck className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
              <span>Author &amp; Maintainer</span>
            </div>
            <div className="text-sm font-bold text-th-heading">
              Developed by {DEVELOPER_PROFILE.name}
            </div>
            <div className="font-mono text-[11px] text-th-secondary truncate">
              github.com/arnob123
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-th-subtle border border-th-subtle space-y-1">
            <div className="text-th-muted font-semibold flex items-center gap-1.5">
              <Code2 className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>Repository &amp; Stack</span>
            </div>
            <div className="text-sm font-bold text-th-heading">
              OpenDevKit · v{APP_VERSION}
            </div>
            <div className="font-mono text-[11px] text-th-secondary">
              React 19 · TypeScript · Vite · Dexie.js v4
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-th-subtle border border-th-subtle space-y-1">
            <div className="text-th-muted font-semibold flex items-center gap-1.5">
              <Scale className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Open-Source License</span>
            </div>
            <div className="text-sm font-bold text-th-heading">
              MIT License
            </div>
            <div className="text-[11px] text-th-secondary">
              Copyright (c) 2026 OfflineKit Contributors
            </div>
          </div>
        </div>
      </section>

      {/* Confirmation Modal */}
      {confirmAction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-confirm-title"
        >
          <div className="liquid-glass-elevated w-full max-w-md rounded-3xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-500/15 border border-amber-500/35 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 id="settings-confirm-title" className="text-base font-bold text-th-heading">
                  {confirmAction === 'purge'
                    ? 'Purge All Local IndexedDB Data?'
                    : 'Reset Workspace to Demo Seed Data?'}
                </h3>
                <p className="text-xs text-th-secondary mt-1 leading-relaxed">
                  {confirmAction === 'purge'
                    ? 'This will permanently delete all databases, tables, records, queued sync operations, and local snapshots stored in this browser.'
                    : 'This will replace your current local databases and sync queue with the default FieldOps_EdgeDB and MobilePOS_Ledger sample datasets.'}
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 min-h-[40px] rounded-xl text-xs font-semibold liquid-glass-interactive cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmAction}
                className={`px-4 py-2 min-h-[40px] rounded-xl text-xs font-bold cursor-pointer ${
                  confirmAction === 'purge'
                    ? 'bg-rose-600 text-white hover:bg-rose-500'
                    : 'bg-sky-500 text-slate-950 hover:bg-sky-400'
                }`}
              >
                {confirmAction === 'purge' ? 'Yes, Purge Everything' : 'Yes, Reset Demo Data'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
