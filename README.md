# Sitecore Content Transfer Pro

A **Sitecore Marketplace Extension** that enables enterprise-grade content migration between XM Cloud environments directly from within the Sitecore UI. Built with Next.js 15 and the Sitecore Marketplace SDK.

---

## What It Does

Sitecore Content Transfer Pro provides three core workflows from a single fullscreen dashboard:

| Workflow | Description |
|---|---|
| **Env → Env Transfer** | Migrates content items directly from a Source XM Cloud environment to a Target via a 6-step proxied pipeline |
| **Export Package** | Exports selected content from Source into a downloadable `.zip` package |
| **Import Package** | Uploads and imports a pre-exported `.zip` or `.raif` package file into a Target environment |

---

## Features

- **6-Step Migration Pipeline** — Initiate, poll status, stream chunks, stitch, consume, and verify — with live progress tracking
- **Content Tree Explorer** — Browse the Source environment content tree and select items via checkboxes
- **Package Verification Modal** — Inspect and review all content items inside an uploaded package before importing
- **OAuth Client Credentials Auth** — Authenticates against Sitecore Cloud Auth (`auth.sitecorecloud.io`) server-side; credentials are never exposed to the browser
- **Demo Mode** — Run full end-to-end simulations with mocked API responses, no real credentials required
- **Dark / Light Theme** — Toggle between themes from the dashboard header
- **Real-time Execution Console** — Live log output with timestamped info, success, warning, and error messages
- **Configurable Merge Strategies** — Choose how conflicts are resolved when a content item already exists on the target:

  | Strategy | Behaviour |
  |---|---|
  | `OverrideExistingItem` | Replaces only the single target item with the source version, leaving its descendants untouched |
  | `KeepExistingItem` | Skips the item entirely if it already exists on the target — source version is ignored |
  | `LatestWin` | Compares last-modified timestamps and keeps whichever version (source or target) is newer |
  | `OverrideExistingTree` | Replaces the target item **and all its descendants** with the source versions |
- **Configurable Scopes** — `SingleItem` or `ItemAndDescendants` per path
- **Multiple Content Paths** — Queue multiple item paths in a single migration run

---

## Extension Points

This app integrates with three Sitecore Marketplace extension points:

### Fullscreen Extension
- **Location:** `src/app/fullscreen-extension/page.tsx`
- Renders the full `MigrationDashboard` UI inside XM Cloud as a fullscreen panel.

### Pages Context Panel Extension
- **Location:** `src/app/pages-contextpanel-extension/page.tsx`
- Pre-fills the migration source path from the currently selected page in the XM Cloud Pages editor. Subscribes to `pages.context` events via the Marketplace SDK.

### Standalone Extension
- **Location:** `src/app/standalone-extension/page.tsx`
- Runs the migration dashboard as a standalone app outside of other extension points.

---

## Architecture

```
src/
├── app/
│   ├── api/migrate/
│   │   ├── initiate/      — POST: Starts a transfer job on the Source environment
│   │   ├── status/        — POST: Polls the transfer job state and retrieves chunkset metadata
│   │   ├── transfer-chunk/ — POST: Downloads a chunk from Source and uploads it to Target
│   │   ├── complete/      — POST: Signals Target to stitch uploaded chunks into a .raif package
│   │   ├── consume/       — POST: Extracts the .raif package into the target database
│   │   ├── verify/        — POST: Polls the target blob state to confirm successful transfer
│   │   ├── download/      — POST: Stitches all chunks and returns a .zip for browser download
│   │   └── upload/        — POST: Accepts chunked binary uploads from the browser to Target storage
│   ├── fullscreen-extension/
│   ├── pages-contextpanel-extension/
│   └── standalone-extension/
├── components/
│   ├── MigrationDashboard.tsx   — Main dashboard UI component
│   └── ContentTreeExplorer.tsx  — Interactive source content tree browser
└── utils/
    ├── auth.ts               — OAuth Client Credentials token utility
    └── migrationService.ts   — Migration pipeline orchestration service (Live & Demo modes)
```

---

## Getting Started

> **Note:** Extension point routes (e.g. `/fullscreen-extension`) cannot be accessed directly in the browser. They must be invoked within the Sitecore XM Cloud environment through configured extension points. See the [Sitecore Marketplace documentation](https://doc.sitecore.com/mp/en/developers/marketplace/introduction-to-sitecore-marketplace.html).

### 1. Clone and install

```sh
git clone https://github.com/rvadherhztl03/sitecore-content-transfer.git
cd sitecore-content-transfer
npm install
```

### 2. Run the development server

```sh
npm run dev
```

### 3. Run tests

```sh
npm test
```

### 4. Configure in XM Cloud

Register the app in your Sitecore Marketplace account and map the extension point URLs to the appropriate routes.

---

## Environment Credentials

When running in **Live Mode**, you will need OAuth credentials for both environments:

| Field | Description |
|---|---|
| Host URL | The CM host of your XM Cloud environment (e.g. `https://your-cm.sitecorecloud.io`) |
| Client ID | OAuth Client ID from your Sitecore Cloud app registration |
| Client Secret | OAuth Client Secret |
| Authority | Auth endpoint — defaults to `https://auth.sitecorecloud.io` |
| Audience | API audience — defaults to `https://api.sitecorecloud.io` |

> Credentials are sent over HTTPS and processed entirely server-side. They are never stored, cached, or printed in console logs.

Use **Demo Mode** to test the full migration pipeline with simulated API responses and no real credentials.

---

## Tech Stack

| Technology | Version |
|---|---|
| Next.js | 15 |
| React | 19 |
| TypeScript | 5.9 |
| `@sitecore-marketplace-sdk/client` | ^0.2.0 |
| `@sitecore-marketplace-sdk/xmc` | ^0.2.0 |
| JSZip | ^3.10 |
| Vitest | ^4.1 |

---

## License

This project is licensed under the terms specified in the [LICENSE](LICENSE) file.

## Issues

If you encounter any issues or have suggestions for improvements, please open an issue on the [repository](https://github.com/rvadherhztl03/sitecore-content-transfer/issues).
