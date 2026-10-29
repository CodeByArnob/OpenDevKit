# Contributing to OfflineKit

Thank you for your interest in contributing to **OfflineKit** ([https://github.com/arnob123/OpenDevKit](https://github.com/arnob123/OpenDevKit))! Our mission is to provide developers with a trustworthy, zero-dependency, offline-first workbench for building resilient web applications.

## Guiding Principles

1. **Local-First Integrity**: Every core feature must function offline in the browser without requiring an account, API key, or external backend.
2. **Honest Capabilities**: Never add mock UI controls or fabricated telemetry that masquerades as real system metrics. When a feature is a simulation (such as the Sync Playground's simulated remote server or simulated network drop), label it clearly as `[SIMULATION ONLY]`.
3. **Accessibility & Contrast Discipline**: Maintain WCAG AA contrast (at least 4.5:1 for normal text and 3:1 for large text/boundaries) across both **Midnight Liquid Glass (Dark)** and **Daylight Frosted Glass (Light)** themes. Respect `prefers-reduced-motion` and maintain keyboard focus rings (`focus-visible`).
4. **Tested Storage & Backup Operations**: Any change to `src/db/offlineDb.ts`, `src/utils/backupEngine.ts`, or `src/utils/themeManager.ts` must include automated unit/integration tests in `src/tests/storage.test.ts`.

## Local Development Workflow

```bash
# 1. Fork and clone the repository
git clone https://github.com/arnob123/OpenDevKit.git
cd OpenDevKit

# 2. Install dependencies
npm install

# 3. Start the Vite development server on port 3000
npm run dev

# 4. Run TypeScript type checks
npm run lint

# 5. Run Vitest unit & integration tests
npm test

# 6. Build the production PWA bundle
npm run build
```

## Pull Request Checklist

- [ ] `npm run lint` passes with zero TypeScript errors.
- [ ] `npm test` passes all IndexedDB CRUD, schema validation, backup conflict, rollback, and theme unit tests.
- [ ] `npm run build` succeeds and generates the Workbox service worker (`dist/sw.js`) and manifest (`dist/manifest.webmanifest`).
- [ ] Both Dark and Light themes are verified on mobile (375px) and desktop (1440px) viewports with readable text contrast.
- [ ] No secrets, `.env` files, or build artifacts (`dist/`, `dev-dist/`) are included in the commit.
