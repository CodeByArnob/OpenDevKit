import React, { useState } from 'react';
import { Download, Share, X, CheckCircle2 } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showModal, setShowModal] = useState(false);

  if (isInstalled) {
    return (
      <span className="hidden sm:inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap shrink-0">
        <CheckCircle2 className="w-3.5 h-3.5" />
        <span>Installed App</span>
      </span>
    );
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex items-center gap-2 px-3.5 py-2 min-h-[40px] rounded-xl text-xs font-bold bg-sky-500 text-slate-950 hover:bg-sky-400 transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 shadow-sm"
      >
        <Download className="w-3.5 h-3.5" />
        <span>Install App</span>
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className="inline-flex items-center gap-2 px-3.5 py-2 min-h-[40px] rounded-xl text-xs font-semibold liquid-glass-interactive text-th-primary cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
        title="Install OfflineKit as a standalone Progressive Web App"
      >
        <Download className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
        <span>{isIOS ? 'Install on iOS' : 'Install PWA'}</span>
      </button>

      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-title"
        >
          <div className="liquid-glass-elevated w-full max-w-md rounded-3xl p-6 text-left">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="pwa-install-title" className="text-lg font-bold text-th-heading">
                  Install OfflineKit Standalone
                </h3>
                <p className="mt-1 text-xs text-th-secondary leading-relaxed">
                  Run OfflineKit in its own window with full offline asset caching and local IndexedDB persistence.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="p-2 min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-th-muted hover:text-th-heading transition-colors cursor-pointer"
                aria-label="Close install instructions"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-xs text-th-secondary">
              {isIOS ? (
                <div className="p-4 rounded-2xl bg-th-subtle border border-th-subtle space-y-2">
                  <div className="font-bold text-th-heading flex items-center gap-2">
                    <Share className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                    <span>Safari on iPhone or iPad</span>
                  </div>
                  <p>1. Tap the <strong className="text-th-heading">Share</strong> icon in the Safari toolbar.</p>
                  <p>2. Select <strong className="text-th-heading">Add to Home Screen</strong> to launch OfflineKit as a standalone app.</p>
                </div>
              ) : (
                <div className="p-4 rounded-2xl bg-th-subtle border border-th-subtle space-y-2">
                  <div className="font-bold text-th-heading">
                    Desktop or Mobile Browser Installation
                  </div>
                  <p>
                    1. Open this app in its own top-level browser tab (if currently previewing inside an embedded frame).
                  </p>
                  <p>
                    2. Click the <strong className="text-th-heading">Install OfflineKit</strong> icon in your browser&apos;s address bar or menu to pin it to your OS launcher.
                  </p>
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-4 py-2 min-h-[40px] rounded-xl text-xs font-bold bg-sky-500 text-slate-950 hover:bg-sky-400 transition-colors cursor-pointer"
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
