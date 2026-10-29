# Changelog

All notable changes to **OfflineKit** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-10-29

### Added
- **Local Database Explorer (`Dexie.js` / `IndexedDB`)**:
  - Create, inspect, edit metadata/version, and delete local databases and object stores (`tablesMeta`).
  - Typed schema field definitions (`string`, `number`, `boolean`, `object`, `array`) with optional **Strict Schema Validation** (`strictSchema`).
  - Dual-mode Record Editor: Structured Field Form Builder + Raw JSON Editor with live schema validation.
  - Full-text search, dynamic field/value filtering, multi-column sorting (`updatedAt`, `primaryKeyValue`, `revision`), pagination, and atomic bulk record deletion.
  - Native Browser Origin IndexedDB Scope inspector (`indexedDB.databases()`) with Same-Origin Policy disclosure.
- **Backup & Restore Engine**:
  - Portable JSON snapshot export (`offlinekit-backup-v1`, `schemaVersion: 1`) with canonical SHA-256 payload checksums.
  - Pre-import validator checking JSON syntax, `schemaVersion` compatibility, duplicate keys within backup files, and orphan tables/records.
  - Four conflict resolution strategies (`MERGE_SKIP_CONFLICTS`, `KEEP_NEWER_TIMESTAMP`, `UPSERT_OVERWRITE`, `CLEAN_REPLACE`) plus per-record **Keep Local** / **Use Backup** overrides.
  - Atomic Dexie read-write transaction rollback on mid-restore errors and automatic **Pre-Restore Safety Point** snapshots.
- **Offline Testing & Diagnostics Workbench**:
  - Live runtime probes for IndexedDB read latency, Service Worker registration lifecycle, `CacheStorage` precached asset inventory, and `StorageManager` quota estimates.
  - Explicit separation between real browser connectivity (`navigator.onLine`) and simulated Sync Lab modes (`[SIMULATION ONLY]`).
  - Page Refresh & Offline Reload Persistence Verification checkpoint tool.
  - Built-in 9-case E2E sandbox test runner (`OfflineKit_TestSandbox`) and Vitest + `fake-indexeddb` CLI test suite.
- **Overview Dashboard, Sync Playground & Developer Utilities**:
  - Interactive Recharts **Storage Usage Breakdown** donut chart and proportional database breakdown.
  - Sync Playground with outbox write queue and 4 conflict resolution strategies (`LWW`, `CLIENT_WINS`, `SERVER_WINS`, `MANUAL_MERGE`).
  - JSON Formatter & Validator, Schema Validator, UUID v4 & ULID Generator, Timestamp Converter, and Storage Inspector.
- **iOS 26 Liquid Glass Design System & Accessibility**:
  - WCAG AA+ verified **Midnight Liquid Glass (Dark)** and **Daylight Frosted Glass (Light)** themes with Tailwind CSS v4 `@custom-variant dark` class tokens.
  - Full `prefers-reduced-motion` support and keyboard navigation.
  - Settings → About section with developer attribution (`ArnobRazz`), GitHub profile link, and repository link.
