_SitecoreAI · Marketplace app · Version 2_

# Content Transfer v2: no credentials, and a safety net for every transfer

_What's new since the first version of my Content Transfer app, and how it helps the developers and content authors who move content between SitecoreAI environments._

By Ravi Vadher · [Publish date]

In July I shared the first version of my Content Transfer Marketplace app in [Beyond Package Designer: A Better Way to Transfer Content in Sitecore](https://ravivadher.tech.blog/2026/07/13/beyond-package-designer-a-better-way-to-transfer-content-in-sitecore/). Package Designer had just been removed from SitecoreAI, and the app put a dashboard on top of the Content Transfer and Item Transfer APIs so nobody had to drive them from Postman.

Using it on real projects, two things bothered me. Every environment needed a client ID, a client secret and an API host before you could do anything, which is fine for a developer and a non-starter for a content author. And the dashboard tried to show everything at once, so it was easy to miss what a transfer was actually about to do.

Version 2 is a rebuild around those two problems, plus a few things I kept wishing the first version had: a way to compare environments, checks before anything is written, and an undo button. Here's what changed.

## What's new at a glance

| Area | Version 1 | Version 2 |
| --- | --- | --- |
| Connecting | Client ID, client secret and API host per environment, with saved profiles | No credentials: the environments the app is granted in Cloud Portal |
| Interface | One dashboard | Guided steps (Route, Content, Review, Run) with plain-language options |
| Scopes | This item, item and everything below | Adds **+ Children** |
| Picking content | Tree, paths, JSON list | Same, plus **Compare environments** |
| Before writing | A confirmation | **Pre-flight check** and **related-content scan** |
| Safety | None | **Backup** before overwriting, and one-click **Restore** |
| Publishing | Not included | Optional **publish to Experience Edge** |
| Pages editor | The dashboard, with the page path filled in | A full **Send this page** flow in the panel |
| Packages | Export and import | Export and install, unchanged in spirit |
| Demo mode | Simulated runs without credentials | Removed: there are no credentials to avoid any more |

> **[Screenshot 1]** Before and after: the version 1 dashboard with its credential fields, next to the version 2 Home screen.
>
> _Caption: Same job, very different first impression._

## [Improved] No client IDs, no secrets

Version 1 signed in to each environment with an automation client, server-side. Version 2 drops all of that. It talks to your environments through the Marketplace SDK, and Sitecore makes each call on behalf of the person who is signed in, so there is nothing to paste and nothing to store. Connection profiles, the swap-credentials button and the server routes are gone.

- The environments you see are the ones your organization has granted the app in Cloud Portal. If one is missing, grant the app access to it there and reopen the app.
- Each environment shows its real name, with a small badge such as **Prod**, **QA** or **Dev** worked out from that name. Production gets a warning colour, because it deserves one.
- Transfers work between environments in the same organization. That covers the usual dev → QA → production path.

> **[Screenshot 2]** Home screen: the three actions (Transfer between environments, Export a package, Install a package) and the list of environments the app can reach, with their badges.
>
> _Caption: Everything starts here, and there's no login form in sight._

## [Redesigned] A guided flow instead of one busy screen

The version 1 dashboard put every setting on one screen. Version 2 walks you through four steps: **Route**, **Content**, **Review** and **Run**. Each step says what it is about to do in plain words, and nothing is written to any environment until you press **Start**.

> **[Screenshot 3]** Route step: the From and To environment cards, with the source greyed out in the To list ("Already the source").
>
> _Caption: Pick where content comes from and where it goes. You can't pick the same environment twice._

## [Improved] Choosing what to move

As in version 1, you can tick items in the source tree, paste a path, or import a JSON list. What's new is how much clearer each item's two choices are.

### What it includes

- **This item**: just the item.
- **+ Children** (new): the item and its direct children, nothing deeper. Sitecore's API only knows "this item" and "item and everything below", so the app reads the children itself when the run starts and sends each one as a single item. Developers asked for this one; it's handy when you want a folder and its pages without the whole tree under them.
- **+ Everything below**: the item and its whole tree.

### What happens if it already exists

The options now follow the scope, so you can't pick one that makes no sense. **Replace it and everything below** only appears with + Everything below, because it deletes the target's tree before writing. With + Children you get **Replace it and its children**, which overwrites the item and each child and leaves anything deeper alone.

Like the later builds of version 1, version 2 doesn't offer "latest wins": the SDK lists it, but Sitecore's Content Transfer API spec doesn't. New in version 2, a saved JSON list that still asks for it is read as **Keep what's there**, the option that never overwrites anything.

> **[Screenshot 4]** Content step: the source tree on the left and the Selected list on the right, with one item set to "+ Children" and its "If it exists" dropdown open.
>
> _Caption: Scope and overwrite rules sit right next to each item._

## [New] Compare before you pick

Ticking items in a tree is fine when you know exactly what changed. Often you don't. Next to **Browse** there is now a **Compare** tab. Give it a starting path and it walks that part of both environments and marks every item:

- **New**: only on the source.
- **Changed**: the same item on both, with a different revision, plus which side was updated last.
- **Different item**: the same path, but a different item ID. Copying would create a second item with the same name.
- **Only on the target**: for information. A transfer won't delete it, but replacing a parent's whole tree would.
- **Same**: hidden until you ask for it.

Tick what you want, or use **Select all new and changed**, and add them to the list. If you pick a brand-new branch together with everything under it, the app adds it as a single "+ Everything below" row instead of dozens of separate ones.

> **[Screenshot 5]** Compare tab: the filter chips with counts (New, Changed, Different item, Only on target, Same) and the nested list with some new and changed items ticked.
>
> _Caption: A quick answer to "what's actually different between Dev and QA?"_

## [New] A review step that actually checks things

In version 1, the last step before a transfer was a confirmation. Review now reads both environments before anything is written and tells you about problems while they are still easy to fix.

- **Missing parents.** Sitecore's docs warn that if the parent chain isn't on the target with the same IDs, the item "will transfer successfully but will not appear in the content tree". Review lists the missing parents, and **Add missing parents** puts them in the list before the item.
- **A different item at the same path.** You'd end up with two items with the same name, the kind of duplicate that breaks serialization later.
- **Paths the source doesn't have.** Usually a typo. **Remove from the list** fixes it.
- **What gets deleted.** For "Replace it and everything below", Review names the target-only pages that will disappear, so the warning is no longer abstract.

The items table also shows each item's state on the target: New, Exists, Parent missing and so on. None of this blocks **Start**. It's information, not a gate.

> **[Screenshot 6]** Review step: the pre-flight notes (missing parents with the Add missing parents button, and the deletion list) above the items table with its "On QA" column.
>
> _Caption: Problems show up here, before anything is written._

### It also notices what your page depends on

A page rarely travels alone. Its components point at datasource items, images and linked content, and those often live outside the page's own folder. Review reads the picked items' fields and presentation on the source, finds the content and media they use, and checks whether the target has them. Anything missing appears under **Used by your items but not in the list**, along with which page uses it, and one click adds it.

> **[Screenshot 7]** Review step: the "Used by your items but not in the list" note, listing a shared datasource and an image with "used by Home", and the "Add 2 missing items" button.
>
> _Caption: No more pages that arrive with empty components._

## [New] A backup, and an undo button

This is the part I'm happiest about, and the one version 1 was missing most. Before a transfer overwrites anything, the app can back up what's about to change on the target. The option is on by default.

- The backup runs as the first step. It exports exactly what the transfer can overwrite and downloads it as a zip.
- If the backup fails, the transfer stops before anything is written.
- When the run ends, **Restore** puts the target back from that backup in one click. It asks first, and on a production target it also needs the "I understand this writes to Production" checkbox.
- If a transfer fails halfway through its import, Restore is offered there too. That's the moment you need it most.

> **[Screenshot 8]** Review step: the "Back up QA first" and "Publish to Experience Edge when done" checkboxes, with the production confirmation below.
>
> _Caption: Backup on by default; publishing is your call._

> **[Screenshot 9]** Run screen in progress: the progress bar, the step list starting with "Back up QA", and the activity log.
>
> _Caption: Every step is visible, with a log you can copy._

> **[Screenshot 10]** Transfer complete: the summary, the Items, Chunks and Took stats, and the Download backup and Restore buttons.
>
> _Caption: Done, with the way back right there._

> **[Screenshot 11]** The inline restore question: "Restore QA to how it was before this transfer?" with Restore now and Keep as is.
>
> _Caption: Restore always asks first._

## [New] Publishing to Experience Edge

Transferred content lands in the target's master database. If you want it live straight away, tick **Publish to Experience Edge when done**. The last step then publishes what was transferred, in every language the target has, sending only items that changed. It doesn't publish related items, so a page publish never quietly pushes out shared content you didn't pick. It's off by default, because going live should be a choice.

If publishing fails, the transfer still counts as done, since the content is safely on the target, and the result screen tells you to publish from Pages instead. Restoring a published transfer republishes what it puts back, so the live site goes back too.

## [Improved] Send a page straight from the Pages editor

In version 1, the Pages editor panel showed the same dashboard with the current page's path filled in. Version 2 gives content authors a form made for one page. In the context panel there's a compact **Send this page** form: pick From and To, choose **This page only**, **This page + child pages** or **This page + all subpages**, and press Send. The same checks, backup and publish options appear in a short review before anything is written.

> **[Screenshot 12]** Pages editor with the Content Transfer context panel open: the current page card, From, To, Include and "If it already exists" fields, and the Send button.
>
> _Caption: Moving one page without leaving the editor._

## [Kept] Export and install packages

This part works much as it did in version 1. Sometimes you want a file rather than a direct copy. **Export a package** builds a zip of the items you pick, and **Install a package** puts a zip back into an environment, with a preview of what's inside. The backup zips use the same format, so you can also restore one by hand.

> **[Screenshot 13]** Install a package: the drop zone, the selected file card and the "What's inside" table.
>
> _Caption: Packages are still there when you need a file._

## For developers: what I learned from the APIs

Moving from server-side calls to the Marketplace SDK meant rewriting the transfer engine, and a few things weren't obvious from the documentation. Each one cost me a debugging session; if you're scripting these APIs yourself, they might save you one.

- **ConsumeFile and GetBlobState want the file name differently.** ConsumeFile needs `blob://<name>`; GetBlobState wants the plain name. Mix them up and you get a 400 on one side and `BlobNotFound` on the other.
- **Read `BlobState`, not `status`.** The SDK's types say `status`; the API actually returns `BlobState`.
- **"Consumed" doesn't mean finished.** Imported items are usable straight away while the target finishes syncing them into the database in the background.
- **Don't delete the transfer on the target too early.** Deleting the content transfer is meant for the source. I was also deleting it on the target, and larger "item and everything below" transfers reported success but never appeared, because the package they were still syncing from was gone. Single items synced fast enough to hide the bug.
- **There are only two scopes.** No "item and children" in the API, and no `LatestWin` merge strategy in the spec.
- **Parent IDs matter.** Same path isn't enough; the parent chain has to exist with the same IDs.
- **Watch your SDK version.** `^0.2.0` never picks up 0.3 or 0.4, because a caret on a 0.x version doesn't move the minor version. Version 0.4 is where the Pages, Sites and Agent APIs arrived.

## Upgrading from version 1

- **Grant environment access.** In Cloud Portal, give the app access to each environment you want to transfer between. That replaces entering credentials.
- **Clean up old credentials.** Version 1 kept connection profiles in your browser's storage. Version 2 never reads them, so it's worth removing them, and deleting or rotating the automation clients you created for version 1 if nothing else uses them.
- **Saved JSON lists still work.** Lists from version 1 import as before.

## Who this helps, and how

### Content authors

- No credentials or host names to deal with.
- Send a page from the Pages editor in a few clicks.
- Plain-language options instead of API enum names.
- Warnings about missing parents and missing related content before anything moves.
- A backup and a Restore button if something looks wrong afterwards.

### Developers

- Compare environments and pick only what's new or changed.
- + Children for folders without their deep trees.
- Pre-flight checks that catch duplicate paths and parent-ID problems early.
- A clear step list and a copyable activity log for every run.
- Optional publish to Experience Edge, and packages when you need a file.

## What it doesn't do yet

I'd rather say this up front than have you find out mid-transfer.

- Compare and the related-content scan look at the default language only.
- The checks cover the items you pick, not every item below them.
- Compare stops at 2,000 items per run and compares item by item, without a field-level diff.
- Publishing targets Experience Edge only.
- A restore puts back what was backed up. New items the transfer created outside a backed-up tree stay where they are.

## Try it and tell me what breaks

Version 1 was about getting off Postman. Version 2 is about making each transfer something you can check before it happens and undo after it happens. Sitecore has said its own content migration app is on the way; until it arrives, and probably after, I hope this makes moving content a little calmer. If you try it, I'd love to hear what works, what doesn't, and what you'd want next.

[Link to the app or repository] · [How to reach you: LinkedIn, Sitecore Slack, email]
