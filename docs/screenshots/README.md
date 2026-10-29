# Application Screenshots Guide (`docs/screenshots/`)

To keep repository integrity verifiable and avoid fabricated or synthetic illustrations masquerading as screenshots, **OfflineKit** only includes genuine browser captures from the running application.

> **Environment Note**: In headless container build environments without a GUI display server or Chromium binary, automated screenshot capture is unavailable during CLI builds. Follow the steps below to capture and commit genuine screenshots from your local browser.

## Recommended Screenshot Set

Save high-DPI PNG screenshots in this directory (`docs/screenshots/`) using the exact filenames below:

1. `dashboard-dark.png` — **Overview Dashboard (Midnight Liquid Glass Dark Mode)** showing the hero status card, 4 KPI metric cards, and the Recharts *Storage Usage Breakdown* donut chart (`1440×900`).
2. `dashboard-light.png` — **Overview Dashboard (Daylight Frosted Glass Light Mode)** verifying high-contrast dark slate typography on frosted alabaster glass (`1440×900`).
3. `database-explorer.png` — **Local Database Explorer** showing `FieldOps_EdgeDB`, table schema definitions, field filter controls, and record JSON inspection (`1440×900`).
4. `backup-restore.png` — **Backup & Restore Engine Modal** on the *Import, Validate & Restore* tab displaying primary-key conflict detection and the 4 resolution modes (`1440×900`).
5. `sync-playground.png` — **Sync Playground** displaying the outbox write queue, simulated network mode pills (`[SIMULATION ONLY]`), and side-by-side HTTP 409 conflict diff resolution (`1440×900`).
6. `developer-utilities.png` — **Developer Utilities** showing the JSON Formatter & Validator or Storage Inspector (`1440×900`).
7. `mobile-responsive.png` — **Mobile Viewport (`390×844` iPhone 16 Pro viewport)** showing the floating bottom Liquid Glass navigation bar and responsive cards.

## How to Capture Locally

```bash
# 1. Start the application locally
npm run dev

# 2. Open http://localhost:3000 in Chrome, Edge, or Safari
# 3. Use Browser DevTools (Cmd+Shift+P / Ctrl+Shift+P -> "Capture full size screenshot")
# 4. Save the PNG files into docs/screenshots/
```
