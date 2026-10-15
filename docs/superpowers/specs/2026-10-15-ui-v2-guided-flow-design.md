# UI v2: guided flow

Date: 2026-10-15 · Branch: `feat/sdk-transfer-redesign` · Builds on `2026-10-15-sdk-transfer-redesign-design.md` (engine, SDK and package format unchanged)

## Goal

Replace the single tabbed workspace with a guided, plain-language flow that feels smooth for occasional users and stays quick for repeat use. The approved visual design is the canvas **Content Transfer redesign** (https://claude.ai/artifact/CgZ4aU5yGgELhv5QJAUX4a): Home, Route, Content, Review, Running, Complete, Install a package, and the Pages editor panel. Build it as drawn, with Blok components and tokens (primary `#6E3FFF`, 10 px radius, Geist), light theme.

Success: in XM Cloud a user goes Home → Start a transfer → picks two environments by card → ticks items → reviews a summary that says exactly what will be written → watches progress → sees a completion summary, without meeting any Sitecore enum name.

## Bug fix carried in

`toEnvs` uses `resourceId` as `Env.id`. In XM Cloud every entry shares the same `resourceId` (the product), so source and target collapse into one environment ("Source and target must be different environments." with two different names shown). `Env.id` becomes `tenantId`, falling back to the context ID. Add a test where two entries share a `resourceId`.

## Navigation

The extension routes stay as they are (`/fullscreen-extension`, `/standalone-extension`, `/pages-contextpanel-extension`). Screens are in-app state inside the top-level component: no new Next routes and no URL changes (the app runs in an iframe).

```
home ─▶ transfer: route ▸ content ▸ review ▸ run (running → complete | failed)
     ─▶ export:   route(source only) ▸ content ▸ review ▸ run (→ download)
     ─▶ install:  package+target ▸ run
```

- A step bar shows the four steps. Finished steps show what was chosen (e.g. `Dev → QA · master`, `2 items`) and are clickable to go back. Future steps are inert.
- Every screen except Running has Cancel (to Home) in the header. A sticky footer carries the route summary on the left, and Back + the primary action on the right.
- Leaving a flow and returning to Home resets that flow's state.

## Screens

**Home**
- Three action cards:
  - **Transfer between environments**: primary, opens transfer at Route
  - **Export a package**: opens export at Route
  - **Install a package**: opens install
- **Environments this app can reach**: name, `tenantName` in mono, kind badge, plus the footer "Missing an environment? Grant this app access to it in Cloud Portal, then reopen the app."
- "How a transfer works": 4 static lines.
- Header chip: `<n> environments connected`. Loading → skeleton. Context error → danger alert + Retry.
- With fewer than 2 environments, the Transfer card's button is disabled and shows the one-environment message.

**Route**
- Two radio-card groups, **From** and **To**, with a round swap button between them.
- The current source is disabled in **To**, labelled "Already the source", and vice versa. So the same environment can't be picked twice.
- Database is a segmented control (`master` / `web`), with the helper "Items are read from master on the source and written to this database on the target."
- Export shows only **From** and no database.
- Continue is enabled when the route is valid.
- Defaults: From = first environment, To = second.

**Content**
- Left: the existing lazy tree (`ContentTree`), titled "Browse <source>", with search.
- Right: **Selected** cards. Each shows the item name and mono path, a segmented scope control (`This item` / `+ Everything below`), an "If it exists" select with plain-language labels, and Remove.
- Header actions: Add by path, Import list (JSON), Clear all. Empty state: `Pick items from the tree or paste a path.`
- Continue (label "Review transfer" / "Review export") needs ≥1 item.

**Review**
- Title "Ready to transfer". Sub: "Nothing has been written yet. Check the route and items, then start."
- Route banner: From card → To card with the database.
- Warning callouts, built from the queue and target:
  - Any `OverrideExistingTree` → "<n> item(s) replace everything below them on <target>."
  - Target kind Production → a danger callout, plus the required checkbox "I understand this writes to <target>". Start stays disabled until it is ticked.
- Items table: Item (name + mono path), Includes, If it exists, plus an Edit link back to Content.
- Note: "Large trees can take a few minutes. You can cancel until the import into <target> starts; after that the target finishes on its own."
- Primary: **Start transfer** (export: **Create package**). This screen replaces the old confirm dialog.

**Running**
- Header line "In progress", title "Copying content to <target>" (export: "Packaging content from <source>"; install: "Installing package into <target>").
- Large percentage with a progress bar, then "Copying chunk N of M" (from the existing chunk log pattern).
- A step timeline with a duration per finished step, measured in the UI from `onStepChange`.
- A dark activity log with a Copy log button (existing behaviour).
- Footer: **Cancel transfer** until the import step starts, then the text "The import can't be cancelled once it starts." There's no dismiss while running.

**Complete**
- Success icon, "Transfer complete" (export: "Package ready"; install: "Package installed").
- One-line summary, and stats: Items (sum of `TotalItemCount`), Chunks, Took.
- Actions: **Start another transfer** (back to Route with the route kept and the queue cleared) and **Back to home**.
- Export also gets **Download package** (the Blob is kept until leaving; download is also triggered automatically once).
- The activity log sits in a collapsed `<details>`.

**Failed**: the Running layout with a danger header ("Transfer failed"), the failing step marked, the log expanded, and actions **Try again** (back to Review) and **Back to home**.

**Install a package**
- One screen: drop zone; selected file card (name, size, chunk count, media count, Replace); "What's inside" read-only table, or "No metadata in this package."; **Install into** radio cards with kind badges; database segmented control.
- Production target → the same required checkbox as Review.
- Footer: `<n> items → <target> · <db>`. **Install package** goes to Running.

**Pages editor panel (compact)**
- A single narrow column: Current page card (name + mono path), From select, To select (no preselect), an **Include subpages** switch (scope), an "If it already exists on <target>" select, and a primary **Send to <target>** button.
- Below the button: "You'll confirm before anything is written."
- Send shows a compact inline Review (route, item, warnings, prod checkbox, Start), then inline Running and Complete.

## Plain-language labels (`src/lib/queue.ts`)

| Value | Short (controls) | Long (review / tables) |
|---|---|---|
| `SingleItem` | This item | This item only |
| `ItemAndDescendants` | + Everything below | Item + everything below |
| `OverrideExistingTree` | Replace it and everything below | same |
| `OverrideExistingItem` | Replace this item only | same |
| `KeepExistingItem` | Keep what's there | same |
| `LatestWin` | Keep the newer one | same |

The Panel uses "Replace this page only" for `OverrideExistingItem`.

## Environment kind (`src/lib/sdk.ts`)

`envKind(env): 'prod' | 'test' | 'dev' | null`, checked in this order against `name` and `tenantName`:
- `/prod|prd|live/i` → `prod` (badge "Production", warning tone)
- `/qa|test|uat|stag/i` → `test` (badge "Test", primary tone)
- `/dev|local/i` → `dev` (badge "Dev", neutral)
- otherwise no badge

This replaces the `/prod/i` check in Workspace. `Env` gains an optional `tenantName` for display.

## Engine additions (`src/lib/transfer.ts`)

`RunCallbacks` gains an optional `onInfo?(info: { chunkCount: number; itemCount: number })`, called once after the package is ready (sums over chunk sets; `TotalItemCount` may be missing → 0). Nothing else in the engine changes.

## Component structure

| New / changed | Replaces / notes |
|---|---|
| `transfer/App.tsx`: screen state (home / flow / install), environments, top-level shell | `Workspace.tsx` (deleted); extension pages render `<App …/>` |
| `transfer/AppHeader.tsx`: logo, title, breadcrumb, connection chip, Cancel slot | — |
| `transfer/Home.tsx` | Tabs |
| `transfer/Stepper.tsx`: step bar with done/current/pending, back-links | — |
| `transfer/EnvironmentCards.tsx`: radio-card group with kind badge and disabled reason | `EnvironmentBar.tsx` (deleted) |
| `transfer/Flow.tsx`: transfer/export steps, owns route, queue and run state | the transfer/export half of `Workspace.tsx` |
| `transfer/ContentStep.tsx`: tree + selected cards (uses `ContentTree`, restyled `SelectionQueue`) | — |
| `transfer/ReviewStep.tsx` | the AlertDialog confirm |
| `transfer/RunView.tsx`: running / complete / failed, full page or compact | `RunPanel.tsx` + Sheet (deleted) |
| `transfer/InstallFlow.tsx`: uses `ImportPanel` pieces | import tab |
| `transfer/PanelFlow.tsx`: compact form → inline review → inline run | compact Workspace |
| `ContentTree.tsx`, `SelectionQueue.tsx`, `ImportPanel.tsx` | kept, restyled to the canvas |

Kept unchanged: `src/lib/{sdk,transfer,package}.ts` (except the two additions above), `useEnvironments`, `useMarketplaceClient`, `Spike.tsx` (still pending the user's XM Cloud run).

**Files to delete** (needs the user's OK, which the controller asks for with this spec): `Workspace.tsx` + test, `EnvironmentBar.tsx` + test, `RunPanel.tsx` + test, plus any `src/components/ui/*` left unused at the end (likely `tabs`, `sheet`, `alert-dialog`).

## Behaviour carried over (must not regress)

All the safety behaviour from v1:
- The queue and page path are held during review and run.
- A run can't be started twice.
- Cancel ends at the import step, followed by the "may still finish importing" warning.
- Abort via `AbortController`.
- The export download revoke is deferred.
- One environment → transfer is blocked, while export and install still work.
- Exact copy strings from the v1 Global Constraints, except where this spec renames them:
  - the confirm dialog text is replaced by Review
  - the prod warning becomes the Review/Install callout plus checkbox

## Testing

- **Unit:** `toEnvs` id = `tenantId` (two entries share a `resourceId`); `envKind` table; label maps; `onInfo` called with summed counts.
- **Component** (jsdom, `fakeClient`):
  - Home lists environments, and its actions open the right flows.
  - Route disables the source in To, Swap swaps, Continue gating works.
  - Content gating.
  - Review shows the items, the OverrideExistingTree callout, and a prod checkbox that gates Start.
  - Running → Complete shows the stats.
  - Failure shows Try again.
  - Export Complete has Download package.
  - Install requires file + target, with the prod checkbox.
  - The Panel has no preselect, and Send → inline review → run.
  - The page path is held during review/run.
- **Visual:** a local preview of each screen against the canvas, checked once by the controller.

## Out of scope

Run history across sessions; dark theme; host-environment detection for the Pages panel (pending Phase 0 `host.state`); "skipped items" analysis.

## Amendments (user feedback, 2026-10-15)

- **Environment badges show the environment's own type.** The badge reads `Prod`, `Live`, `Staging`, `UAT`, `QA`, `Test`, `Dev` or `Local` (`envLabel`: the first pattern in that order matching the name or tenant name; no badge when none matches) instead of the `Production` / `Test` / `Dev` category. Production environments keep the warning tone, every other badge is neutral. `envKind` is unchanged and still gates the production checkbox.
- **The write database is always `master`.** The "Write into database" card on Route and the Database control on Install are removed; every transfer, install and panel send imports into `master` (`DATABASE` in `src/lib/transfer.ts`). Review still shows `writes to master`. Earlier sections that mention a `master` / `web` choice are superseded.
- **`+ Children` scope (`ItemAndChildren`).** A third scope between `This item` and `+ Everything below` (long label `Item + its children`), in the Content step's scope control, Review, the Install preview and JSON queue import. The Content Transfer API has no such scope, so `expandTrees` (`src/lib/transfer.ts`) replaces the row when a transfer or export starts with the item and each direct child (via `fetchChildren` on the source) as `SingleItem` rows with the row's merge strategy; a child that the queue lists on its own keeps that row; 1,000 or more children stops the run before the job is created. Export metadata keeps the row as chosen. `Replace it and everything below` isn't offered for `+ Children` (`mergesFor`), and switching to it moves the merge to `Replace this item only` (`withScope`). The Pages panel's `Include subpages` switch becomes an **Include** select: `This page only`, `This page + child pages`, `This page + all subpages` (default).
- **Replace options follow the scope** (`mergesFor`). `Replace it and everything below` is only offered with `+ Everything below`. `This item` offers `Replace this item only`; `+ Children` offers `Replace it and its children` (Pages panel: `Replace it and its child pages`), which is `OverrideExistingItem` on the item and each child, never anything deeper (`expandTrees` also turns an `OverrideExistingTree` row into `OverrideExistingItem`). Switching scope moves an unavailable strategy to `OverrideExistingItem` (`withScope`), and JSON import does the same.
