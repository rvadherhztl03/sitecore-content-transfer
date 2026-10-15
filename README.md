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

1. **Route:** pick the environment to copy **From** and the one to copy **To** (cards, with a swap button; the source can't also be the target). Items are read from `master` on the source and always written to `master` on the target.
2. **Content:** tick items in the source tree, add them by path, or import a JSON list. New items start as `+ Everything below` and `Replace it and everything below`; change either per item.
3. **Review:** "Ready to transfer. Nothing has been written yet." It shows the route and every item, and warns when an item replaces everything below it on the target. If the target's name looks like production, you must tick `I understand this writes to <target>` before **Start transfer** is enabled. A **pre-flight check** then reads both environments (nothing is written) and adds an **On** `<target>` column: `New`, `Exists`, `Different item here`, `Parent missing`, `Different parent` or `Not on` `<source>`. Notes explain each problem: items the source doesn't have (**Remove from the list**), parents the target lacks, so the item would transfer but not appear in the content tree (**Add missing parents** adds them as `This item` / `Keep what's there` before the item), parents or items that are a different item (different ID) on the target, and, for `Replace it and everything below`, the target's direct children that would be deleted. The check never blocks **Start**; if it can't run, Review says so. It checks the items you picked and their parents, not every item below them.
4. **Live progress:** percentage, chunk counter, a step timeline with durations and an activity log. You can cancel until the import into the target starts; after that the target finishes on its own and the app says so.
5. **Complete:** a summary with items, chunks and time, then **Start another transfer** or **Back to home**. If a step fails, **Transfer failed** marks it and **Try again** returns to Review.

### Export

The same steps, with **From** only (no target). Review ends in **Create package**; **Package ready** downloads `contentTransfer-<source>-<date>.zip` automatically, and **Download package** saves it again.

### Install a package

One screen: choose a `.zip` or `.raif` file, check **What's inside** (items, what each includes and its "if it exists" rule; a bare `.raif` has no list), pick the environment to **Install into** (always written to `master`), and confirm production if needed. **Install package** runs the same live progress, then **Package installed**.

### Pages editor: Send this page

In the Pages editor context panel, the current page is shown as a compact form: **From** and **To** (nothing preselected), an **Include** select (`This page only`, `This page + child pages` or `This page + all subpages`, the default) and **If it already exists on** `<target>` (the item-only option reads `Replace this page only`). **Send to** `<target>` opens an inline review with the same warnings, pre-flight check (including **Add missing parents**, listed under **Also sends**) and production checkbox, then **Start** runs it in the panel. Content is written to `master`, and nothing is written before you confirm. The page you sent stays fixed until you close the review or run, even if you open another page meanwhile.

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

- **Transfer:** create job on the source, wait for the package, copy every chunk to the target, assemble, import into `master`, verify, then clean up the source (the target is left alone: it finishes syncing the import in the background).
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

## Limitations

- Same Sitecore Cloud organization only: the app sees only the environments it was granted.
- Light theme only.

---

## License

This project is licensed under the terms specified in the [LICENSE](LICENSE) file.

## Issues

If you encounter any issues or have suggestions for improvements, please open an issue on the [repository](https://github.com/rvadherhztl03/sitecore-content-transfer/issues).
