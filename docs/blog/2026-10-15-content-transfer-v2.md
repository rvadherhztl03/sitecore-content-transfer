_SitecoreAI · Marketplace app · Version 2_

# Content Transfer v2: no credentials, and a safety net for every transfer

_What's new since the first version of my Content Transfer app._

By Ravi Vadher · [Publish date]

In July I shared the first version of my Content Transfer Marketplace app in [Beyond Package Designer: A Better Way to Transfer Content in Sitecore](https://ravivadher.tech.blog/2026/07/13/beyond-package-designer-a-better-way-to-transfer-content-in-sitecore/): a dashboard on top of Sitecore's Content Transfer and Item Transfer APIs, so nobody had to drive them from Postman.

It worked, but every environment needed a client ID, a client secret and an API host, and one busy dashboard made it easy to miss what a transfer was about to do. Version 2 fixes both, and adds the checks and the undo button I kept wishing I had.

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

## No credentials

The app now calls SitecoreAI through the Marketplace SDK as the signed-in user. Grant the app access to your environments in Cloud Portal and they show up, named and labelled Prod, QA or Dev. Nothing to paste, nothing to store.

## A guided flow

Four steps instead of one screen: **Route**, **Content**, **Review** and **Run**. Options are in plain language, and nothing is written until you press Start. Each item can include **This item**, **+ Children** or **+ Everything below**, and the overwrite options change to match.

> **[Screenshot 2]** Content step: the source tree and the Selected list, with one item set to "+ Children".
>
> _Caption: Pick items and decide what each one includes._

## Compare environments

Not sure what changed? The Compare tab walks a section of both environments and marks each item New, Changed, Different item or Only on the target. Tick what you want and add it to the list.

> **[Screenshot 3]** Compare tab: the filter chips with counts and the list with new and changed items ticked.
>
> _Caption: What is actually different between Dev and QA._

## Checks before anything is written

Review reads both environments first. It warns about parent items missing on the target, which would leave a transferred item invisible in the content tree, plus duplicate paths, paths that don't exist, and what "Replace it and everything below" will delete. It also finds the datasources, images and linked items your pages use that the target doesn't have yet, and adds them in one click.

> **[Screenshot 4]** Review step: the pre-flight notes and the "Used by your items but not in the list" note above the items table.
>
> _Caption: Problems show up before anything is written._

## Backup and one-click restore

Before a transfer overwrites anything, the app backs up what's about to change on the target. If something looks wrong afterwards, **Restore** puts the target back. It asks first, and production needs an extra confirmation.

> **[Screenshot 5]** Transfer complete: the summary with the Download backup and Restore buttons.
>
> _Caption: Done, with the way back right there._

## Publish, and send from Pages

Tick **Publish to Experience Edge when done** to make transferred content live straight away. Content authors can also send the page they're editing, with or without its child pages, from the Pages editor panel.

> **[Screenshot 6]** Pages editor with the Content Transfer panel open: From, To, Include and the Send button.
>
> _Caption: Moving one page without leaving the editor._

## Upgrading from version 1

Grant the app access to each environment in Cloud Portal. Version 1's saved connection profiles aren't used any more, so remove them and delete or rotate the automation clients you no longer need. Saved JSON lists still import.

## Try it

Version 1 got us off Postman. Version 2 makes every transfer something you can check before it runs and undo after it runs. I'd love to hear what works and what you'd want next.

[Link to the app or repository] · [How to reach you: LinkedIn, Sitecore Slack, email]
