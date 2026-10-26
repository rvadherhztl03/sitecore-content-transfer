# Sitecore Content Transfer Pro

A **Sitecore Marketplace app** for moving content between XM Cloud environments from inside the Sitecore UI. You pick environments by name; there are no client IDs, secrets or hosts to enter. Built with Next.js 15, the Sitecore Marketplace SDK and the Sitecore Blok design system.

---

## What it does

The app opens on **Home** ("What would you like to do?"): three actions, plus the environments the app can reach. Transfer needs at least two environments; export and install work with one.

| Action | What it does |
|---|---|
| **Transfer between environments** | Copies items from a source environment into a target environment's `master` database. |
| **Export a package** | Packages items from one environment into a `.zip` download. |
| **Install a package** | Installs a `.zip` or `.raif` package into an environment. |

Options are shown in plain language. Each item has what it includes, `This item` (`SingleItem`), `+ Children` (`ItemAndChildren`) or `+ Everything below` (`ItemAndDescendants`), and what happens if it already exists on the target:

| Option | Value |
|---|---|
| Replace it and everything below | `OverrideExistingTree` |
| Replace this item only | `OverrideExistingItem` |
| Keep what's there | `KeepExistingItem` |

These are the three strategies the Content Transfer API lists. `LatestWin` ("Keep the newer one") isn't offered: the SDK types it but the API doesn't support it. A JSON list that still names it is read as `Keep what's there`.

Sitecore's API has no item-and-children scope, so `+ Children` is expanded when the run starts: the item and each of its direct children (read from the source at that moment) are sent as single items, and a child you also queued on its own keeps its own settings. Nested items are left alone: `+ Children` offers `Replace it and its children`, which replaces the item and each child on its own but nothing below them. `Replace it and everything below` is only offered with `+ Everything below`; switching an item to `This item` or `+ Children` moves it to `Replace this item only` or `Replace it and its children`. Each child becomes its own package on the target, and an item with 1,000 or more children is refused (use `+ Everything below` instead).

### Transfer

1. **Route:** pick the environment to copy **From** and one or more to copy **To** (cards; the source can't also be a target, and with one target a swap button switches them). Items are read from `master` on the source and always written to `master` on each target.
2. **Content:** tick items in the source tree, add them by path, or import a JSON list. In a transfer, **Compare with** `<target>` (next to **Browse**, one per target) compares a section of both environments from a starting path: it walks both trees a level at a time and marks each item `New on` `<source>`, `Changed` (same ID, different `__Revision`; "newer on" whichever `__Updated` is later), `Different item` (same path, different ID), `Only on` `<target>` or `Same` (hidden until shown), up to 2,000 items, with **Stop**. Tick new and changed items (or **Select all new and changed**) and **Add N to the list**: changed items as `This item` / `Replace this item only`, new ones as `This item` / `Keep what's there`, and a new item picked with everything under it as one `+ Everything below` row. It compares the default language, item by item. **Show changes** on a `Changed` row reads the item on both environments and lists the fields whose values differ (default language, latest version; `__Revision`, `__Updated` and `__Updated by` are left out): **Show values** opens a field's full value on each side, and **Show all fields** adds the unchanged ones. New items start as `+ Everything below` and `Replace it and everything below`; change either per item.
3. **Review:** "Ready to transfer. Nothing has been written yet." It shows the route and every item, and warns when an item replaces everything below it on the target. If the target's name looks like production, you must tick `I understand this writes to <target>` before **Start transfer** is enabled. A **pre-flight check** then reads both environments (nothing is written) and adds an **On** `<target>` column: `New`, `Exists`, `Different item here`, `Parent missing`, `Different parent` or `Not on` `<source>`. Notes explain each problem: items the source doesn't have (**Remove from the list**), parents the target lacks, so the item would transfer but not appear in the content tree (**Add missing parents** adds them as `This item` / `Keep what's there` before the item), parents or items that are a different item (different ID) on the target, and, for `Replace it and everything below`, the target's direct children that would be deleted. The check never blocks **Start**; if it can't run, Review says so. It checks the items you picked and their parents, not every item below them. Rows that overwrite the same item on the target get **Show changes** (the same field diff as Compare). Alongside it, a **related-content scan** reads the picked items' fields and presentation (`__Renderings`, `__Final Renderings`) on the source for the items they use (datasources, media, links: item IDs in any form, and `/sitecore/content` or `/sitecore/media library` paths), keeps the content and media ones the list doesn't bring along, and checks the target for each. **Used by your items but not in the list** names those the target lacks (and who uses them), with **Add N missing items** (`This item` / `Keep what's there`); the ones the target already has are only counted. It scans the picked items themselves in the default language, not their descendants or what the added items use in turn; if it can't run, Review says so and the check still stands. A **template and rendering check** runs alongside it: it reads each picked item's template and the renderings and layouts in its presentation on the source, and looks each up on the target by ID. Any the target lacks are listed under **Missing on** `<target>`**: templates and renderings**, with the items that use them (they usually ship with a code deployment, so there's no Add button), and an item whose own template is missing shows `Template missing`. It also reads the picked items only; if it can't run, Review says so. Below it, **Back up** `<target>` **first** (on by default) exports what the transfer can overwrite on the target before anything is written: each item the target already has as the same item and that isn't `Keep what's there` (a `+ Everything below` item as its whole tree, which a restore puts back exactly). It runs as the first step, downloads `backup-<target>-YYYY-MM-DD-HHmm.zip`, and stops the transfer if it fails. The result screen offers **Download backup** and **Restore** `<target>`: after asking (with the production checkbox for a production target), Restore installs the backup straight back into the target as a new run ("Restoring <target>" → "Restore complete", **Try again** if it fails). A failed transfer offers Restore only once its import had started; before that the target wasn't written. You can also install the backup yourself with **Install a package**. **Publish to Experience Edge when done** (off by default) adds a last step that publishes what was transferred on the target, from `master` to `experienceedge`, in every language the target has (Sites API `listLanguages`), in `SMART` mode, without related items: `+ Everything below` items with their subitems, the rest one by one. It waits for each publish (`publishingStatus`). If publishing fails, the transfer still completes; the step is marked failed and the result screen says so, so you can publish from Pages instead. When a published transfer is restored, the restore publishes what it puts back too. With nothing on the target to overwrite, Review says so instead. With several targets, Review shows each on the route, an **On** `<target>` column and pre-flight notes per target (a fix such as **Add missing parents** changes the one list every target gets), a production checkbox per production target, and **Back up** and **Publish** apply to every target, each backed up for what it would lose.
4. **Live progress:** percentage, chunk counter, a step timeline with durations and an activity log. You can cancel until the import into the (first) target starts; after that the target finishes on its own and the app says so. With several targets every backup runs first (so nothing is written anywhere if one fails), the source packages once, and then each target copies, assembles, imports, verifies and, if chosen, publishes in turn, in the order picked with production targets last. A failure stops the run there: **Transfer failed** says which targets got the content, and **Try again** leaves those out.
5. **Complete:** a summary with items, chunks and time, then **Start another transfer** or **Back to home**. If a step fails, **Transfer failed** marks it and **Try again** returns to Review. With several backups each target gets its own **Download** `<target>` **backup** and **Restore** `<target>`, and a restore's result still offers the others.

### Export

The same steps, with **From** only (no target). Review ends in **Create package**; **Package ready** downloads `contentTransfer-<source>-<date>.zip` automatically, and **Download package** saves it again.

### Install a package

One screen: choose a `.zip` or `.raif` file, check **What's inside** (items, what each includes and its "if it exists" rule; a bare `.raif` has no list), pick the environment to **Install into** (always written to `master`), and confirm production if needed. **Install package** runs the same live progress, then **Package installed**.

### Pages editor: Send this page

In the Pages editor context panel, the current page is shown as a compact form: **From** and **To** (nothing preselected), an **Include** select (`This page only`, `This page + child pages` or `This page + all subpages`, the default) and **If it already exists on** `<target>` (the item-only option reads `Replace this page only`). **Send to** `<target>` opens an inline review with the same warnings, pre-flight check (including **Add missing parents**, listed under **Also sends**, and the template and rendering check), **Show changes** when the page will overwrite the same page there, the same backup and publish choices and production checkbox, then **Start** runs it in the panel. Content is written to `master`, and nothing is written before you confirm. The page you sent stays fixed until you close the review or run, even if you open another page meanwhile.

---

## Setup

1. Install the app in **Sitecore Cloud Portal**.
2. Grant it access to **every environment you want to transfer between**. The app can only list and call environments it has been granted.
3. Map the extension points to these routes:

| Extension point | Route |
|---|---|
| Fullscreen | `/fullscreen-extension` |
| Standalone | `/standalone-extension` |
| Pages context panel | `/pages-contextpanel-extension` |

The routes only work when opened by Sitecore through an extension point, not directly in a browser. See the [Sitecore Marketplace documentation](https://doc.sitecore.com/mp/en/developers/marketplace/introduction-to-sitecore-marketplace.html).

---

## Develop

```sh
npm install
npm run dev
npm test
```

---

## How it works

Everything runs in the browser through the Marketplace SDK: `xmc.contentTransfer.*` for the transfer pipeline and `xmc.authoring.graphql` for the content tree and item IDs. Each call carries the `sitecoreContextId` of the environment it targets, and the Sitecore host authenticates it. Environments come from the app's `resourceAccess`. There are no server routes, client IDs, secrets or hosts.

The pipelines live in `src/lib/transfer.ts`:

- **Transfer:** back up each target that needs it, create job on the source, wait for the package, then for each target in turn copy every chunk to it, assemble, import into `master`, verify (and publish), then clean up the source (a target that accepted an import is left alone: it finishes syncing the import in the background).
- **Export:** create job, wait for the package, download the chunks and zip them.
- **Import:** upload the package chunks, assemble, import into `master`, verify.

---

## Package format

A package is a `.zip` with three files:

| File | Content |
|---|---|
| `package-metadata.json` | `[{ ItemPath, ItemId, Scope, MergeStrategy }]`, one entry per queued item |
| `package.raif` | The transferred chunks, concatenated |
| `package-chunks.json` | `[{ chunkSet, index, isMedia, offset, length }]`, where each chunk sits inside `package.raif` |

Older zips without `package-chunks.json` still import: `package.raif` is uploaded in 1 MB slices. A bare `.raif` file imports the same way.

---

## Version 1 (classic)

The first version of the app still runs at **`/v1`**, unchanged: the credential-based dashboard (client ID, client secret and API host per environment, saved profiles, swap, demo mode) and its server routes under `/api/migrate/*`. Open it from **Open version 1 (classic)** at the bottom of Home; its **Back to version 2** link returns to the extension page you came from. It doesn't need the Marketplace SDK, so it also works in a normal browser tab, and you can register `/v1` as its own extension point in Cloud Portal.

- Its server routes need the app hosted with a Node server; on a static-only deployment the page loads but transfers can't run.
- Its styles (`src/app/v1/v1.css`) are scoped under `.v1-app`, so they don't touch version 2.
- It doesn't get version 2's checks, backup, restore, compare or publish.

## Limitations

- Same Sitecore Cloud organization only: the app sees only the environments it was granted.
- Light theme only.

---

## License

This project is licensed under the terms specified in the [LICENSE](LICENSE) file.

## Issues

If you encounter any issues or have suggestions for improvements, please open an issue on the [repository](https://github.com/rvadherhztl03/sitecore-content-transfer/issues).
