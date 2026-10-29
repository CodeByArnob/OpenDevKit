# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

## Security & Privacy Architecture of OfflineKit

**OfflineKit** is a 100% client-side, local-first web application:

1. **Zero Backend Storage**: All databases, schemas, records, sync queues, and snapshots are stored exclusively inside the user's browser `IndexedDB` (`OfflineKitCoreDB`) and `localStorage`.
2. **Same-Origin Isolation**: Browser security policies enforce strict Same-Origin isolation on `IndexedDB`, `CacheStorage`, and `ServiceWorker` scopes.
3. **Plaintext JSON Backups**: Exported `.json` snapshot files (`offlinekit-backup-v1`) are human-readable, unencrypted JSON files with a SHA-256 payload checksum for accidental corruption detection. Users should never export or share snapshots containing production secrets, credentials, or regulated PII over untrusted channels.
4. **No Telemetry or Secret Collection**: OfflineKit does not collect analytics, user telemetry, or API keys in the client UI.

## Reporting a Vulnerability

If you discover a security vulnerability (such as DOM-based XSS in JSON/schema rendering, prototype pollution during backup import validation, or unsafe external link handling):

1. **Do not** open a public GitHub issue with exploit details.
2. Report the vulnerability via GitHub Security Advisories on [https://github.com/arnob123/OpenDevKit/security](https://github.com/arnob123/OpenDevKit/security) or contact the maintainer [@arnob123](https://github.com/arnob123/).
3. Include steps to reproduce, affected component/file path, and potential impact.
