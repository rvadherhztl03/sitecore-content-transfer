# Credential-free transfer + workspace redesign: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the credential-based server proxies with Marketplace SDK calls chosen by environment, and replace the 1,813-line dashboard with a Blok workspace UI.

**Architecture:** Browser-only. `src/lib/sdk.ts` wraps `client.query/mutate` and adds each environment's `sitecoreContextId`. `src/lib/transfer.ts` runs the transfer, export and import pipelines with callbacks and an `AbortSignal`. `src/lib/package.ts` builds and reads package zips. React components in `src/components/transfer/` compose Blok components from `src/components/ui/`.

**Tech Stack:** Next.js 15, React 19, TypeScript 5.9, `@sitecore-marketplace-sdk/client` + `/xmc` 0.2, JSZip 3, Tailwind CSS 4, Sitecore Blok (shadcn registry), Vitest 4 + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-15-sdk-transfer-redesign-design.md` (read its "Plan-time amendments" section)

## Global Constraints

- No client IDs, secrets, hosts, tokens or credential storage anywhere. Every Sitecore call goes through `call()` (Task 2) with an `Env`.
- No `src/app/api/**` routes after Task 9.
- Scope values: `SingleItem | ItemAndDescendants`. Merge values: `OverrideExistingItem | KeepExistingItem | LatestWin | OverrideExistingTree`.
- New queue rows default to `ItemAndDescendants` + `OverrideExistingTree`.
- Database options `master`, `web`; default `master`.
- Polling interval 3 s; transfer-status timeout 10 min; blob-state timeout 5 min (all via `TIMING`, Task 3).
- Import slice size for packages without a chunk map: 1 MB (`1024 * 1024`).
- Exact copy:
  - 401/403: `The app can't access <env name>. Grant it in Cloud Portal → app → environment access.`
  - One environment: `Grant this app access to another environment in Cloud Portal to transfer between environments.`
  - Empty queue: `Pick items from the tree or paste a path.`
  - Prod warning (target name matches `/prod/i`): `<target name> looks like a production environment. Double-check before continuing.`
- UI comes only from `@/components/ui/*` (Blok). Icons: `Icon` from `@/lib/icon` with `@mdi/js` paths. No `lucide-react` after Task 9.
- Import alias `@/*` → `./src/*` (from Task 1 on).
- Library tests (`src/lib/*.test.ts`) start with `// @vitest-environment node`.
- Light theme only.

## Review Focus

1. Paths with spaces (`/sitecore/media library/Images/Hero Banner`) must reach GraphQL variables and the transfer body unchanged. Tests: Task 2 `fetchChildren passes the path verbatim`; Task 3 `runs the full pipeline against the right environments` (uses a spaced path).
2. A path that doesn't exist on the source: status `Completed` with empty `ChunkSetsMetadata` must fail with `Source returned no content for the selected paths. Check that they exist.` Test: Task 3 `fails when the source has no content`.
3. A large bare `.raif` import must be sliced with `Blob.slice`, never read into memory whole. Test: Task 4 `readPackage slices a .raif without reading it`.
4. The same path added twice (tree tick, Add path, JSON import) must keep one row. Test: Task 5 `mergeTrees dedupes by path`.
5. `resourceAccess` entries missing the chosen context ID must be skipped, not shown as a broken option. Test: Task 2 `toEnvs skips entries without a context id`.

---

### Task 0: Phase 0 test run in XM Cloud (throwaway)

**Files:**
- Create: `src/app/fullscreen-extension/Spike.tsx`
- Modify: `src/app/fullscreen-extension/page.tsx`: when `process.env.NEXT_PUBLIC_SPIKE === '1'`, return `<Spike client={client} />` instead of the dashboard

**Interfaces:**
- Consumes: `useMarketplaceClient()` (existing), `ClientSDK` from `@sitecore-marketplace-sdk/client`
- Produces: findings recorded in the spec; nothing in code

- [ ] **Step 1: Write `Spike({ client }: { client: ClientSDK | null })`.** Plain HTML with inline styles, no new deps. `log(label, value)` appends pretty JSON to a `<pre>`: a `Blob` becomes `{ blobSize }`, a `Response` becomes `{ status, headers: Object.fromEntries(headers) }`. Add a **Copy output** button. Controls:
  1. **Context**: `client.query('application.context')`; log `resourceAccess`.
  2. **Tree (preview)** and **Tree (live)**: `client.mutate('xmc.authoring.graphql', { params: { query: { sitecoreContextId }, body: { query, variables: { path: '/sitecore' } } } })`, using the source env's `context.preview` / `context.live`. Use the children query from the spec. Log the whole result.
  3. **Run test transfer**: inputs for source index, target index, context kind (`preview` | `live`), item path and an optional media item path. Ask `window.confirm('This writes <paths> into <target name>. Continue?')`, then run the following, logging each raw `{ data, error, response }`:
     - `createContentTransfer` (scope `SingleItem`, merge `OverrideExistingItem`, one data tree per path)
     - `getContentTransferStatus` every 3 s, up to 40 times
     - for every chunk set and chunk: `getChunk`, logging blob size and the `content-disposition`, `content-type` and `content-length` headers, then `saveChunk` on the target with `isMedia` parsed from `IsMedia=`
     - `completeChunkSetTransfer`
     - `consumeFile` with `fileName = ContentTransferFileName`; if that errors, retry with `contentTransfer-<transferId>-<chunksetId>.raif` and log both
     - `getBlobState` every 3 s, up to 40 times, logging every status
     - `deleteContentTransfer` on source and target
- [ ] **Step 2: Type-check.** Run `npx tsc --noEmit`. Expected: no errors.
- [ ] **Step 3: Commit.**
```bash
git add src/app/fullscreen-extension
git commit -m "chore: add throwaway SDK spike page"
```
- [ ] **Step 4: STOP and hand off to the user.** Ask them to run `NEXT_PUBLIC_SPIKE=1 npm run dev`, open the app's fullscreen extension in XM Cloud, click **Context**, both **Tree** buttons, then **Run test transfer** with a throwaway content item and a throwaway media item, and paste the **Copy output** text.
- [ ] **Step 5: Record the findings.** Add a "Phase 0 findings" section to the spec covering:
  - which context kind works
  - which `fileName` form `consumeFile` accepts
  - every `getBlobState` status seen, and which ones are final
  - whether `content-disposition` arrives
  - how many chunk sets came back
  - whether blob sizes survived the bridge

  If chunks don't survive the bridge, or no context kind works for transfer calls, **stop and return to brainstorming**. Otherwise, wherever the findings differ, update the defaults in Tasks 2–3 (`CONTEXT_KIND`, `BLOB_SUCCESS`, `BLOB_FAILURE`, consume `fileName`).
```bash
git add docs/superpowers/specs
git commit -m "docs: record Phase 0 findings"
```

Tasks 1–2 don't depend on the findings and may run while waiting.

---

### Task 1: Tailwind 4, `@/` alias, Blok components

**Files:**
- Delete: `src/app/dashboard-widget-extension/`, `src/app/custom-field-extension/`, `extracted_dashboard.js`, `tailwind.config.js`, `postcss.config.js`
- Create: `postcss.config.mjs`, `components.json`, `src/lib/utils.ts`, `src/lib/icon.tsx`, `src/components/ui/*` (generated)
- Modify: `package.json`, `tsconfig.json` (`paths`), `vitest.config.ts` (alias), `vitest.setup.ts`, `src/app/globals.css`, every file importing `@/src/`

**Interfaces:**
- Produces: alias `@/*` → `src/*`; Blok components `button, select, tabs, sheet, checkbox, input, label, badge, alert, alert-dialog, skeleton, progress, scroll-area, collapsible, card, tooltip, spinner, empty-states, error-states`; `cn` from `@/lib/utils`; `Icon` from `@/lib/icon`

- [ ] **Step 1: Stash the user's uncommitted change, then delete boilerplate and the build artifact.** The stash keeps the JSON-button fix in `MigrationDashboard.tsx` out of the alias rewrite and out of every commit; its behavior is rebuilt in `SelectionQueue` (Task 5). Tell the user the stash name.
```bash
git stash push src/components/MigrationDashboard.tsx -m "pre-redesign JSON button fix"
git rm -r src/app/dashboard-widget-extension src/app/custom-field-extension extracted_dashboard.js
```
- [ ] **Step 2: Switch the alias.** Set tsconfig `"@/*": ["./src/*"]` and the vitest alias `'@': path.resolve(__dirname, './src')`, then rewrite the imports:
```bash
grep -rl "@/src/" src | xargs sed -i '' 's#@/src/#@/#g'
```
Run `npx tsc --noEmit && npm test`. Expected: no type errors; 33 tests pass.
- [ ] **Step 3: Upgrade to Tailwind 4.**
  - Run `npm uninstall autoprefixer && npm install -D tailwindcss@^4 @tailwindcss/postcss`.
  - Delete `tailwind.config.js` and `postcss.config.js`.
  - Create `postcss.config.mjs` with `export default { plugins: { "@tailwindcss/postcss": {} } };`.
  - In `globals.css`, replace the three `@tailwind` lines with `@import "tailwindcss";`. Leave the rest of the file until Task 9.
- [ ] **Step 4: Install Blok.**
```bash
npx shadcn@latest init -d
npx shadcn@latest add -y -o https://blok.sitecore.com/r/theme.json
npx shadcn@latest add -y -o https://blok.sitecore.com/r/{button,select,tabs,sheet,checkbox,input,label,badge,alert,alert-dialog,skeleton,progress,scroll-area,collapsible,card,tooltip,spinner,empty-states,error-states}.json
```
If `init` still prompts, answer: base color neutral, CSS variables yes. Expected: `components.json` aliases `@/components`, `@/lib/utils`; files under `src/components/ui/`; `npm ls radix-ui @mdi/js class-variance-authority` resolves.
- [ ] **Step 5: Add jsdom polyfills for Radix** in `vitest.setup.ts`: no-op `hasPointerCapture` (returns `false`), `setPointerCapture`, `releasePointerCapture` and `scrollIntoView` on `Element.prototype`, plus `globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }`.
- [ ] **Step 6: Verify.** Run `npx tsc --noEmit && npm test && npm run build`. Expected: no errors, 33 tests pass, build succeeds.
- [ ] **Step 7: Commit.**
```bash
git add -A -- . ':!.claude'
git commit -m "build: Tailwind 4, src alias, Sitecore Blok components"
```

---

### Task 2: SDK helpers and fake client

**Files:**
- Create: `src/lib/sdk.ts`, `src/lib/sdk.test.ts`, `src/test/fakeClient.ts`

**Interfaces:**
- Produces (all from `@/lib/sdk`):
  - `type Env = { id: string; name: string; contextId: string }`
  - `interface SdkClient { query(key: string, options?: { params?: unknown }): Promise<any>; mutate(key: string, options?: { params?: unknown }): Promise<any> }`
  - `class SdkError extends Error { status?: number }`
  - `const CONTEXT_KIND: 'preview' | 'live' = 'preview'`
  - `toEnvs(ctx: ApplicationContext | undefined): Env[]`
  - `call<T = any>(client: SdkClient, env: Env, kind: 'query' | 'mutate', key: string, params?: { path?: Record<string, unknown>; query?: Record<string, unknown>; body?: unknown }): Promise<{ data: T; response?: Response }>`
  - `type TreeNode = { id: string; name: string; path: string; hasChildren: boolean }`
  - `fetchChildren(client: SdkClient, env: Env, path: string): Promise<TreeNode[]>`
  - `fetchItemId(client: SdkClient, env: Env, path: string): Promise<string | null>`
- Produces `fakeClient(handlers)` from `@/test/fakeClient`. All later tests use it; its exact shape follows.

- [ ] **Step 1: Write the fake client.** It mirrors the real SDK result shapes: `mutate` resolves to the hey-api `{ data, error, response }`; `query` on `xmc.*` resolves to `{ data: <that> }`; `query` on host keys (e.g. `application.context`) resolves to `{ data }`; a thrown handler inside `query` becomes `{ data: undefined, error }`.
```ts
import type { SdkClient } from '@/lib/sdk';

export type FakeReply = { data?: unknown; status?: number; headers?: Record<string, string>; error?: unknown };
type Handler = (params: any) => FakeReply | Promise<FakeReply>;

export function fakeClient(handlers: Record<string, Handler>) {
  const calls: { kind: 'query' | 'mutate'; key: string; params: any }[] = [];
  const run = async (kind: 'query' | 'mutate', key: string, opts?: { params?: unknown }) => {
    calls.push({ kind, key, params: opts?.params });
    const handler = handlers[key];
    if (!handler) throw new Error(`unexpected call ${key}`);
    let reply: FakeReply;
    try { reply = await handler(opts?.params); }
    catch (error) { if (kind === 'query') return { data: undefined, error }; throw error; }
    if (!key.startsWith('xmc.')) return { data: reply.data };
    const status = reply.status ?? 200;
    const result = {
      data: status < 400 ? reply.data : undefined,
      error: status >= 400 ? (reply.error ?? `HTTP ${status}`) : undefined,
      response: new Response(null, { status, headers: reply.headers }),
    };
    return kind === 'query' ? { data: result } : result;
  };
  const client: SdkClient = { query: (k, o) => run('query', k, o), mutate: (k, o) => run('mutate', k, o) };
  return { client, calls };
}
```
- [ ] **Step 2: Write the failing tests** in `sdk.test.ts`. `DEV = { id: 'r1', name: 'Dev', contextId: 'p1' }`.
  - `toEnvs maps resourceAccess to envs`: entries `{ resourceId: 'r1', tenantDisplayName: 'Dev', context: { preview: 'p1', live: 'l1' } }` and `{ resourceId: 'r2', tenantName: 'acme-qa', context: { preview: 'p2', live: 'l2' } }` → `[{ id: 'r1', name: 'Dev', contextId: 'p1' }, { id: 'r2', name: 'acme-qa', contextId: 'p2' }]`
  - `toEnvs skips entries without a context id`: `context: { preview: '', live: 'l1' }` → `[]`
  - `toEnvs falls back to deprecated resources`: no `resourceAccess`, same entries under `resources` → same output
  - `call adds sitecoreContextId and returns data and response`: `mutate` `xmc.contentTransfer.completeChunkSetTransfer` with `{ path: { transferId: 't', chunksetId: 'c' } }` → `calls[0].params` equals `{ path: { transferId: 't', chunksetId: 'c' }, query: { sitecoreContextId: 'p1' } }`; `data` equals the handler's data; `response.status === 200`
  - `call unwraps query results`: `query` `xmc.contentTransfer.getContentTransferStatus` → `data` equals the handler's data
  - `call maps 401 and 403 to the access message`: status 403 → rejects with `The app can't access Dev. Grant it in Cloud Portal → app → environment access.` and `status === 403`
  - `call reports other API errors with status`: status 500, `error: { Message: 'boom' }` → `SdkError`, message contains `boom`, `status === 500`
  - `call wraps thrown client errors`: handler throws `new Error('bridge down')` → `SdkError` with message `bridge down`
  - `fetchChildren maps nodes`: GraphQL data `{ data: { item: { children: { nodes: [{ itemId: 'a', name: 'content', path: '/sitecore/content', children: { nodes: [{ itemId: 'x' }] } }, { itemId: 'b', name: 'leaf', path: '/sitecore/leaf', children: { nodes: [] } }] } } } }` → `[{ id: 'a', name: 'content', path: '/sitecore/content', hasChildren: true }, { id: 'b', name: 'leaf', path: '/sitecore/leaf', hasChildren: false }]`
  - `fetchChildren passes the path verbatim`: `/sitecore/media library/Images` → `calls[0].params.body.variables.path` is that exact string
  - `fetchChildren returns [] for a missing item`: `{ data: { item: null } }` → `[]`
  - `fetchChildren throws the first GraphQL error`: `{ errors: [{ message: 'bad' }] }` → rejects with `bad`
  - `fetchItemId returns the id or null`
- [ ] **Step 3: Run the tests to see them fail.** Run `npx vitest run src/lib/sdk.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 4: Implement `src/lib/sdk.ts`.**
  - `toEnvs`: name is `tenantDisplayName ?? tenantName ?? resourceId`; `contextId` is `context[CONTEXT_KIND]`.
  - `call`: merge `query: { ...params.query, sitecoreContextId: env.contextId }`. Treat a call as failed when `response && !response.ok` or `error !== undefined`. The message is `HTTP <status>: <msg>`, where `<msg>` is the error string, `.message`, `.Message`, `.title` or `JSON.stringify(error)`. Map 401/403 to the exact access message.
  - GraphQL helpers: `call(client, env, 'mutate', 'xmc.authoring.graphql', { body: { query, variables: { path } } })`; the returned data is `{ data, errors }`. Use the children query from the spec. `fetchItemId` queries `item(where: { path, database: "master" }) { itemId }`.
- [ ] **Step 5: Run the tests to see them pass.** Run `npx vitest run src/lib/sdk.test.ts`. Expected: PASS.
- [ ] **Step 6: Commit.**
```bash
git add src/lib/sdk.ts src/lib/sdk.test.ts src/test/fakeClient.ts
git commit -m "feat: SDK call helper, environments and tree queries"
```

---

### Task 3: Transfer pipeline (`runTransfer`)

**Files:**
- Create: `src/lib/transfer.ts`, `src/lib/transfer.test.ts`

**Interfaces:**
- Consumes: `call`, `Env`, `SdkClient`, `SdkError` (Task 2); `fakeClient` (Task 2)
- Produces (from `@/lib/transfer`):
  - `type Scope = 'SingleItem' | 'ItemAndDescendants'`
  - `type MergeStrategy = 'OverrideExistingItem' | 'KeepExistingItem' | 'LatestWin' | 'OverrideExistingTree'`
  - `type DataTree = { itemPath: string; scope: Scope; mergeStrategy: MergeStrategy }`
  - `type LogType = 'info' | 'success' | 'warning' | 'error'`
  - `type StepStatus = 'pending' | 'running' | 'done' | 'fail'`
  - `interface RunCallbacks { onLog(message: string, type: LogType): void; onProgress(percent: number): void; onStepChange(index: number, status: StepStatus): void }`
  - `TRANSFER_STEPS = ['Create job', 'Wait for package', 'Copy chunks', 'Assemble on target', 'Import into database', 'Verify']`
  - `TIMING = { pollMs: 3000, statusTimeoutMs: 600_000, verifyTimeoutMs: 300_000 }` (mutable, so tests can shorten it)
  - `BLOB_SUCCESS = ['OK', 'Transferred', 'Consumed']`; `BLOB_FAILURE = ['Error', 'Failed']`
  - `parseIsMedia(header: string | null): boolean`
  - `runTransfer(client: SdkClient, opts: { source: Env; target: Env; database: string; dataTrees: DataTree[] }, cb: RunCallbacks, signal?: AbortSignal): Promise<boolean>`
  - Internal helpers that Task 4 reuses from the same file:
    - `sleep(ms, signal)`
    - `waitForPackage(client, env, transferId, signal): Promise<{ ChunkSetId: string; ChunkCount: number }[]>`
    - `consumeFiles(client, env, database, files, signal)`
    - `verifyFiles(client, env, files, cb, signal)`
    - `cleanup(client, envs, transferId, cb)`

- [ ] **Step 1: Write the failing tests.**
  - **Fixtures:** `DEV = { id: 'r1', name: 'Dev', contextId: 'ctx-dev' }`, `QA = { id: 'r2', name: 'QA', contextId: 'ctx-qa' }`, `TREES = [{ itemPath: '/sitecore/media library/Images/Hero Banner', scope: 'SingleItem', mergeStrategy: 'OverrideExistingItem' }]`. `beforeEach`: `Object.assign(TIMING, { pollMs: 0, statusTimeoutMs: 50, verifyTimeoutMs: 50 })`.
  - **`happyHandlers(overrides)`:**
    - `getContentTransferStatus`: returns `Processing` first, then `{ State: 'Completed', ChunkSetsMetadata: [{ ChunkSetId: 'cs1', ChunkCount: 2, TotalItemCount: 3 }] }`.
    - `getChunk`: returns `new Blob(['c' + chunkId])` with header `content-disposition: attachment; IsMedia=<chunkId === 1>`.
    - `completeChunkSetTransfer`: returns `{ ContentTransferFileName: 'f-' + chunksetId + '.raif' }`.
    - `getBlobState`: returns `{ status: 'NotFound' }` first, then `{ status: 'OK' }`.
    - Every other call returns `{}`.
  - **The cases:**
    - `runs the full pipeline against the right environments`: returns `true`. Deduplicated key order: create, status, getChunk, saveChunk, getChunk, saveChunk, complete, consumeFile, getBlobState, delete, delete. Context IDs: create, status, getChunk and the first delete use `ctx-dev`; everything else uses `ctx-qa`. The create body equals `{ transferId: expect.any(String), configuration: { dataTrees: TREES } }`, so the spaced path arrives verbatim. The `saveChunk` calls have `path: { transferId, chunksetId: 'cs1', chunkId: 0 }` with `query.isMedia` `false`, then `chunkId: 1` with `true`, and the body is the fetched Blob. `consumeFile` query equals `{ databaseName: 'master', fileName: 'f-cs1.raif', sitecoreContextId: 'ctx-qa' }`. The last progress is `100`. `onStepChange` reports every index 0–5 as `done`.
    - `handles every chunk set`: two sets (`cs1`, `cs2`, one chunk each) → `saveChunk` chunksetIds `['cs1', 'cs2']`, `complete` twice, `consumeFile` fileNames `['f-cs1.raif', 'f-cs2.raif']`, `getBlobState` for each
    - `treats a 404 status as still processing`: the first status call returns 404 → still `true`
    - `fails when the source reports Failed`: → `false`, step 1 `fail`, an `error` log, both deletes called
    - `fails when the source has no content`: `Completed` with `[]` → `false`, log contains `Source returned no content for the selected paths. Check that they exist.`
    - `times out waiting for the package`: always `Processing` → `false`, log contains `Timed out waiting for the source package.`
    - `shows the access message on 403`: `saveChunk` 403 → log contains `The app can't access QA. Grant it in Cloud Portal → app → environment access.`
    - `fails when the blob state is Error`: → `false`, step 5 `fail`
    - `cancels and still cleans up`: abort the controller inside the create handler → `false`, a `warning` log `Cancelled.`, no status call, deletes on `ctx-dev` and `ctx-qa`
    - `treats a cleanup failure as a warning`: delete returns 500 → `true`, a `warning` log starting `Cleanup failed`
- [ ] **Step 2: Run the tests to see them fail.** Run `npx vitest run src/lib/transfer.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement.**
  - `transferId = crypto.randomUUID()`. Run steps 0–5 as the spec's Transfer section describes, inside `try` / `catch` / `finally`.
  - **Abort:** `signal?.throwIfAborted()` before every call; `sleep` rejects on abort. On abort, log `Cancelled.` as a warning.
  - **Errors:** mark the current step `fail`, log the error message, return `false`.
  - **Cleanup:** `finally` always runs `cleanup` on `[source, target]`. Each failed delete logs `Cleanup failed on <env>: <msg>` as a warning and never throws.
  - **Progress:** create 5; wait 15; copying runs 15 → 75 linearly over all chunks; assemble 80; import 88; verify 100.
  - **`waitForPackage`:** an `SdkError` with status 404 means "keep polling". `Failed` throws `The source environment reported the transfer as Failed.` Past the deadline it throws `Timed out waiting for the source package.`
  - **`verifyFiles`:** statuses in `BLOB_SUCCESS` count as done. Statuses in `BLOB_FAILURE` throw `Import failed on <env>: <status>`. Any other status means keep polling until the deadline, then throw `Timed out waiting for the import to finish.`
  - **`parseIsMedia`:** `/IsMedia\s*=\s*(true|false)/i`.
- [ ] **Step 4: Run the tests to see them pass.** Run `npx vitest run src/lib/transfer.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.**
```bash
git add src/lib/transfer.ts src/lib/transfer.test.ts
git commit -m "feat: SDK-based environment-to-environment transfer pipeline"
```

---

### Task 4: Package format, export and import

**Files:**
- Create: `src/lib/package.ts`, `src/lib/package.test.ts`
- Modify: `src/lib/transfer.ts`, `src/lib/transfer.test.ts`

**Interfaces:**
- Consumes: Task 2 (`call`, `fetchItemId`); Task 3 internal helpers and types
- Produces:
  - From `@/lib/package`:
    - `type PackageItem = { path: string; id: string; scope: string; mergeStrategy: string }`
    - `type ChunkData = { chunkSet: number; index: number; isMedia: boolean; data: Blob }`
    - `type PackagePart = { chunks: { data: Blob; isMedia: boolean }[] }`
    - `LEGACY_SLICE = 1024 * 1024`
    - `buildPackage(chunks: ChunkData[], items: PackageItem[]): Promise<Blob>`
    - `readPackage(file: Blob & { name: string }): Promise<{ items: PackageItem[]; parts: PackagePart[] }>`
  - From `@/lib/transfer`:
    - `EXPORT_STEPS = ['Create job', 'Wait for package', 'Download & zip']`
    - `IMPORT_STEPS = ['Upload package', 'Assemble on target', 'Import into database', 'Verify']`
    - `runExport(client, opts: { source: Env; dataTrees: DataTree[] }, cb, signal?): Promise<Blob | null>`
    - `runImport(client, opts: { target: Env; database: string; parts: PackagePart[] }, cb, signal?): Promise<boolean>`

- [ ] **Step 1: Write the failing package tests.**
  - `buildPackage writes legacy metadata, raif and chunk map`: chunks `[{ chunkSet: 0, index: 0, isMedia: false, data: Blob('aa') }, { chunkSet: 0, index: 1, isMedia: true, data: Blob('bbb') }]` and items `[{ path: '/a', id: '{A}', scope: 'SingleItem', mergeStrategy: 'KeepExistingItem' }]` produce:
    - `package-metadata.json` equal to `[{ ItemPath: '/a', ItemId: '{A}', Scope: 'SingleItem', MergeStrategy: 'KeepExistingItem' }]`
    - `package.raif` text equal to `'aabbb'`
    - `package-chunks.json` equal to `[{ chunkSet: 0, index: 0, isMedia: false, offset: 0, length: 2 }, { chunkSet: 0, index: 1, isMedia: true, offset: 2, length: 3 }]`
  - `readPackage round-trips a new package`: the `buildPackage` output wrapped as `p.zip` → the items above; one part with chunk texts `['aa', 'bbb']` and isMedia `[false, true]`
  - `readPackage splits chunk sets into parts`: two `chunkSet` values → 2 parts
  - `readPackage reads a legacy zip in 1 MB slices`: a zip with metadata plus a 2.5 MB `package.raif` (no chunk map) → one part with sizes `[1048576, 1048576, 524288]`, all `isMedia: false`
  - `readPackage slices a .raif without reading it`: a `Blob` subclass whose `arrayBuffer()` and `text()` throw, 1.5 MB, `name: 'x.raif'` → items `[]`, sizes `[1048576, 524288]`
  - `readPackage rejects a zip without package.raif` → `This package has no package.raif.`
  - `readPackage rejects other file types` (`q.txt`) → `Choose a .zip or .raif package.`
- [ ] **Step 2: Write the failing export/import tests** in `transfer.test.ts`:
  - `exports a zip with metadata and every chunk`: Task 3 handlers plus `xmc.authoring.graphql` → `{ data: { item: { itemId: '{ID}' } } }`. Running `readPackage` on the returned Blob (named `e.zip`) gives `items[0].id === '{ID}'` and chunk texts `['c0', 'c1']` with isMedia `[false, true]`. There are no `saveChunk` or `consumeFile` calls, exactly one delete (on `ctx-dev`), and the last progress is `100`.
  - `export returns null and cleans up on failure`: status `Failed` → `null`, delete on `ctx-dev`
  - `imports each part into the target`: parts = set A (2 chunks, isMedia `[false, true]`) and set B (1 chunk). Expect:
    - all calls on `ctx-qa`
    - `saveChunk` chunkIds `0, 1` under one chunksetId and `0` under a different one, with isMedia flags passed through
    - `complete` twice, then `consumeFile` with each returned fileName
    - `getBlobState`, then delete; result `true`
  - `import shows the access message on 403 and cleans up`: `saveChunk` 403 → `false`, the access message for QA, delete still called
- [ ] **Step 3: Run the tests to see them fail.** Run `npx vitest run src/lib`. Expected: the new tests FAIL.
- [ ] **Step 4: Implement.**
  - **`buildPackage`:** concatenate chunk data in `(chunkSet, index)` order into `package.raif`. Write `package-chunks.json` as offset/length entries. Generate with `generateAsync({ type: 'uint8array', compression: 'DEFLATE' })` and wrap as `new Blob([..], { type: 'application/zip' })`.
  - **`readPackage`:** dispatch on the lowercased extension. Load zips with `JSZip.loadAsync(await file.arrayBuffer())`. With a chunk map, slice `package.raif` per entry and group by `chunkSet`. Without one, slice by `LEGACY_SLICE`. A `.raif` is sliced with `file.slice` only.
  - **`runExport`:** steps 0–1 reuse the Task 3 helpers. Step 2 downloads every chunk of every set (isMedia from `parseIsMedia`), resolves each tree's `ItemId` via `fetchItemId` (`''` when null) and calls `buildPackage`. Cleanup runs on the source only. Progress: 10, 30, 30 → 95 across chunks, then 100.
  - **`runImport`:** use one `transferId`; each part gets a fresh `chunksetId` (`crypto.randomUUID()`). Upload with `saveChunk` (progress 0 → 50), `complete` each part (65), `consumeFiles` (80), `verifyFiles` (100). Cleanup runs on the target only. Error and abort handling match Task 3.
- [ ] **Step 5: Run the tests to see them pass.** Run `npx vitest run src/lib`. Expected: PASS.
- [ ] **Step 6: Commit.**
```bash
git add src/lib
git commit -m "feat: package export and import with per-chunk media map"
```

---

### Task 5: Queue logic, EnvironmentBar, SelectionQueue

**Files:**
- Create: `src/lib/queue.ts`, `src/lib/queue.test.ts`, `src/components/transfer/EnvironmentBar.tsx`, `src/components/transfer/SelectionQueue.tsx`, `src/components/transfer/SelectionQueue.test.tsx`, `src/components/transfer/EnvironmentBar.test.tsx`

**Interfaces:**
- Consumes: `DataTree`, `Scope`, `MergeStrategy` (Task 3); `Env` (Task 2)
- Produces:
  - From `@/lib/queue`:
    - `SCOPES: { value: Scope; label: string }[]`: `SingleItem` → `Single item`; `ItemAndDescendants` → `Item & descendants`
    - `MERGES: { value: MergeStrategy; label: string; description: string }[]`:
      - `OverrideExistingTree`: `Override tree`, "Replace the item and all its descendants on the target."
      - `OverrideExistingItem`: `Override item`, "Replace only this item; leave its descendants alone."
      - `KeepExistingItem`: `Keep existing`, "Skip items that already exist on the target."
      - `LatestWin`: `Latest wins`, "Keep whichever version was modified most recently."
    - `newTree(itemPath: string): DataTree`
    - `mergeTrees(existing: DataTree[], incoming: DataTree[]): DataTree[]`
    - `parseQueueJson(text: string): DataTree[]`
  - `type Mode = 'transfer' | 'export' | 'import'` and `EnvironmentBar(props: { mode: Mode; envs: Env[]; sourceId?: string; targetId?: string; database: string; disabled?: boolean; onSourceChange(id: string): void; onTargetChange(id: string): void; onDatabaseChange(db: string): void; onSwap(): void })`, from `@/components/transfer/EnvironmentBar`
  - `SelectionQueue(props: { trees: DataTree[]; onChange(trees: DataTree[]): void; disabled?: boolean })`

- [ ] **Step 1: Write the failing tests.**
  - **`queue.test.ts`:**
    - `newTree uses the defaults` → `{ itemPath, scope: 'ItemAndDescendants', mergeStrategy: 'OverrideExistingTree' }`
    - `mergeTrees dedupes by path`: existing `/a`, incoming `/a/` and `/b` → `/a` (the existing row) and `/b`
    - `parseQueueJson accepts an array, { dataTrees } and { items }`, with keys `path | ItemPath | itemPath`, `scope | Scope` and `strategy | MergeStrategy | mergeStrategy`
    - `parseQueueJson maps unsupported scope and merge to the defaults`: `ItemAndChildren` → `ItemAndDescendants`
    - `parseQueueJson drops rows without a path`
    - `parseQueueJson rejects other shapes`: `{}` → `Invalid JSON format. Expected an array of items or a dataTrees object wrapper.`
    - `parseQueueJson rejects empty results` → `No valid item paths found in JSON.`
  - **`EnvironmentBar.test.tsx`:**
    - transfer mode → `getByLabelText` finds `Source`, `Target`, `Database` and the button `Swap source and target`
    - export mode → only `Source`
    - import mode → `Target` and `Database`
    - clicking swap calls `onSwap`
  - **`SelectionQueue.test.tsx`:**
    - empty → `Pick items from the tree or paste a path.`
    - `Remove /a` calls `onChange` without `/a`
    - typing `/c` into Add path and pressing Enter → `onChange` with `/c` appended via `newTree`; adding an existing path leaves the list unchanged
    - **Import JSON** with a `File` holding `[{ "path": "/d" }]` → `onChange` includes `/d`
    - invalid JSON → the error text is shown
- [ ] **Step 2: Run the tests to see them fail.** Run `npx vitest run src/lib/queue.test.ts src/components/transfer`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Selects:** Blok `Select`, with a Blok `Label` linked to each trigger by `htmlFor`/`id`. The swap button uses `Icon` with `mdiSwapHorizontal`.
  - **Queue rows:** the path in mono with a `title` tooltip; Scope select (aria-label `Scope for <path>`); Merge select (aria-label `Merge for <path>`) whose items show the label plus a muted one-line description; remove button (aria-label `Remove <path>`).
  - **Queue header:** `Selected (n)`, Add path (input plus button, Enter submits), **Import JSON** (hidden file input clicked via a ref; read with `file.text()`; errors shown in a Blok `Alert`) and **Clear all**.
- [ ] **Step 4: Run the tests to see them pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.**
```bash
git add src/lib/queue.ts src/lib/queue.test.ts src/components/transfer
git commit -m "feat: environment bar and selection queue"
```

---

### Task 6: ContentTree

**Files:**
- Create: `src/components/transfer/ContentTree.tsx`, `src/components/transfer/ContentTree.test.tsx`

**Interfaces:**
- Consumes: `fetchChildren`, `TreeNode`, `Env`, `SdkClient` (Task 2)
- Produces: `ContentTree(props: { client: SdkClient; env: Env; selectedPaths: string[]; onToggle(path: string, checked: boolean): void })`

- [ ] **Step 1: Write the failing tests.** The fake `xmc.authoring.graphql` handler answers per `params.body.variables.path`: `/sitecore` → `content` and `media library`; `/sitecore/content` → `Home`.
  - `renders the root children` → `content` and `media library` appear (`findByText`)
  - `expanding loads children`: click `Expand content` → `Home` appears; the button gets `aria-expanded="true"`
  - `ticking selects a path`: click checkbox `Select /sitecore/content` → `onToggle('/sitecore/content', true)`; with `selectedPaths=['/sitecore/content']` the checkbox is checked
  - `filter shows matching loaded items`: type `med` in `Filter loaded items` → `media library` is shown and `content` is not
  - `shows Retry on error`: the first call returns status 500, the second succeeds; clicking `Retry` → `content` appears
- [ ] **Step 2: Run the tests to see them fail.** Run `npx vitest run src/components/transfer/ContentTree.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Load `/sitecore` on mount, and again whenever `env.id` changes, which also clears the cache.
  - Cache per path: `TreeNode[] | 'loading' | { error: string }`.
  - Rows use a `Collapsible` expand button (aria-label `Expand <name>` / `Collapse <name>`), a Blok `Checkbox` (aria-label `Select <path>`) and the name. Rows are indented by depth.
  - `Skeleton` rows show while loading; Blok `error-states` with a `Retry` button shows per failed node.
  - A non-empty filter switches to a flat list of matching loaded nodes, showing each path.
  - Wrap the tree in a `ScrollArea`.
- [ ] **Step 4: Run the tests to see them pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.**
```bash
git add src/components/transfer/ContentTree.tsx src/components/transfer/ContentTree.test.tsx
git commit -m "feat: lazy source content tree via authoring GraphQL"
```

---

### Task 7: RunPanel and ImportPanel

**Files:**
- Create: `src/components/transfer/RunPanel.tsx`, `src/components/transfer/ImportPanel.tsx`, `src/components/transfer/RunPanel.test.tsx`, `src/components/transfer/ImportPanel.test.tsx`

**Interfaces:**
- Consumes: `StepStatus`, `LogType` (Task 3); `readPackage`, `PackageItem`, `PackagePart` (Task 4)
- Produces:
  - `type LogLine = { text: string; type: LogType; time: string }`
  - `RunPanel(props: { open: boolean; compact?: boolean; title: string; steps: { label: string; status: StepStatus }[]; progress: number; logs: LogLine[]; running: boolean; result: 'success' | 'fail' | null; onCancel(): void; onClose(): void; onRunAgain(): void })`
  - `type LoadedPackage = { fileName: string; items: PackageItem[]; parts: PackagePart[] }`
  - `ImportPanel(props: { disabled?: boolean; onPackage(pkg: LoadedPackage | null): void })`

- [ ] **Step 1: Write the failing tests.**
  - `RunPanel`:
    - while running, it shows each step label, `Cancel` (which calls `onCancel`) and an `aria-live="polite"` status containing the running step's label and `<progress>%`
    - with `result: 'success'` it shows `Completed`, `Done` (calls `onClose`) and `Run again` (calls `onRunAgain`), and no `Cancel`
    - with `result: 'fail'` it shows `Failed`
    - `Copy logs` calls a mocked `navigator.clipboard.writeText` with lines formatted `<time> <text>` joined by `\n`
    - `compact` renders without `role="dialog"`
  - `ImportPanel`:
    - choosing a legacy zip `File` (built in the test with JSZip, holding metadata for `/sitecore/content/A`) lists `/sitecore/content/A` and calls `onPackage` with `fileName` and one part
    - choosing `q.txt` shows `Choose a .zip or .raif package.` and calls `onPackage(null)`
- [ ] **Step 2: Run the tests to see them fail.** Run `npx vitest run src/components/transfer/RunPanel.test.tsx src/components/transfer/ImportPanel.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **RunPanel:**
    - Rendered in a Blok `Sheet` on the right, or inline when `compact`. While running, ignore close requests (`onOpenChange`, plus `preventDefault` in `onEscapeKeyDown` and `onPointerDownOutside`).
    - Step icons from `@mdi/js`: pending `mdiCircleOutline`, running Blok `Spinner`, done `mdiCheckCircle`, fail `mdiAlertCircle`.
    - A Blok `Progress` bar; logs in a `Collapsible` (mono, timestamped) with a `Copy logs` button.
  - **ImportPanel:**
    - A drop zone (a `label` wrapping a hidden input with `accept=".zip,.raif"`, plus `onDrop`) that calls `readPackage`.
    - Shows the file name and chunk count, and a read-only table of path, scope and merge. A bare `.raif` shows `No metadata in this package.`
    - Errors show in an `Alert` and call `onPackage(null)`.
- [ ] **Step 4: Run the tests to see them pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.**
```bash
git add src/components/transfer/RunPanel* src/components/transfer/ImportPanel*
git commit -m "feat: run panel and import panel"
```

---

### Task 8: Workspace, environments hook, extension pages

**Files:**
- Create: `src/utils/hooks/useEnvironments.ts`, `src/components/transfer/Workspace.tsx`, `src/components/transfer/Workspace.test.tsx`
- Modify: `src/app/fullscreen-extension/page.tsx` (keep the spike branch until Task 9), `src/app/standalone-extension/page.tsx`, `src/app/pages-contextpanel-extension/page.tsx`, `src/app/layout.tsx` (title `Content Transfer`)

**Interfaces:**
- Consumes: everything from Tasks 2–7
- Produces:
  - `useEnvironments(client: SdkClient | null): { envs: Env[]; loading: boolean; error: string | null; retry(): void }`
  - `blockReason(mode: Mode, s: { envs: Env[]; source?: Env; target?: Env; trees: DataTree[]; hasPackage: boolean }): string | null`
  - `Workspace(props: { client: SdkClient | null; compact?: boolean; initialItemPath?: string })`

- [ ] **Step 1: Write the failing tests.**
  - **`blockReason` cases, checked in this order:**
    - transfer with fewer than 2 envs → the one-environment message
    - missing source (transfer/export) or target (transfer/import) → `Choose an environment.`
    - same source and target in transfer → `Source and target must be different environments.`
    - an empty queue in transfer/export → `Add at least one item to the queue.`
    - import without a package → `Choose a package to import.`
    - otherwise `null`
  - **`Workspace`** (fake client with `application.context`, tree and transfer handlers; `TIMING.pollMs = 0`):
    - `lists environments from the application context`: with envs Dev and QA, the `Source` trigger shows `Dev` and the `Target` trigger shows `QA`
    - `shows the access notice with one environment`: the one-environment message is visible and `Start transfer` is disabled
    - `shows a Retry alert when the context fails`: the `application.context` handler throws `Error('no context')` the first time → an alert containing `no context` and a `Retry` button; clicking `Retry` (second call succeeds) → the `Source` trigger shows `Dev`
    - `warns before writing to a prod-looking target`: envs Dev and `Prod-EU`, `initialItemPath="/sitecore/content/Home"`, click `Start transfer` → the dialog shows `Prod-EU looks like a production environment. Double-check before continuing.`
    - `runs a transfer end to end and blocks a second start`: same setup with Dev/QA; click `Start transfer` and then `Start`; `Start transfer` is disabled while running; `findByText('Completed')`
- [ ] **Step 2: Run the tests to see them fail.** Run `npx vitest run src/components/transfer/Workspace.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **`useEnvironments`:** `client.query('application.context')` → `toEnvs(res.data)`. `res.error` becomes `error`. `retry` re-queries.
  - **Environment states:** while `loading`, show `Skeleton`s in place of the `EnvironmentBar`. On `error`, show a destructive Blok `Alert` with the error text and a `Retry` button that calls `retry()`. On no envs and no error, show the one-environment message.
  - **`Workspace` defaults:** mode `transfer`, source `envs[0]`, target `envs[1]`, database `master`. Trees start empty, or as `[newTree(initialItemPath)]` whenever that prop changes.
  - **Layout:**
    - Header: title `Content Transfer` plus Blok `Tabs` (`Transfer` / `Export` / `Import`; hidden when `compact`).
    - Below it, `EnvironmentBar`.
    - Body: transfer/export show `ContentTree` (left, source env) and `SelectionQueue` (right); import shows `ImportPanel` (left) and its contents. Ticking the tree uses `mergeTrees`; unticking removes the path.
    - Compact: one column of `EnvironmentBar` and `SelectionQueue`, no tree.
  - **Primary button:** `Start transfer` / `Export package` / `Import package`; in compact, `Send to <target name>`. Disabled when `blockReason` returns a reason or a run is in progress. The one-environment reason shows as a Blok `Alert`; other reasons as muted helper text.
  - **Confirm (`AlertDialog`):**
    - Title: `Start transfer?`, `Export package?` or `Import package?`.
    - Body for transfer: `Copy <n> item tree(s) from <source> → <target> (<database>). Merge: <unique merge labels joined by ", ">.`
    - Body for export: `Export <n> item tree(s) from <source>.`
    - Body for import: `Import <fileName> into <target> (<database>).`
    - Plus the prod warning when it applies. Buttons: `Cancel` / `Start`.
  - **Run:**
    - Uses an `AbortController`. Calls `runTransfer` / `runExport` / `runImport`, feeding `RunPanel` state (steps from `TRANSFER_STEPS` / `EXPORT_STEPS` / `IMPORT_STEPS`).
    - An export Blob downloads via `URL.createObjectURL` as `contentTransfer-<source name>-<YYYY-MM-DD>.zip`.
    - `Run again` closes the panel and reopens the confirm dialog.
  - **Pages:** each uses `useMarketplaceClient()` and renders `<Workspace client={client} … />`. An SDK init error shows a Blok `Alert`: `Couldn't connect to Sitecore: <error>`. The pages context panel subscribes to `pages.context` as today and renders a Blok `Card` with the page name and path above `<Workspace compact initialItemPath={path} />`.
- [ ] **Step 4: Run the tests to see them pass.** Run `npx vitest run src/components/transfer`. Expected: PASS.
- [ ] **Step 5: Type-check and build.** Run `npx tsc --noEmit && npm run build`. Expected: no errors.
- [ ] **Step 6: Commit.**
```bash
git add src/utils/hooks/useEnvironments.ts src/components/transfer src/app
git commit -m "feat: workspace UI wired to extension pages"
```

---

### Task 9: Remove legacy code, update README

**Files:**
- Delete: `src/app/api/`, `src/utils/auth.ts`, `src/utils/auth.test.ts`, `src/utils/migrationService.ts`, `src/utils/migrationService.test.ts`, `src/components/MigrationDashboard.tsx`, `src/components/MigrationDashboard.test.tsx`, `src/components/ContentTreeExplorer.tsx`, `src/components/ContentTreeExplorer.test.tsx`, `src/app/fullscreen-extension/Spike.tsx`
- Modify: `src/app/fullscreen-extension/page.tsx` (drop the spike branch), `src/app/globals.css` (remove the old `:root` variables and `body.dark-mode`; keep the Tailwind import and the Blok theme), `package.json` (remove `lucide-react`), `README.md`

- [ ] **Step 1: Confirm the stash from Task 1 still exists** (`git stash list` shows `pre-redesign JSON button fix`). Leave it for the user to drop.
- [ ] **Step 2: Delete the legacy files.**
```bash
git rm -r src/app/api src/utils/auth.ts src/utils/auth.test.ts src/utils/migrationService.ts src/utils/migrationService.test.ts src/components/MigrationDashboard.tsx src/components/MigrationDashboard.test.tsx src/components/ContentTreeExplorer.tsx src/components/ContentTreeExplorer.test.tsx src/app/fullscreen-extension/Spike.tsx
npm uninstall lucide-react
```
Then drop the spike branch from the fullscreen page and the old variables from `globals.css`.
- [ ] **Step 3: Check that nothing legacy remains.** Run `grep -rnE "clientSecret|client_secret|/api/migrate|NODE_TLS|lucide-react|localStorage|demoMode" src`. Expected: no output.
- [ ] **Step 4: Rewrite `README.md`.** Sections:
  - **What it does:** the three workflows
  - **Setup:** install the app in Cloud Portal, grant it access to every environment you transfer between, and map the fullscreen, standalone and pages context panel extension points
  - **Develop:** `npm install`, `npm run dev`, `npm test`
  - **How it works:** Marketplace SDK `contentTransfer` + authoring GraphQL; no credentials
  - **Package format:** `package-metadata.json`, `package.raif`, `package-chunks.json`
  - **Limitations:** same organization only; light theme only
- [ ] **Step 5: Verify.** Run `npx tsc --noEmit && npm test && npm run build`. Expected: no errors, all tests pass, build succeeds.
- [ ] **Step 6: Commit.**
```bash
git add -A -- . ':!.claude'
git commit -m "refactor: remove credential-based server pipeline and legacy dashboard"
```

---

### Task 10: Manual verification in XM Cloud (user-run)

- [ ] **Step 1: Start the dev server.** Run `npm run dev` and ask the user to open the app's fullscreen extension in XM Cloud.
- [ ] **Step 2: Have the user run the spec's manual checks and report results:**
  - transfer a small tree containing a media item from Dev → QA, then confirm the items and the media file exist in QA
  - export the same tree, then import the zip into QA
  - in the Pages editor, use the context panel to send the current page to another environment
  - with the app granted only one environment, see the access notice
- [ ] **Step 3: Record the results.** Add a "Manual verification" section to the spec, with any failures filed as follow-ups, and commit.
```bash
git add docs/superpowers/specs
git commit -m "docs: record manual verification results"
```
