# Credential-free transfer + workspace redesign

Date: 2026-10-15 · Branch: `feat/sdk-transfer-redesign`

## Goal

Transfer content between XM Cloud environments by **picking** them, with no client ID, client secret or host to enter, and replace the single long dashboard page with a Sitecore-native workspace UI.

Success: a user inside XM Cloud opens the app, chooses Source and Target from dropdowns, ticks items in the source tree, and runs a transfer, export or import without entering credentials.

## Decisions

| Topic | Decision |
|---|---|
| Environment scope | Same Sitecore Cloud organization only. Environments come from `application.context.resourceAccess` (the environments the app installation was granted). No cross-org fallback. |
| Execution | Browser-side through the Marketplace SDK (`@sitecore-marketplace-sdk/xmc` `contentTransfer` + `authoring` modules). The host authenticates each call by `sitecoreContextId`. No server routes, no Auth0. |
| Features kept | Env → Env transfer, Export package (.zip), Import package (.zip / .raif), JSON queue import, Pages context panel pre-fill. |
| Features dropped | Credentials form, connection profiles, saved credentials (localStorage), Demo mode, custom dark-mode toggle, `ItemAndChildren` scope (not supported by the SDK API). |
| Design system | Sitecore Blok (shadcn + Tailwind), installed into `src/components/ui` via the shadcn CLI. Follows host light/dark theme. |
| Layout | Workspace: env bar on top, source tree left, selection queue right, run panel as a right-side sheet. |

## Architecture

### Deleted

- `src/app/api/migrate/**` (initiate, status, transfer-chunk, complete, consume, verify, children, download, upload) and `src/app/api/migrate/route.test.ts`
- `src/utils/auth.ts`, `src/utils/auth.test.ts` (also removes the global `NODE_TLS_REJECT_UNAUTHORIZED = '0'` and the silent mock-token fallback)
- `src/utils/migrationService.ts` + test, `src/components/MigrationDashboard.tsx` + test, `src/components/ContentTreeExplorer.tsx` + test
- `src/app/dashboard-widget-extension/`, `src/app/custom-field-extension/` (starter boilerplate)
- `extracted_dashboard.js` (committed build artifact)
- Custom theme variables in `src/app/globals.css` (replaced by Blok theme)

### New / changed

```
src/lib/transfer.ts               runTransfer, runExport, runImport + call() helper
src/lib/transfer.test.ts
src/utils/hooks/useMarketplaceClient.ts   (kept as is)
src/utils/hooks/useEnvironments.ts        reads resourceAccess → { id, name, contextId }[]
src/components/ui/*                       Blok components (shadcn CLI)
src/components/transfer/
  Workspace.tsx        state + layout; prop `compact` for the Pages context panel
  EnvironmentBar.tsx   Source / Target / Database selects + swap
  ContentTree.tsx      lazy tree over xmc.authoring.graphql
  SelectionQueue.tsx   queued paths, scope/merge selects, Add path, Import JSON, Clear all
  ImportPanel.tsx      drop zone + read-only package contents
  RunPanel.tsx         sheet with step list, progress, logs, cancel
  Workspace.test.tsx
src/app/fullscreen-extension/page.tsx        renders <Workspace />
src/app/standalone-extension/page.tsx        renders <Workspace />
src/app/pages-contextpanel-extension/page.tsx renders <Workspace compact initialItemPath=… />
```

`useEnvironments` maps each `resourceAccess` entry to `{ id: resourceId, name: tenantDisplayName ?? tenantName ?? resourceId, contextId }`. Which of `context.preview` / `context.live` is the right `contextId` is settled by the Phase 0 test run (expected: `preview`).

## Transfer engine (`src/lib/transfer.ts`)

### SDK call helper

SDK operations do not throw on HTTP errors: `client.mutate` resolves to the hey-api result `{ data, error, response }`, and `client.query` resolves to `{ data: <hey-api result>, error }`. `call(client, kind, key, params)` unwraps both shapes and returns `{ data, response }`, or throws an `Error` carrying the API's message and HTTP status. A 401/403 becomes: `The app can't access <env name>. Grant it in Cloud Portal → app → environment access.`

### Callbacks

Kept from the current service: `onLog(message, type)`, `onProgress(percent)`, `onStepChange(index, status)`. Each run also takes an `AbortSignal`; the engine checks it before every API call.

### runTransfer(client, { source, target, database, dataTrees }, callbacks, signal)

1. **Create job**: `xmc.contentTransfer.createContentTransfer` on source. Body `{ transferId, configuration: { dataTrees: [{ itemPath, scope, mergeStrategy }] } }`, `transferId = crypto.randomUUID()`.
2. **Wait for package**: poll `getContentTransferStatus` every 3 s, 10 min timeout. `Completed` → continue; `Failed` → error; HTTP 404 → treat as still processing (known Sitecore issue already handled today).
3. **Copy chunks**: for every entry in `ChunkSetsMetadata` (not just `[0]`), for each chunk index: `getChunk` (source) → read `isMedia` from `Content-Disposition` (`IsMedia=true|false`) → `saveChunk` (target, `query.isMedia`). Sequential: one chunk in memory at a time. Progress shows `Copying chunk n / total`.
4. **Assemble**: `completeChunkSetTransfer` on target per chunk set → `ContentTransferFileName`.
5. **Import**: `consumeFile` on target with `{ databaseName, fileName }`.
6. **Verify**: poll `getBlobState({ fileName })` every 3 s, 5 min timeout, until a success status; an error status fails the run.
7. **Clean up** (`finally`, best-effort): `deleteContentTransfer` on source and target. Failures are logged as warnings, never thrown.

### runExport(client, { source, dataTrees }, callbacks, signal)

Steps 1–2 on source, then download every chunk, resolve item IDs for the queued paths via `xmc.authoring.graphql`, and build a zip with JSZip:

- `package-metadata.json`: `[{ ItemPath, ItemId, Scope, MergeStrategy }]` (same shape as today)
- `package.raif`: chunks concatenated in order (same as today)

The browser then downloads `contentTransfer-<transferId>.zip`. Cleanup runs on source.

**Conditional on Phase 0:** if media chunks come back flagged `IsMedia=true`, concatenating them into one `.raif` loses that flag. In that case the export also writes `chunks/<chunkSetIndex>/<chunkIndex>.bin` plus an `isMedia` map in `package-metadata.json`, and import prefers per-chunk entries when present. Old zips (only `package.raif`) still import.

### runImport(client, { target, database, file }, callbacks, signal)

- `.zip`: read `package-metadata.json` (for the preview list) and `package.raif` (or per-chunk entries, see above).
- `.raif`: use as is; preview shows "no metadata in package".
- Upload in 1 MB slices with `saveChunk` (target, `transferId = chunksetId = randomUUID()`), then complete → consume → verify → cleanup on target.

The package contents list is **read-only**. Today's per-path checkboxes only logged selections and never filtered the import, so they are removed.

## UI

### Workspace

- **Header**: title + Blok Tabs `Transfer | Export | Import`.
  - Transfer: Source ▾ ⇄ Target ▾ · Database ▾ (master/web); tree + queue; primary button **Start transfer**.
  - Export: Source ▾; tree + queue; primary **Export package**.
  - Import: Target ▾ · Database ▾; ImportPanel; primary **Import package**.
- **Env pickers**: Blok Select listing env names. Default source = first env, target = second.
  - Same env on both sides → inline error, Start disabled.
  - Only one env → Alert "Grant this app access to another environment in Cloud Portal"; Transfer disabled, Export/Import usable.
  - No envs / context error → error Alert with Retry. Loading → Skeleton.
- **ContentTree**: root `/sitecore`, children loaded on expand via authoring GraphQL (same query as today's `children` route: `item(where:{path, database:"master"}) { children(first: 1000) { nodes { itemId name path children(first: 1) { nodes { itemId } } } } }`). Filter input matches loaded node names. Ticking a node adds it to the queue; checkbox state mirrors the queue. Skeleton rows while loading, inline error + Retry per node.
- **SelectionQueue**: one row per path with Scope select (`Single item` / `Item & descendants`), Merge select (4 strategies with a one-line description each), remove button. Header actions: **Add path** (text input), **Import JSON** (accepts the formats `handleJsonQueueUpload` accepts today: an array, `{ dataTrees }` or `{ items }`, with `path|ItemPath`, `scope|Scope`, `strategy|MergeStrategy`), **Clear all**. Defaults for new rows: `ItemAndDescendants`, `OverrideExistingTree`. Empty state text: "Pick items from the tree or paste a path."
- **Confirm dialog** before every run: e.g. "Copy 3 item trees from **Dev** → **QA** (master), merge: Override tree." If the target name contains `prod` (case-insensitive), a destructive-styled warning is added.
- **RunPanel** (Blok Sheet, right side): step list with pending/running/done/failed icons, progress bar, live chunk counter, collapsible log view (timestamps, **Copy logs**). Not dismissable while running; **Cancel** aborts via `AbortController`. On finish: summary + **Done** / **Run again**.
- **Compact mode** (Pages context panel): single column: current page card (name + path, pre-filled into the queue), Source ▾, Target ▾, Scope, Merge, **Send to <target>**; progress rendered inline instead of a sheet.
- **Accessibility**: labels on all controls, `aria-live="polite"` on run status, keyboard-operable tree (Radix checkbox + button rows).

## Testing

### Phase 0: test run in XM Cloud (throwaway)

A temporary `src/app/spike/page.tsx` with one button that logs:

1. `application.context.resourceAccess` and whether `preview` or `live` context IDs work for authoring and transfer calls.
2. Authoring GraphQL children of `/sitecore`.
3. A real single-item transfer (including one media item) between two envs: chunk `Blob` size before/after the bridge, presence of `Content-Disposition`, number of chunk sets, the `fileName` `consumeFile` accepts (`ContentTransferFileName` as returned vs. constructed), and the `getBlobState` status values.

The user runs it inside XM Cloud and shares the output. Findings update this spec (context ID, success/error status values, media handling), then the page is deleted.

### Automated (Vitest)

- `transfer.test.ts` with a fake client recording `query`/`mutate` calls:
  - transfer / export / import happy paths
  - multiple chunk sets
  - `Failed` transfer status
  - 401 → friendly access message
  - cleanup runs after failure and after cancel
  - legacy zip (`package.raif` only) import
- `Workspace.test.tsx` with mocked `application.context`: pickers populate; same env disables Start; single env shows the access Alert.

### Manual (in XM Cloud)

- Transfer a small tree containing a media item from Dev → QA.
- Export the same tree, import the zip into QA.
- Pages context panel: send the current page to another env.

## Plan-time amendments

Found while writing the implementation plan; these override the sections above.

- **Light theme only.** SDK 0.2 exposes no host theme query (`host.state`, `application.context` and the others carry no theme), so "follows host light/dark theme" is dropped. Add a `.dark` toggle when the SDK exposes the host theme.
- **Tailwind 3 → 4 and `@/*` → `./src/*`.** The Blok registry ships Tailwind 4 theme variables, and its components import `@/lib/utils`, `@/lib/icon` and `@/components/ui/*`.
- **Blok theme URL** is `https://blok.sitecore.com/r/theme.json` (`marketplace-sdk.sitecorecloud.io` did not resolve).
- **Shared helpers get their own files:** `src/lib/sdk.ts` (`call`, `toEnvs`, `fetchChildren`, `fetchItemId`), `src/lib/package.ts` (zip build/read) and `src/lib/queue.ts` (queue defaults, JSON parsing, dedupe). `transfer.ts` keeps only the pipelines.
- **Export media handling is unconditional:** every export also writes `package-chunks.json` (`[{ chunkSet, index, isMedia, offset, length }]`), an offset map into `package.raif`. Import re-slices the original chunks with their `isMedia` flags when the map is present and falls back to 1 MB slices otherwise. This replaces the Phase 0–conditional `chunks/*.bin` idea: there's no duplicated data, and old zips still import.
- **The user's uncommitted `MigrationDashboard.tsx` change is stashed** (`pre-redesign JSON button fix`) at the start of implementation rather than left in the working tree.

## Delivery

- Branch `feat/sdk-transfer-redesign`.
- The uncommitted JSON-import button fix in `MigrationDashboard.tsx` is left untouched; that file is replaced and the behavior lives in `SelectionQueue`.
- README rewritten: no credentials; setup step "grant the app access to every environment you want to transfer between".
