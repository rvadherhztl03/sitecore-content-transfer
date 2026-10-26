# UI v2 guided flow: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tabbed `Workspace` with the approved guided flow (Home → Route → Content → Review → Running → Complete/Failed, plus Install and the Pages panel). Fix environment identity.

**Architecture:** Screens are in-app state. `App` switches between `Home`, `Flow` (transfer/export) and `InstallFlow`; `PanelFlow` serves the Pages editor panel. Each screen renders the shared `AppHeader`/`ActionBar` and composes small presentational pieces (`Stepper`, `EnvironmentCards`, `Segmented`, `ReviewStep`, `RunView`). These are built on the kept `ContentTree`, `SelectionQueue` and `ImportPanel` (restyled). The engine (`src/lib/*`) changes only as Task 1 states.

**Tech Stack:** Next.js 15, React 19, TypeScript 5.9, Sitecore Blok (Radix + Tailwind 4), `@mdi/js` icons via `Icon`, Vitest 4 + Testing Library (jsdom, `fireEvent`).

**Spec:** `docs/superpowers/specs/2026-10-15-ui-v2-guided-flow-design.md`. Visual reference: the canvas https://claude.ai/artifact/CgZ4aU5yGgELhv5QJAUX4a. Engine spec: `docs/superpowers/specs/2026-10-15-sdk-transfer-redesign-design.md`.

## Global Constraints

- Build the canvas as drawn, using Blok tokens/classes:
  - primary `#6E3FFF` = `bg-primary` / `text-primary-foreground`; page ground `#F6F6F8`
  - cards: white, 1px `border`, `rounded-xl`/14px; inputs/buttons: 10px radius, ≥44px touch targets
  - Geist (already loaded); mono paths in `font-mono`
  - light theme only
- UI only from `@/components/ui/*`; icons only via `Icon` + `@mdi/js`; no `lucide-react`.
- Every page works at phone width (rows wrap, tables scroll in an `overflow-x-auto` box). Long environment names and paths wrap or truncate with a `title`; they never overflow.
- Screens are in-app state. No new Next routes, no URL changes.
- Exact copy:
  - Home title: `What would you like to do?`
  - Action buttons: `Start a transfer`, `Create a package`, `Install a package`
  - Missing environment: `Missing an environment? Grant this app access to it in Cloud Portal, then reopen the app.`
  - One environment: `Grant this app access to another environment in Cloud Portal to transfer between environments.`
  - Route title: `Where is the content going?`; Content title: `What should be copied?`
  - Database helper: `Items are read from master on the source and written to this database on the target.`
  - Empty queue: `Pick items from the tree or paste a path.`
  - Review: `Ready to transfer` / `Nothing has been written yet. Check the route and items, then start.`
  - Tree warning: `1 item replaces everything below it on <target>.` / `<n> items replace everything below them on <target>.`
  - Production: `<target> looks like a production environment.` + checkbox `I understand this writes to <target>`
  - Cancel note: `Large trees can take a few minutes. You can cancel until the import into <target> starts; after that the target finishes on its own.`
  - Running titles: `Copying content to <target>` / `Packaging content from <source>` / `Installing package into <target>`
  - After the import starts: `The import can't be cancelled once it starts.`
  - Complete titles: `Transfer complete` / `Package ready` / `Package installed`; failed: `Transfer failed` / `Export failed` / `Install failed`
  - Panel note: `You'll confirm before anything is written.`
- Plain-language labels (spec table):

  | Value | Short (controls) | Long (review / tables) |
  |---|---|---|
  | `SingleItem` | `This item` | `This item only` |
  | `ItemAndDescendants` | `+ Everything below` | `Item + everything below` |
  | `OverrideExistingTree` | `Replace it and everything below` | same |
  | `OverrideExistingItem` | `Replace this item only` (Panel: `Replace this page only`) | same |
  | `KeepExistingItem` | `Keep what's there` | same |
  | `LatestWin` | `Keep the newer one` | same |
- v1 safety stays:
  - no double start
  - abort via `AbortController`, and on unmount
  - Cancel is hidden from the import step on, plus the engine's "may still finish importing" warning
  - the Panel holds the page path during review/run
  - export download revoke is deferred
  - one environment → transfer is blocked; export and install still work
- File deletions are done by the controller (approved by the user), never by implementers.
- Library tests start with `// @vitest-environment node`; component tests are jsdom; test output is pristine; `type="button"` on every non-submit button.

## Review Focus

1. **Long environment names** (e.g. `petsuppliesplus / devpetsuppliesplus-qa`) in cards, footers and the review banner must wrap or truncate with a `title`, never overflow. Test (Task 2): `EnvironmentCards` renders the full name with a matching `title` attribute.
2. **Changing the source after picking content:** the old queue may not exist on the new source. Expected: changing the source on Route clears the queue. Test (Task 6): `changing the source clears the queue`.
3. **Step bar during a run:** going back must be impossible. Test (Task 6): while running, done steps are not buttons.
4. **Selected environment disappears after a Retry** (env list changes): treat it as unselected, so Continue is disabled. Test (Task 6): `a vanished environment is unselected`.
5. **Double-clicking Start:** must start one run only. Test (Task 6): two clicks → one `createContentTransfer` call.

---

### Task 1: Library additions (environment identity, kinds, labels, run info, import step index)

**Files:**
- Modify: `src/lib/sdk.ts`, `src/lib/sdk.test.ts`, `src/lib/queue.ts`, `src/lib/queue.test.ts`, `src/lib/transfer.ts`, `src/lib/transfer.test.ts`
- Modify (keep suite green after the label change): `src/components/transfer/SelectionQueue.test.tsx`, `ImportPanel.test.tsx`, `Workspace.test.tsx`, plus any test asserting old labels (`grep -rn "Override tree\|Item & descendants\|Single item\|Override item\|Keep existing\|Latest wins" src`)

**Interfaces:**
- Produces from `@/lib/sdk`:
  - `type Env = { id: string; name: string; contextId: string; tenantName?: string }`
  - `toEnvs`: `id` = `tenantId`, falling back to the context ID; `tenantName` is copied
  - `type EnvKind = 'prod' | 'test' | 'dev'`
  - `envKind(env: Env): EnvKind | null`
- Produces from `@/lib/queue`:
  - `SCOPES: { value: Scope; label: string; long: string }[]`
  - `MERGES: { value: MergeStrategy; label: string; long: string }[]` (no `description`)
  - `labelOf(options: { value: string; label: string; long?: string }[], value: string, long?: boolean): string`
- Produces from `@/lib/transfer`:
  - `RunCallbacks.onInfo?(info: { chunkCount: number; itemCount: number }): void`
  - `IMPORT_STEP = { transfer: 4, import: 2 } as const`, used by the engine's `importAt` and later by the UI

- [ ] **Step 1: Write the failing tests.**
  - `toEnvs uses tenantId so environments sharing a resourceId stay distinct`: entries `{ resourceId: 'xmcloud', tenantId: 't1', tenantDisplayName: 'Acme / dev', tenantName: 'acme-dev', context: { preview: 'p1' } }` and the same with `t2`, `Acme / qa`, `acme-qa`, `p2` → ids `['t1', 't2']`, names unchanged, `tenantName` copied.
  - `toEnvs falls back to the context id without a tenantId`.
  - `envKind` table:
    - `Acme Production` → `prod`, `acme-prd` → `prod`, `Live site` → `prod`
    - `QA`, `uat`, `Staging` → `test`
    - `devpets`, `local` → `dev`
    - `Content hub` → `null`
    - checks `tenantName` when `name` has no match
    - `prod` wins over `dev` for `dev-to-prod`
  - `labelOf` returns the short label, the long label with `long=true`, and the value itself when unknown.
  - The `SCOPES`/`MERGES` labels equal the Global Constraints table, in the order `OverrideExistingTree`, `OverrideExistingItem`, `KeepExistingItem`, `LatestWin`.
  - `runTransfer` and `runExport` call `onInfo` once, after the package is ready, with summed `ChunkCount` and `TotalItemCount` (a missing `TotalItemCount` counts as 0), using two chunk sets.
  - `IMPORT_STEP` matches the step indexes: `TRANSFER_STEPS[4]` and `IMPORT_STEPS[2]` are `Import into database`.
- [ ] **Step 2: Run the tests to see them fail.** Run `npx vitest run src/lib`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Add `tenantId?: string` to the local `Resource` type.
  - Keep the duplicate-name disambiguation.
  - `envKind` tests `name`, then `tenantName`, against `/prod|prd|live/i` → `prod`, `/qa|test|uat|stag/i` → `test`, `/dev|local/i` → `dev`, in that order.
  - `runSteps` callers use `IMPORT_STEP`.
- [ ] **Step 4: Update the existing component tests** that assert the old labels to the new ones (Workspace's confirm text becomes `Merge: Replace it and everything below.`). Then run `npx tsc --noEmit && npm test`. Expected: all pass.
- [ ] **Step 5: Commit.**
```bash
git add src/lib src/components/transfer/*.test.tsx
git commit -m "feat: tenant-based environment ids, environment kinds, plain-language labels, run info"
```

---

### Task 2: Shell pieces (`Layout`, `Stepper`, `EnvironmentCards`, `Segmented`)

**Files:**
- Create: `src/components/transfer/Layout.tsx`, `Stepper.tsx`, `EnvironmentCards.tsx`, `Segmented.tsx`, and one test file `Shell.test.tsx` covering all four

**Interfaces:**
- Consumes: `Env`, `envKind` (Task 1)
- Produces:
  - `Layout.tsx`:
    - `AppHeader(props: { crumb?: string; envCount?: number; onHome(): void; onCancel?(): void })`: the logo button (aria-label `Home`, calls `onHome`), `Content Transfer`, optional `/ <crumb>`, an optional chip `<n> environments connected` (or `1 environment connected`), and an optional `Cancel` button.
    - `ActionBar(props: { summary: ReactNode; children: ReactNode })`: the sticky footer.
    - `PageHeading(props: { title: string; sub?: string })`.
  - `Stepper.tsx`: `Stepper(props: { steps: { label: string; hint: string }[]; current: number; locked?: boolean; onGo(i: number): void })`.
    - A step below `current` is a `button` showing a check, its label and its `hint`; clicking it calls `onGo(i)`. When `locked`, done steps render as plain items instead.
    - The `current` step has `aria-current="step"`. Steps after it are inert.
  - `EnvironmentCards.tsx`:
    - `EnvBadge(props: { env: Env })`: renders nothing for `null`; `prod` → `Production` (warning tones), `test` → `Test` (primary tones), `dev` → `Dev` (neutral).
    - `EnvironmentCards(props: { legend: string; name: string; envs: Env[]; value?: string; disabledId?: string; disabledReason?: string; onChange(id: string): void })`: a `fieldset` + `legend` of `label`-wrapped radio inputs. Each shows the name (with `title`), mono `tenantName`, and an `EnvBadge`. The disabled one shows `disabledReason` in place of `tenantName` and its input is disabled. The selected one is highlighted.
  - `Segmented.tsx`: `Segmented(props: { label: string; value: string; options: { value: string; label: string }[]; onChange(v: string): void; size?: 'sm' | 'md' })`, rendered as `role="radiogroup"` (aria-label `label`) of `button role="radio"` with `aria-checked`.

- [ ] **Step 1: Write the failing tests** (`Shell.test.tsx`).
  - `AppHeader`: `Home` calls `onHome`; the chip shows `3 environments connected` / `1 environment connected`; `Cancel` shows only when `onCancel` is given.
  - `Stepper`: a done step is a button that calls `onGo(0)`; when `locked`, no step button is rendered; the current step has `aria-current="step"`.
  - `EnvironmentCards`:
    - renders a radio per environment and calls `onChange(id)` when one is clicked
    - the `disabledId` radio is disabled and shows `disabledReason`
    - the long name `petsuppliesplus / devpetsuppliesplus-qa` is rendered in full with a matching `title`
    - badges show `Production` / `Test` / `Dev` / none
  - `Segmented`: has a radiogroup with `label`; clicking `web` calls `onChange('web')`; `aria-checked` follows `value`.
- [ ] **Step 2: Run the tests to see them fail.** Run `npx vitest run src/components/transfer/Shell.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** to match the canvas (Route artboard for the cards, the header and step bar on all flow artboards). Read the Blok `button`, `label` and `checkbox` sources for their APIs.
- [ ] **Step 4: Run the tests to see them pass.** Run `npx vitest run src/components/transfer/Shell.test.tsx && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit.**
```bash
git add src/components/transfer/{Layout,Stepper,EnvironmentCards,Segmented,Shell.test}.tsx
git commit -m "feat: app header, action bar, stepper, environment cards, segmented control"
```

---

### Task 3: Restyle `SelectionQueue`, `ContentTree` and `ImportPanel` to the canvas

**Files:**
- Modify: `src/components/transfer/SelectionQueue.tsx` + test, `ContentTree.tsx` + test, `ImportPanel.tsx` + test

**Interfaces:**
- Consumes: `Segmented` (Task 2); `SCOPES`, `MERGES`, `labelOf` (Task 1)
- Produces:
  - `SelectionQueue` (props unchanged: `{ trees; onChange; disabled? }`):
    - Header: `Selected` + count badge, `Import list` (JSON, same parsing and error), `Clear all`.
    - An add row: input aria-label `Add by path`, placeholder `/sitecore/content/…`, plus `Add`.
    - One card per tree: the name (last path segment), the mono path, `Segmented` (label `Include for <path>`, short scope labels), a `Select` (aria-label `If <path> exists`, short merge labels) captioned `If it exists`, and `Remove <path>`.
    - Empty text as in Global Constraints.
  - `ContentTree` gains an optional `title?: string` shown as the card heading (`Browse <env name>` is passed by the caller). The search placeholder is `Search loaded items` (the aria-label stays `Filter loaded items`). Selected rows get the primary-tint background.
  - `ImportPanel`:
    - `LoadedPackage` gains `size: number` (bytes).
    - UI: a drop zone (`Drop a .zip or .raif here, or browse`), then a file card once loaded (mono name, `<size> · <n> chunks · <m> media`, `Replace`), then `What's inside` with long labels, or `No metadata in this package.`
    - Errors as before.
- [ ] **Step 1: Update and add tests.** Keep each test's behaviour; switch queries to the new labels and aria-labels.
  - SelectionQueue: the scope segmented control calls `onChange` with `SingleItem`; picking `Keep the newer one` sets `LatestWin`.
  - ContentTree: shows `title`.
  - ImportPanel: the file card shows `2 chunks · 1 media` for a fixture package with a chunk map (one media chunk), and the size is formatted (e.g. `1.5 KB`).
- [ ] **Step 2: Run the tests to see them fail.** Run `npx vitest run src/components/transfer/{SelectionQueue,ContentTree,ImportPanel}.test.tsx`. Expected: FAIL on the new expectations.
- [ ] **Step 3: Implement** per the canvas Content and Install artboards. `formatBytes(n)` → `B`/`KB`/`MB` with one decimal, kept private in `ImportPanel.tsx`.
- [ ] **Step 4: Run the tests to see them pass.** Run `npx vitest run src/components/transfer && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit.**
```bash
git add src/components/transfer/{SelectionQueue,ContentTree,ImportPanel}*
git commit -m "feat: restyle selection queue, content tree and package panel to the new design"
```

---

### Task 4: `ReviewStep` and `ProdConfirm`

**Files:**
- Create: `src/components/transfer/ReviewStep.tsx`, `ReviewStep.test.tsx`

**Interfaces:**
- Consumes: `Env`, `envKind`, `labelOf`, `SCOPES`, `MERGES`, `DataTree`, `PageHeading`
- Produces:
  - `needsProdConfirm(target?: Env): boolean`: `envKind(target) === 'prod'`
  - `ProdConfirm(props: { target: Env; checked: boolean; onChange(v: boolean): void })`: a danger callout, `<target> looks like a production environment.`, with a checkbox labelled `I understand this writes to <target>`
  - `ReviewStep(props: { mode: 'transfer' | 'export'; source: Env; target?: Env; database: string; trees: DataTree[]; prodChecked: boolean; onProdChecked(v: boolean): void; onEdit(): void })`:
    - Heading: transfer `Ready to transfer` + its sub; export `Ready to export` + `Check the items, then create the package.`
    - A route banner (From → To with the database; export shows only From).
    - The tree warning when any `OverrideExistingTree` (transfer only).
    - `ProdConfirm` when `needsProdConfirm(target)` (transfer only).
    - An items table (Item = name + mono path, Includes, If it exists; long labels) in an `overflow-x-auto` box, with an `Edit` button calling `onEdit`.
    - The cancel note (transfer only).

- [ ] **Step 1: Write the failing tests.**
  - It shows both environment names and the database.
  - The table lists each path with long labels.
  - The `1 item replaces everything below it on QA.` / `2 items replace everything below them on QA.` strings.
  - No tree warning when there is no `OverrideExistingTree`.
  - A prod target shows the callout and checkbox, and ticking it calls `onProdChecked(true)`.
  - Export mode hides To, the warnings and the note.
  - `Edit` calls `onEdit`.
- [ ] **Step 2: Run the tests to see them fail.** Run `npx vitest run src/components/transfer/ReviewStep.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** per the canvas Review artboard.
- [ ] **Step 4: Run the tests to see them pass.** Same command, plus `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit.**
```bash
git add src/components/transfer/ReviewStep*
git commit -m "feat: review step with production confirmation"
```

---

### Task 5: `RunView` (running / complete / failed)

**Files:**
- Create: `src/components/transfer/RunView.tsx`, `RunView.test.tsx`

**Interfaces:**
- Consumes: `LogType`, `StepStatus`, `Env`, `ActionBar`, `PageHeading`, Blok `progress`/`collapsible`/`button`/`spinner`
- Produces:
  - `type LogLine = { text: string; type: LogType; time: string }` (moves here from RunPanel)
  - `type RunKind = 'transfer' | 'export' | 'install'`
  - `formatDuration(ms: number): string` → `45 s`, `3 min 20 s`, `1 h 2 min`
  - `RunView(props: { kind: RunKind; compact?: boolean; source?: Env; target?: Env; steps: { label: string; status: StepStatus; ms?: number }[]; progress: number; logs: LogLine[]; running: boolean; result: 'success' | 'fail' | null; tookMs?: number; info?: { chunkCount: number; itemCount: number }; onCancel?(): void; onAgain(): void; onHome(): void; onDownload?(): void })`

  Behaviour:
  - **Running:**
    - `In progress`, the running title (Global Constraints), and a large `<progress>%`.
    - A progressbar with aria values.
    - An `aria-live="polite"` line `<Verb> chunk N of M`, from the last log matching `/(\w+) chunk (\d+) \/ (\d+)/i`.
    - A step timeline: done steps show a check and `formatDuration(ms)`, the running one a spinner, failed an alert icon, pending an empty circle.
    - A dark activity log with `Copy log` (Copied / Copy failed feedback, the same logic as the old RunPanel).
    - Footer: `Cancel transfer` / `Cancel export` / `Cancel install` when `onCancel` is given. For transfer/install without `onCancel`, the text `The import can't be cancelled once it starts.`
  - **Complete** (`result === 'success'`):
    - The complete title and a summary line, both chosen by `kind`.
    - Stats Items / Chunks / Took (from `info` and `tookMs`; a stat without data is omitted).
    - Actions: transfer `Start another transfer`; export `Download package` (`onDownload`) + `Start another export`; install `Install another package`. All call `onAgain`, except Download. Plus `Back to home`.
    - The log in a collapsed `<details>` titled `Activity log`.
  - **Failed:** the failed title, the step list with the failing step, the log expanded, and `Try again` (`onAgain`) + `Back to home`.
  - **`compact`:** single column, no sticky footer (actions inline).

- [ ] **Step 1: Write the failing tests.**
  - `formatDuration` cases.
  - Running: shows the title per kind, `58%`, the progressbar `aria-valuenow`, and `Copying chunk 7 of 12` from logs ending `Copying chunk 7 / 12`; the `Cancel transfer` button calls `onCancel`; without `onCancel` (transfer) it shows the can't-cancel text.
  - Done step durations are shown.
  - Complete: titles per kind; stats `184`, `12`, `3 min 20 s`; export `Download package` calls `onDownload`; `Back to home` calls `onHome`.
  - Failed: `Transfer failed`, `Try again` calls `onAgain`, and the log is visible.
  - `Copy log` with `navigator.clipboard` undefined → `Copy failed`.
  - `compact` renders no element with `position: sticky` / no `ActionBar` (assert by the absence of the footer landmark).
- [ ] **Step 2: Run the tests to see them fail.** Run `npx vitest run src/components/transfer/RunView.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** per the canvas Running and Complete artboards.
- [ ] **Step 4: Run the tests to see them pass.** Same command, plus `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit.**
```bash
git add src/components/transfer/RunView*
git commit -m "feat: full-page run view with complete and failed states"
```

---

### Task 6: `Flow` (transfer and export)

**Files:**
- Create: `src/components/transfer/Flow.tsx`, `Flow.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–5, `ContentTree`, `SelectionQueue`, the engine (`runTransfer`, `runExport`, `TRANSFER_STEPS`, `EXPORT_STEPS`, `IMPORT_STEP`), `mergeTrees`/`newTree`
- Produces: `Flow(props: { client: SdkClient; mode: 'transfer' | 'export'; envs: Env[]; onHome(): void })`

  Behaviour:
  - **Steps** `[Route, Content, Review, Transfer|Export]` with hints:
    - Route: `<src> → <tgt> · <db>`, or for export `<src>`
    - Content: `<n> items`
    - Review: `Confirm what's written`
    - last step: `Live progress`
  - The `AppHeader` crumb is `New transfer` / `New export`, with `onCancel` = `onHome`, except while running.
  - **Route** (`EnvironmentCards` From/To + swap button aria-label `Swap source and target` + database `Segmented`; export: From only):
    - Defaults: From = `envs[0]`, To = `envs[1]`.
    - An id not in `envs` counts as unselected.
    - The source is disabled in To with `Already the source`, and the target is disabled in From with `Already the target`.
    - Changing the source clears the queue.
    - Continue is enabled when the route is valid.
  - **Content:**
    - `ContentTree` titled `Browse <source>`; ticking uses `mergeTrees`, unticking removes the item.
    - Then `SelectionQueue`.
    - Continue (`Review transfer` / `Review export`) needs ≥1 item.
  - **Review:** `ReviewStep`. Start (`Start transfer` / `Create package`) needs `!needsProdConfirm(target) || prodChecked`. A second click while starting is ignored.
  - **Run:** `RunView`.
    - Display step labels:
      - transfer: `Create job on <src>`, `Package content`, `Copy chunks to <tgt>`, `Assemble package on <tgt>`, `Import into <db>`, `Verify`
      - export: `Create job on <src>`, `Package content`, `Download & zip`
    - Step durations come from `onStepChange` timestamps; `tookMs` is measured from start to finish.
    - `info` comes from `onInfo`.
    - `onCancel` is offered until step `IMPORT_STEP.transfer` is running/done (transfer); export always while running.
    - Export success downloads the zip once automatically (`contentTransfer-<source name>-<YYYY-MM-DD>.zip`, revoke deferred 1000 ms) and keeps the Blob for `Download package`.
    - `onAgain`: success → back to Route with the route kept, queue cleared and prod check reset; failure → back to Review.
    - The step bar is `locked` while running.
    - Unmount aborts.

- [ ] **Step 1: Write the failing tests** (`fakeClient`; `TIMING.pollMs = 0`; transfer handlers modelled on `happyHandlers` in `src/lib/transfer.test.ts`):
  - **Route:**
    - The defaults are selected.
    - The source is disabled in To with `Already the source`.
    - Swap swaps.
    - `changing the source clears the queue` (go to Content, add a path, go back via the step bar, pick another source → the queue is empty on return).
    - `a vanished environment is unselected` (rerender with `envs` missing the chosen target → Continue disabled).
    - Export shows only From.
  - **Content:** Continue is disabled with 0 items and enabled after `Add by path`.
  - **Review → Run:**
    - Two quick clicks on `Start transfer` → exactly one `createContentTransfer` call.
    - While running, the step bar has no buttons.
    - `Complete` shows `Transfer complete` and the stats.
    - `Start another transfer` returns to Route with the queue empty.
  - **Prod:** with target `Acme Production`, `Start transfer` stays disabled until the checkbox is ticked.
  - **Failure** (status `Failed`) shows `Transfer failed`; `Try again` returns to Review.
  - **Export success** calls `URL.createObjectURL` once (stub it) and shows `Download package`, which triggers a second download.
- [ ] **Step 2: Run the tests to see them fail.** Run `npx vitest run src/components/transfer/Flow.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** per the canvas Route/Content/Review/Running/Complete artboards.
- [ ] **Step 4: Run the tests to see them pass.** Run `npx vitest run src/components/transfer && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit.**
```bash
git add src/components/transfer/Flow*
git commit -m "feat: guided transfer and export flow"
```

---

### Task 7: `InstallFlow`

**Files:**
- Create: `src/components/transfer/InstallFlow.tsx`, `InstallFlow.test.tsx`

**Interfaces:**
- Consumes: `ImportPanel`/`LoadedPackage` (Task 3), `EnvironmentCards`, `Segmented`, `ProdConfirm`/`needsProdConfirm`, `RunView`, `runImport`, `IMPORT_STEPS`, `IMPORT_STEP`
- Produces: `InstallFlow(props: { client: SdkClient; envs: Env[]; onHome(): void })`

  Behaviour:
  - One screen, with the crumb `Install a package`. Left: `ImportPanel`. Right: `EnvironmentCards` legend `Install into` (no default), plus the database `Segmented`.
  - `ProdConfirm` when needed. Footer `<n> items → <target> · <db>`. `Install package` needs a package, a target, and the prod check when needed.
  - Run: `RunView` kind `install`.
    - Labels: `Upload package`, `Assemble package on <tgt>`, `Import into <db>`, `Verify`.
    - `info` = `{ chunkCount: total chunks across parts, itemCount: pkg.items.length }`.
    - `onCancel` until `IMPORT_STEP.import` starts.
    - `onAgain` (success) resets to an empty screen; on failure it returns to the screen with the package kept.
  - Works with one environment.

- [ ] **Step 1: Write the failing tests.**
  - `Install package` is disabled until a package (legacy zip fixture built with JSZip) and a target are chosen.
  - A prod target requires the checkbox.
  - A run calls `saveChunk` on the chosen target's context id and reaches `Package installed`.
  - Works with a single environment.
- [ ] **Step 2: Run the tests to see them fail.** Run `npx vitest run src/components/transfer/InstallFlow.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** per the canvas Install artboard.
- [ ] **Step 4: Run the tests to see them pass.** Same command, plus `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit.**
```bash
git add src/components/transfer/InstallFlow*
git commit -m "feat: install a package screen"
```

---

### Task 8: `Home`, `App` and the full-screen pages

**Files:**
- Create: `src/components/transfer/Home.tsx`, `App.tsx`, `App.test.tsx`
- Modify: `src/app/fullscreen-extension/page.tsx` (keep the `NEXT_PUBLIC_SPIKE` branch), `src/app/standalone-extension/page.tsx`

**Interfaces:**
- Consumes: `useEnvironments`, `Flow`, `InstallFlow`, `AppHeader`, `EnvBadge`, `Skeleton`, `Alert`
- Produces:
  - `Home(props: { envs: Env[]; loading: boolean; error: string | null; onRetry(): void; onOpen(screen: 'transfer' | 'export' | 'install'): void })`:
    - The Home artboard.
    - With <2 environments, `Start a transfer` is disabled and the one-environment message is shown on that card.
    - Loading → skeletons.
    - Error → danger alert with the error and `Retry`.
  - `App(props: { client: SdkClient | null })`:
    - `screen` state: `'home' | 'transfer' | 'export' | 'install'`.
    - Renders `Home` (with `AppHeader` envCount), `Flow`, or `InstallFlow`. `onHome` returns to Home and drops the flow (remount).
    - `client === null` → Home loading.
  - Pages render `<App client={client} />` under the existing SDK-error alert.

- [ ] **Step 1: Write the failing tests** (`App.test.tsx`, `fakeClient` with `application.context`):
  - Home lists environment names with badges and the `<n> environments connected` chip.
  - `Start a transfer` opens Route (`Where is the content going?`); `Cancel` returns Home.
  - `Create a package` opens export Route (only From).
  - `Install a package` opens Install.
  - One environment → `Start a transfer` is disabled and the message is shown.
  - Context error → `Retry` reloads.
- [ ] **Step 2: Run the tests to see them fail.** Run `npx vitest run src/components/transfer/App.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** per the canvas Home artboard. Wire the two pages.
- [ ] **Step 4: Run the tests to see them pass.** Run `npx vitest run src/components/transfer && npx tsc --noEmit && npm run build`. Expected: PASS.
- [ ] **Step 5: Commit.**
```bash
git add src/components/transfer/{Home,App}* src/app/fullscreen-extension/page.tsx src/app/standalone-extension/page.tsx
git commit -m "feat: home screen and app shell for the full-screen extensions"
```

---

### Task 9: `PanelFlow` and the Pages context panel

**Files:**
- Create: `src/components/transfer/PanelFlow.tsx`, `PanelFlow.test.tsx`
- Modify: `src/app/pages-contextpanel-extension/page.tsx`

**Interfaces:**
- Consumes: `useEnvironments`, `Select`, `Checkbox`/switch, `ReviewStep` pieces (`ProdConfirm`, `needsProdConfirm`), `RunView` (`compact`), `runTransfer`, `labelOf`, `MERGES`
- Produces: `PanelFlow(props: { client: SdkClient | null; pageName?: string; pagePath?: string })`

  Behaviour (Panel artboard):
  - **Form:**
    - A header `Send this page`, then a current page card (name + mono path).
    - From and To selects, with no preselect.
    - An `Include subpages` switch: on = `ItemAndDescendants` (default), off = `SingleItem`.
    - An `If it already exists on <target>` select, defaulting to `OverrideExistingTree`, with the Panel label `Replace this page only` for `OverrideExistingItem`.
    - `Send to <target>` is disabled until both environments are picked, they differ, and there is a path. The note text sits under it.
    - With <2 environments, show the one-environment message.
    - Without a page, the text `Open a page in the Pages editor to send it.`
  - **Send** opens a compact inline review: route, item, tree warning, prod confirm, plus `Start` and `Back`.
  - **Start** runs `RunView` compact.
  - The page path is held while reviewing or running; the latest one applies after the run is closed (`Back to home` → the form).
  - Unmount aborts.

- [ ] **Step 1: Write the failing tests.**
  - The selects start empty and `Send to …` is disabled.
  - After picking both: the label is `Send to Acme · QA`.
  - The same environment twice stays disabled.
  - The switch maps to `SingleItem`.
  - Send → review shows the path; a prod target needs the checkbox.
  - Start runs (`createContentTransfer` body has the page path and scope) → `Transfer complete`.
  - Rerendering with a new `pagePath` during review keeps the original in the started run, and the form shows the new path after `Back to home`.
- [ ] **Step 2: Run the tests to see them fail.** Run `npx vitest run src/components/transfer/PanelFlow.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** per the canvas Panel artboard. The page passes `pageName`/`pagePath` from `pages.context`, and drops its own card and `Workspace`.
- [ ] **Step 4: Run the tests to see them pass.** Run `npx vitest run src/components/transfer && npx tsc --noEmit && npm run build`. Expected: PASS.
- [ ] **Step 5: Commit.**
```bash
git add src/components/transfer/PanelFlow* src/app/pages-contextpanel-extension/page.tsx
git commit -m "feat: compact send-this-page panel for the Pages editor"
```

---

### Task 10: Remove replaced code, README, visual check

**Files:**
- Delete (controller, user-approved): `src/components/transfer/{Workspace,EnvironmentBar,RunPanel}.tsx` + their `.test.tsx`, plus each of `src/components/ui/{tabs,sheet,alert-dialog}.tsx` that `grep -rn "components/ui/<name>" src` shows as unused
- Modify: `README.md` (implementer)

- [ ] **Step 1 (controller): confirm nothing imports the delete set.** Run `grep -rnE "transfer/(Workspace|EnvironmentBar|RunPanel)|ui/(tabs|sheet|alert-dialog)" src`. Expected: hits only inside the delete set.
- [ ] **Step 2 (controller): delete them.** `git rm` the delete set, then run `npm run build && npx tsc --noEmit && npm test`. Expected: all pass. Commit `refactor: remove the tabbed workspace and its run sheet`.
- [ ] **Step 3 (implementer): README.** Replace the "What it does" / usage text with the new flow: Home → Transfer (Route, Content, Review, live progress), Export, Install, and the Pages editor "Send this page" panel, plus the plain-language option names. Nothing else changes. Commit `docs: README for the guided flow`.
- [ ] **Step 4 (controller): visual check.** Run a temporary local preview page (untracked, deleted afterwards) rendering `App` and `PanelFlow` with a fake client. Click Home → Route → Content → Review → Running → Complete and compare against the canvas. File any mismatch as a fix task.
