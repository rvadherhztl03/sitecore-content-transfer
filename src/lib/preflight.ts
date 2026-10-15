import { graphql, type Env, type SdkClient } from '@/lib/sdk';
import type { DataTree } from '@/lib/transfer';

/** What the source and target hold for one queued item, read before anything is written. */
export type ItemCheck = {
  itemPath: string;
  /** False when the source has nothing at this path: the row would transfer nothing. */
  onSource: boolean;
  /** `new`: nothing at this path on the target; `same`: the same item (ID); `other`: a different item, so copying adds a second item with the same name. */
  onTarget: 'new' | 'same' | 'other';
  /** Parents the target lacks and the list doesn't bring, top down: without them the item won't appear in the content tree. */
  missingParents: string[];
  /** Parents the target has under a different ID: the item won't appear under them either. */
  otherParents: string[];
  /** For "Replace it and everything below": the target's direct children the source doesn't have, which get deleted. */
  deleted: string[];
};

type Child = { itemId: string; name: string };

const key = (path: string) => path.replace(/\/+$/, '').toLowerCase();
const normId = (id: string) => id.replace(/[{}-]/g, '').toLowerCase();

/** The item's parents below /sitecore, top down. */
export function parentsOf(path: string): string[] {
  const parts = path.replace(/\/+$/, '').split('/').filter(Boolean);
  return parts.slice(2).map((_, i) => '/' + parts.slice(0, i + 2).join('/'));
}

// Whether the list itself brings `path` along: it is a row, below a "+ Everything below" row, or a child of a "+ Children" row.
function brought(path: string, trees: DataTree[]) {
  const p = key(path);
  const parent = p.slice(0, p.lastIndexOf('/'));
  return trees.some((t) => {
    const k = key(t.itemPath);
    return k === p || (t.scope === 'ItemAndDescendants' && p.startsWith(`${k}/`)) || (t.scope === 'ItemAndChildren' && parent === k);
  });
}

// One query per environment: alias `p<n>` reads an item's ID and `c<n>` its children; each alias is named like its variable.
async function lookup(client: SdkClient, env: Env, paths: string[], childrenOf: string[]) {
  const vars = [...paths.map((p, i) => [`p${i}`, p]), ...childrenOf.map((p, i) => [`c${i}`, p])];
  const item = (alias: string, body: string) => `${alias}: item(where: { path: $${alias}, database: "master" }) { ${body} }`;
  const query = `query Preflight(${vars.map(([v]) => `$${v}: String!`).join(', ')}) {
  ${[
    ...paths.map((_, i) => item(`p${i}`, 'itemId')),
    // ponytail: first 1,000 children only; the deletion list is a preview, not a guarantee.
    ...childrenOf.map((_, i) => item(`c${i}`, 'children(first: 1000) { nodes { itemId name } }')),
  ].join('\n  ')}
}`;
  const data = (await graphql(client, env, query, Object.fromEntries(vars))) ?? {};
  return {
    ids: new Map(paths.map((p, i) => [key(p), data[`p${i}`]?.itemId as string | undefined])),
    children: new Map(childrenOf.map((p, i) => [key(p), (data[`c${i}`]?.children?.nodes ?? []) as Child[]])),
  };
}

/** Looks up every queued item and its parents on both environments, and reports what the transfer would do to each. */
export async function runPreflight(client: SdkClient, source: Env, target: Env, trees: DataTree[]): Promise<Map<string, ItemCheck>> {
  const paths = new Map<string, string>();
  for (const t of trees) for (const p of [...parentsOf(t.itemPath), t.itemPath]) paths.set(key(p), p);
  const replaced = trees.filter((t) => t.mergeStrategy === 'OverrideExistingTree').map((t) => t.itemPath);
  const [src, tgt] = await Promise.all([source, target].map((env) => lookup(client, env, [...paths.values()], replaced)));

  const checks = new Map<string, ItemCheck>();
  for (const t of trees) {
    const id = src.ids.get(key(t.itemPath));
    const there = tgt.ids.get(key(t.itemPath));
    const check: ItemCheck = {
      itemPath: t.itemPath,
      onSource: !!id,
      onTarget: !there ? 'new' : id && normId(id) === normId(there) ? 'same' : 'other',
      missingParents: [],
      otherParents: [],
      deleted: [],
    };
    if (id) {
      for (const p of parentsOf(t.itemPath)) {
        const mine = src.ids.get(key(p));
        const theirs = tgt.ids.get(key(p));
        if (!theirs) {
          if (!brought(p, trees)) check.missingParents.push(p);
        } else if (mine && normId(mine) !== normId(theirs)) check.otherParents.push(p);
      }
      // A different item at the path isn't replaced by this one, so nothing under it is deleted.
      if (t.mergeStrategy === 'OverrideExistingTree' && check.onTarget === 'same') {
        const kept = new Set(src.children.get(key(t.itemPath))?.map((c) => normId(c.itemId)));
        check.deleted = (tgt.children.get(key(t.itemPath)) ?? []).filter((c) => !kept.has(normId(c.itemId))).map((c) => c.name);
      }
    }
    checks.set(t.itemPath, check);
  }
  return checks;
}

/** Adds each missing parent once, as "This item" kept if it exists by then, just before the first item that needs it. */
export function addMissingParents(trees: DataTree[], checks: Map<string, ItemCheck>): DataTree[] {
  const queued = new Set(trees.map((t) => key(t.itemPath)));
  return trees.flatMap((t) => {
    const parents = (checks.get(t.itemPath)?.missingParents ?? []).filter((p) => !queued.has(key(p)));
    for (const p of parents) queued.add(key(p));
    return [...parents.map((itemPath): DataTree => ({ itemPath, scope: 'SingleItem', mergeStrategy: 'KeepExistingItem' })), t];
  });
}

/** Drops the items the source doesn't have. */
export const removeNotFound = (trees: DataTree[], checks: Map<string, ItemCheck>): DataTree[] =>
  trees.filter((t) => checks.get(t.itemPath)?.onSource !== false);
