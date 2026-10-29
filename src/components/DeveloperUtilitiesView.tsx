import React, { useState, useEffect } from 'react';
import {
  Code2,
  ShieldCheck,
  Fingerprint,
  Clock,
  HardDrive,
  Copy,
  Check,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  Plus,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { UserDatabaseMeta, UserRecord, UserTableMeta } from '../db/offlineDb';

interface DeveloperUtilitiesViewProps {
  databases: UserDatabaseMeta[];
  tables: UserTableMeta[];
  records: UserRecord[];
}

type UtilitySubTab = 'json' | 'schema' | 'uuid' | 'timestamp' | 'storage';

function sortJsonKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(sortJsonKeys);
  }
  if (obj !== null && typeof obj === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
      sorted[key] = sortJsonKeys((obj as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return obj;
}

function generateSortableOfflineId(prefix = 'lok'): string {
  const ts = Date.now().toString(36).toUpperCase().padStart(9, '0');
  const rand = Array.from({ length: 8 }, () =>
    Math.floor(Math.random() * 36)
      .toString(36)
      .toUpperCase()
  ).join('');
  return `${prefix}_${ts}_${rand}`;
}

export const DeveloperUtilitiesView: React.FC<DeveloperUtilitiesViewProps> = ({
  databases,
  tables,
  records,
}) => {
  const [subTab, setSubTab] = useState<UtilitySubTab>('json');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyText = async (text: string, key: string) => {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    }
  };

  // 1. JSON Formatter & Validator State
  const [jsonInput, setJsonInput] = useState<string>(
    JSON.stringify(
      {
        deviceId: 'EDGE-NODE-09',
        offlineQueueDepth: 3,
        capabilities: ['indexeddb', 'service-worker', 'background-sync'],
        lastCheckpoint: { revision: 14, synced: true },
      },
      null,
      2
    )
  );
  const [jsonError, setJsonError] = useState<string | null>(null);

  const handleFormatJson = (indent: number, sortKeys = false) => {
    try {
      const parsed = JSON.parse(jsonInput);
      const target = sortKeys ? sortJsonKeys(parsed) : parsed;
      setJsonInput(JSON.stringify(target, null, indent));
      setJsonError(null);
    } catch (err) {
      setJsonError((err as Error).message);
    }
  };

  // 2. Schema Validator State
  const [schemaDefInput, setSchemaDefInput] = useState<string>(
    JSON.stringify(
      {
        required: ['inspectionId', 'sector', 'vibrationMmS', 'passedSafety'],
        properties: {
          inspectionId: 'string',
          sector: 'string',
          vibrationMmS: 'number',
          passedSafety: 'boolean',
          tags: 'array',
        },
      },
      null,
      2
    )
  );
  const [schemaTargetInput, setSchemaTargetInput] = useState<string>(
    JSON.stringify(
      {
        inspectionId: 'INSP-9041',
        sector: 'North Sea Array B4',
        vibrationMmS: 1.84,
        passedSafety: true,
        tags: ['offshore', 'calibrated'],
      },
      null,
      2
    )
  );

  const schemaValidationResult = React.useMemo(() => {
    const issues: string[] = [];
    let schemaObj: {
      required?: string[];
      properties?: Record<string, string>;
    };
    let docObj: Record<string, unknown>;

    try {
      schemaObj = JSON.parse(schemaDefInput);
    } catch (e) {
      return { valid: false, issues: [`Schema syntax error: ${(e as Error).message}`] };
    }

    try {
      const parsedDoc = JSON.parse(schemaTargetInput);
      if (typeof parsedDoc !== 'object' || parsedDoc === null || Array.isArray(parsedDoc)) {
        return { valid: false, issues: ['Target payload must be a JSON object.'] };
      }
      docObj = parsedDoc as Record<string, unknown>;
    } catch (e) {
      return { valid: false, issues: [`Document syntax error: ${(e as Error).message}`] };
    }

    if (Array.isArray(schemaObj.required)) {
      for (const reqField of schemaObj.required) {
        if (!(reqField in docObj) || docObj[reqField] === undefined) {
          issues.push(`Missing required property "${reqField}".`);
        }
      }
    }

    if (schemaObj.properties && typeof schemaObj.properties === 'object') {
      for (const [prop, expectedType] of Object.entries(schemaObj.properties)) {
        if (prop in docObj && docObj[prop] !== undefined) {
          const val = docObj[prop];
          const actualType = Array.isArray(val)
            ? 'array'
            : val === null
            ? 'null'
            : typeof val;
          if (actualType !== expectedType) {
            issues.push(
              `Property "${prop}" expected type "${expectedType}", but received "${actualType}".`
            );
          }
        }
      }
    }

    return { valid: issues.length === 0, issues };
  }, [schemaDefInput, schemaTargetInput]);

  // 3. UUID & Key Generator State
  const [uuidCount, setUuidCount] = useState<number>(6);
  const [keyFormat, setKeyFormat] = useState<'uuid-v4' | 'sortable-lok'>('uuid-v4');
  const [generatedKeys, setGeneratedKeys] = useState<string[]>([]);

  const regenerateKeys = () => {
    const count = Math.min(25, Math.max(1, uuidCount));
    const list: string[] = [];
    for (let i = 0; i < count; i++) {
      if (keyFormat === 'uuid-v4') {
        list.push(
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
                const r = (Math.random() * 16) | 0;
                const v = c === 'x' ? r : (r & 0x3) | 0x8;
                return v.toString(16);
              })
        );
      } else {
        list.push(generateSortableOfflineId('rec'));
      }
    }
    setGeneratedKeys(list);
  };

  useEffect(() => {
    regenerateKeys();
  }, [uuidCount, keyFormat]);

  // 4. Timestamp Converter State
  const [epochMsInput, setEpochMsInput] = useState<string>(() => String(Date.now()));
  const [isoInput, setIsoInput] = useState<string>(() => new Date().toISOString());

  const handleEpochChange = (val: string) => {
    setEpochMsInput(val);
    const num = Number(val);
    if (!Number.isNaN(num) && num > 0) {
      const ms = val.trim().length <= 10 ? num * 1000 : num;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) {
        setIsoInput(d.toISOString());
      }
    }
  };

  const handleIsoChange = (val: string) => {
    setIsoInput(val);
    const d = new Date(val);
    if (!Number.isNaN(d.getTime())) {
      setEpochMsInput(String(d.getTime()));
    }
  };

  const parsedDate = new Date(
    Number(epochMsInput.trim().length <= 10 ? Number(epochMsInput) * 1000 : Number(epochMsInput))
  );
  const isDateValid = !Number.isNaN(parsedDate.getTime());

  // 5. Storage Inspector State
  const [localEntries, setLocalEntries] = useState<{ key: string; value: string; bytes: number }[]>([]);
  const [newStorageKey, setNewStorageKey] = useState('');
  const [newStorageVal, setNewStorageVal] = useState('');

  const refreshLocalStorageEntries = () => {
    if (typeof localStorage === 'undefined') return;
    const list: { key: string; value: string; bytes: number }[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) {
        const v = localStorage.getItem(k) ?? '';
        list.push({ key: k, value: v, bytes: (k.length + v.length) * 2 });
      }
    }
    setLocalEntries(list);
  };

  useEffect(() => {
    if (subTab === 'storage') {
      refreshLocalStorageEntries();
    }
  }, [subTab]);

  const handleAddLocalStorageKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStorageKey.trim()) return;
    localStorage.setItem(newStorageKey.trim(), newStorageVal);
    setNewStorageKey('');
    setNewStorageVal('');
    refreshLocalStorageEntries();
  };

  const handleRemoveLocalStorageKey = (key: string) => {
    localStorage.removeItem(key);
    refreshLocalStorageEntries();
  };

  return (
    <div className="space-y-6">
      {/* Header & Tool Switcher */}
      <div className="liquid-glass rounded-3xl p-5 sm:p-6 space-y-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-th-heading">
            Developer Utilities
          </h1>
          <p className="text-xs sm:text-sm text-th-secondary mt-0.5">
            Offline-ready JSON formatter, structural schema validator, UUID/ULID generator, epoch timestamp converter, and browser storage inspector.
          </p>
        </div>

        {/* Sub-navigation tabs with shared layoutId spring indicator */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {(
            [
              { id: 'json', label: 'JSON Formatter', icon: Code2 },
              { id: 'schema', label: 'Schema Validator', icon: ShieldCheck },
              { id: 'uuid', label: 'UUID Generator', icon: Fingerprint },
              { id: 'timestamp', label: 'Timestamp Converter', icon: Clock },
              { id: 'storage', label: 'Storage Inspector', icon: HardDrive },
            ] as const
          ).map(({ id, label, icon: Icon }) => {
            const isActive = subTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setSubTab(id)}
                className={`relative inline-flex items-center gap-2 px-4 py-2 min-h-[40px] rounded-xl text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                  isActive
                    ? 'text-slate-950'
                    : 'liquid-glass-interactive text-th-primary'
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="utility-subtab-pill"
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                    className="absolute inset-0 rounded-xl bg-sky-400 shadow-sm"
                  />
                )}
                <Icon className="relative z-10 w-3.5 h-3.5" />
                <span className="relative z-10">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={subTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Tool 1: JSON Formatter & Validator */}
          {subTab === 'json' && (
            <div className="liquid-glass rounded-3xl p-5 sm:p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-bold text-th-heading">
                  JSON Formatter, Minifier &amp; Syntax Validator
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleFormatJson(2, false)}
                    className="px-3.5 py-2 min-h-[38px] rounded-xl text-xs font-bold bg-sky-500 text-slate-950 hover:bg-sky-400 cursor-pointer shadow-sm"
                  >
                    Prettify (2 sp)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFormatJson(2, true)}
                    className="px-3.5 py-2 min-h-[38px] rounded-xl text-xs font-semibold liquid-glass-interactive cursor-pointer"
                  >
                    Sort Keys
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFormatJson(0, false)}
                    className="px-3.5 py-2 min-h-[38px] rounded-xl text-xs font-semibold liquid-glass-interactive cursor-pointer"
                  >
                    Minify
                  </button>
                  <button
                    type="button"
                    onClick={() => copyText(jsonInput, 'json-copy')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[38px] rounded-xl text-xs font-semibold liquid-glass-interactive cursor-pointer"
                  >
                    {copiedKey === 'json-copy' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <textarea
                rows={12}
                value={jsonInput}
                onChange={(e) => {
                  setJsonInput(e.target.value);
                  try {
                    JSON.parse(e.target.value);
                    setJsonError(null);
                  } catch (err) {
                    setJsonError((err as Error).message);
                  }
                }}
                aria-label="JSON Formatter Input"
                className="w-full p-4 rounded-2xl bg-th-code border border-th-strong font-mono text-xs text-th-primary focus:outline-none focus:border-sky-500"
              />

              {jsonError ? (
                <div className="p-3.5 rounded-2xl bg-rose-500/15 border border-rose-500/35 flex items-center gap-2 text-xs font-semibold text-rose-700 dark:text-rose-300 font-mono">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Syntax Error: {jsonError}</span>
                </div>
              ) : (
                <div className="p-3.5 rounded-2xl bg-emerald-500/12 border border-emerald-500/35 flex items-center justify-between text-xs font-bold text-emerald-800 dark:text-emerald-300 font-mono">
                  <span className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Valid RFC 8259 JSON Payload</span>
                  </span>
                  <span>{jsonInput.length} bytes</span>
                </div>
              )}
            </div>
          )}

          {/* Tool 2: Schema Validator */}
          {subTab === 'schema' && (
            <div className="liquid-glass rounded-3xl p-5 sm:p-6 space-y-5">
              <div>
                <h2 className="text-base font-bold text-th-heading">
                  Structural JSON Schema Validator
                </h2>
                <p className="text-xs text-th-secondary mt-0.5">
                  Define required keys and property types (`string`, `number`, `boolean`, `array`, `object`) to validate candidate records before IndexedDB insertion.
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-th-secondary mb-1.5">
                    Schema Definition (`required` &amp; `properties`)
                  </label>
                  <textarea
                    rows={10}
                    value={schemaDefInput}
                    onChange={(e) => setSchemaDefInput(e.target.value)}
                    className="w-full p-3.5 rounded-2xl bg-th-code border border-th-strong font-mono text-xs text-th-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-th-secondary mb-1.5">
                    Candidate JSON Document
                  </label>
                  <textarea
                    rows={10}
                    value={schemaTargetInput}
                    onChange={(e) => setSchemaTargetInput(e.target.value)}
                    className="w-full p-3.5 rounded-2xl bg-th-code border border-th-strong font-mono text-xs text-th-primary"
                  />
                </div>
              </div>

              {schemaValidationResult.valid ? (
                <div className="p-4 rounded-2xl bg-emerald-500/12 border border-emerald-500/35 flex items-center gap-2.5 text-xs font-bold text-emerald-800 dark:text-emerald-300">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>Document satisfies all required fields and structural property types.</span>
                </div>
              ) : (
                <div className="p-4 rounded-2xl bg-rose-500/12 border border-rose-500/35 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-rose-700 dark:text-rose-400">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{schemaValidationResult.issues.length} Schema Violation(s) Found</span>
                  </div>
                  <ul className="list-disc list-inside text-xs font-mono text-rose-700 dark:text-rose-300 space-y-1">
                    {schemaValidationResult.issues.map((issue, idx) => (
                      <li key={idx}>{issue}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Tool 3: UUID & Key Generator */}
          {subTab === 'uuid' && (
            <div className="liquid-glass rounded-3xl p-5 sm:p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-bold text-th-heading">
                    Offline Primary Key &amp; UUID v4 Generator
                  </h2>
                  <p className="text-xs text-th-secondary mt-0.5">
                    Generate collision-resistant cryptographic UUIDs or lexicographically time-sortable offline keys.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <select
                    value={keyFormat}
                    onChange={(e) => setKeyFormat(e.target.value as 'uuid-v4' | 'sortable-lok')}
                    aria-label="Key format"
                    className="px-3 py-2 min-h-[40px] rounded-xl text-xs bg-th-input border border-th-strong font-mono text-th-primary"
                  >
                    <option value="uuid-v4">RFC 4122 UUID v4</option>
                    <option value="sortable-lok">Time-Sortable Offline Key (rec_...)</option>
                  </select>

                  <input
                    type="number"
                    min={1}
                    max={25}
                    value={uuidCount}
                    onChange={(e) => setUuidCount(Number(e.target.value) || 1)}
                    aria-label="Number of keys to generate"
                    className="w-20 px-3 py-2 min-h-[40px] rounded-xl text-xs bg-th-input border border-th-strong font-mono text-th-primary tabular-nums"
                  />

                  <button
                    type="button"
                    onClick={regenerateKeys}
                    className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[40px] rounded-xl text-xs font-bold bg-sky-500 text-slate-950 hover:bg-sky-400 cursor-pointer shadow-sm"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Regenerate</span>
                  </button>
                </div>
              </div>

              <div className="divide-y divide-slate-200 dark:divide-white/10">
                {generatedKeys.map((k, idx) => (
                  <div
                    key={`${k}-${idx}`}
                    className="py-2.5 flex items-center justify-between gap-3 font-mono text-xs"
                  >
                    <span className="text-th-heading font-semibold select-all">{k}</span>
                    <button
                      type="button"
                      onClick={() => copyText(k, k)}
                      className="px-3 py-1.5 min-h-[34px] rounded-xl text-xs font-sans font-semibold liquid-glass-interactive inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      {copiedKey === k ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tool 4: Timestamp Converter */}
          {subTab === 'timestamp' && (
            <div className="liquid-glass rounded-3xl p-5 sm:p-6 space-y-5">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <h2 className="text-base font-bold text-th-heading">
                    Bidirectional Epoch &amp; ISO-8601 Timestamp Converter
                  </h2>
                  <p className="text-xs text-th-secondary mt-0.5">
                    Inspect and convert LWW conflict timestamps across Unix milliseconds, seconds, UTC, and local time.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleEpochChange(String(Date.now()))}
                  className="px-3.5 py-2 min-h-[38px] rounded-xl text-xs font-bold bg-sky-500 text-slate-950 hover:bg-sky-400 cursor-pointer shadow-sm"
                >
                  Set to Current Time (Now)
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block font-bold text-th-secondary mb-1">
                    Unix Epoch (Milliseconds or Seconds)
                  </label>
                  <input
                    type="text"
                    value={epochMsInput}
                    onChange={(e) => handleEpochChange(e.target.value)}
                    className="w-full px-3.5 py-2.5 min-h-[42px] rounded-xl bg-th-input border border-th-strong font-mono text-th-primary tabular-nums"
                  />
                </div>

                <div>
                  <label className="block font-bold text-th-secondary mb-1">
                    ISO-8601 String (UTC)
                  </label>
                  <input
                    type="text"
                    value={isoInput}
                    onChange={(e) => handleIsoChange(e.target.value)}
                    className="w-full px-3.5 py-2.5 min-h-[42px] rounded-xl bg-th-input border border-th-strong font-mono text-th-primary"
                  />
                </div>
              </div>

              {isDateValid && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono">
                  <div className="p-4 rounded-2xl bg-th-subtle border border-th-subtle space-y-1">
                    <div className="text-th-secondary font-sans font-semibold">Unix Seconds</div>
                    <div className="text-sm font-bold text-th-heading tabular-nums">
                      {Math.floor(parsedDate.getTime() / 1000)}
                    </div>
                  </div>
                  <div className="p-4 rounded-2xl bg-th-subtle border border-th-subtle space-y-1">
                    <div className="text-th-secondary font-sans font-semibold">UTC String</div>
                    <div className="text-sm font-bold text-th-heading">
                      {parsedDate.toUTCString()}
                    </div>
                  </div>
                  <div className="p-4 rounded-2xl bg-th-subtle border border-th-subtle space-y-1">
                    <div className="text-th-secondary font-sans font-semibold">Local Timezone</div>
                    <div className="text-sm font-bold text-th-heading">
                      {parsedDate.toLocaleString()}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tool 5: Storage Inspector */}
          {subTab === 'storage' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-6 liquid-glass rounded-3xl p-5 sm:p-6 space-y-4">
                <h2 className="text-base font-bold text-th-heading">
                  IndexedDB Object Store Breakdown
                </h2>
                <div className="divide-y divide-slate-200 dark:divide-white/10 text-xs">
                  {databases.map((d) => {
                    const dbTables = tables.filter((t) => t.databaseId === d.id);
                    const dbRecs = records.filter((r) => r.databaseId === d.id);
                    const bytes = dbRecs.reduce((s, r) => s + JSON.stringify(r.data).length, 0);
                    return (
                      <div key={d.id} className="py-3 flex items-center justify-between">
                        <div>
                          <div className="font-mono font-bold text-th-heading">
                            {d.name} (v{d.version})
                          </div>
                          <div className="text-th-muted mt-0.5 font-mono">
                            {dbTables.length} tables · {dbRecs.length} records
                          </div>
                        </div>
                        <span className="font-mono font-bold text-sky-700 dark:text-sky-400 tabular-nums">
                          {bytes} B
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="lg:col-span-6 liquid-glass rounded-3xl p-5 sm:p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-th-heading">
                    Browser `localStorage` Inspector ({localEntries.length} keys)
                  </h2>
                  <button
                    type="button"
                    onClick={refreshLocalStorageEntries}
                    className="p-2 rounded-xl liquid-glass-interactive text-xs cursor-pointer"
                    title="Refresh localStorage"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>

                <form onSubmit={handleAddLocalStorageKey} className="flex gap-2 text-xs">
                  <input
                    type="text"
                    value={newStorageKey}
                    onChange={(e) => setNewStorageKey(e.target.value)}
                    placeholder="Key"
                    className="w-1/3 px-3 py-2 min-h-[38px] rounded-xl bg-th-input border border-th-strong font-mono text-th-primary"
                  />
                  <input
                    type="text"
                    value={newStorageVal}
                    onChange={(e) => setNewStorageVal(e.target.value)}
                    placeholder="Value"
                    className="flex-1 px-3 py-2 min-h-[38px] rounded-xl bg-th-input border border-th-strong font-mono text-th-primary"
                  />
                  <button
                    type="submit"
                    className="px-3 py-2 min-h-[38px] rounded-xl bg-sky-500 text-slate-950 font-bold cursor-pointer inline-flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Set</span>
                  </button>
                </form>

                <div className="divide-y divide-slate-200 dark:divide-white/10 max-h-64 overflow-y-auto text-xs font-mono">
                  {localEntries.map((entry) => (
                    <div key={entry.key} className="py-2.5 flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-th-heading truncate">
                          {entry.key}
                        </div>
                        <div className="text-th-secondary truncate">{entry.value}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] text-th-muted tabular-nums">{entry.bytes} B</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveLocalStorageKey(entry.key)}
                          className="p-1.5 rounded-lg text-th-muted hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer"
                          title={`Delete key ${entry.key}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
