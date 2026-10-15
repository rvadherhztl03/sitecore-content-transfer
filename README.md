# Sitecore Content Transfer Pro

A **Sitecore Marketplace app** for moving content between XM Cloud environments from inside the Sitecore UI. You pick environments from dropdowns; there are no client IDs, secrets or hosts to enter. Built with Next.js 15, the Sitecore Marketplace SDK and the Sitecore Blok design system.

---

## What it does

| Workflow | Description |
|---|---|
| **Transfer between environments** | Copies the queued items from a source environment to a target environment, then imports them into the target database (`master` or `web`). |
| **Export package** | Exports the queued items from the source environment into a downloadable `.zip` package. |
| **Import package** | Imports a `.zip` or `.raif` package into a target environment. The package contents are shown before you start. |

Build the queue by ticking items in the source content tree or by pasting a path. Each queued item has a scope (`SingleItem` or `ItemAndDescendants`) and a merge strategy (`OverrideExistingItem`, `KeepExistingItem`, `LatestWin` or `OverrideExistingTree`). The Pages context panel pre-fills the queue with the page you are editing.

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

- **Transfer:** create job on the source, wait for the package, copy every chunk to the target, assemble, import into the database, verify, then clean up both sides.
- **Export:** create job, wait for the package, download the chunks and zip them.
- **Import:** upload the package chunks, assemble, import into the database, verify.

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
