import { sameId } from '@/lib/preflight';
import { graphql, type Env, type SdkClient } from '@/lib/sdk';
import type { DataTree } from '@/lib/transfer';

/**
 * - `new`: only on the source.
 * - `changed`: the same item on both, with a different revision.
 * - `other`: a different item (ID) at the same path.
 * - `onlyTarget`: only on the target.
 * - `same`: the same item with the same revision.
 */
export type CompareStatus = 'new' | 'changed' | 'other' | 'onlyTarget' | 'same';
export type Side = { id: string; revision?: string; updated?: string };
export type CompareItem = {
  path: string;
  name: string;
  /** Levels below the starting point (which is 0). */
  depth: number;
  status: CompareStatus;
  /** For `changed`: the side updated last, when both report it. */
  newer?: 'source' | 'target';
  source?: Side;
  target?: Side;
};

export const COMPARE_LIMIT = 2000;
// Parents per children query.
const BATCH = 100;

type Node = { itemId: string; name: string; path: string; r?: { value?: string } | null; u?: { value?: string } | null };

const ITEM = 'itemId name path r: field(name: "__Revision") { value } u: field(name: "__Updated") { value }';
const item = (alias: string, path: string, body: string) => `  ${alias}: item(where: { path: ${JSON.stringify(path)}, database: "master" }) { ${body} }`;
const key = (path: string) => path.replace(/\/+$/, '').toLowerCase();
const isUnder = (path: string, root: string) => key(path).startsWith(`${key(root)}/`);

async function rootOf(client: SdkClient, env: Env, path: string): Promise<Node | null> {
  return ((await graphql(client, env, `query CompareRoot {\n${item('root', path, ITEM)}\n}`, {})) ?? {}).root ?? null;
}

// The children of each parent, in order, `BATCH` parents per query.
async function childrenOf(client: SdkClient, env: Env, parents: string[]): Promise<Node[][]> {
  const out: Node[][] = [];
  for (let i = 0; i < parents.length; i += BATCH) {
    const batch = parents.slice(i, i + BATCH);
    const q = `query CompareLevel {\n${batch.map((p, j) => item(`c${j}`, p, `children(first: 1000) { nodes { ${ITEM} } }`)).join('\n')}\n}`;
    const data = (await graphql(client, env, q, {})) ?? {};
    batch.forEach((_, j) => out.push(data[`c${j}`]?.children?.nodes ?? []));
  }
  return out;
}

const side = (n?: Node): Side | undefined => n && { id: n.itemId, revision: n.r?.value ?? undefined, updated: n.u?.value ?? undefined };

function entry(s: Node | undefined, t: Node | undefined, depth: number): CompareItem {
  const n = (s ?? t)!;
  const [a, b] = [side(s), side(t)];
  const status: CompareStatus = !b ? 'new' : !a ? 'onlyTarget' : !sameId(a.id, b.id) ? 'other' : a.revision === b.revision ? 'same' : 'changed';
  // __Updated is "yyyyMMddTHHmmssZ", so the later date sorts last.
  const newer = status === 'changed' && a!.updated && b!.updated && a!.updated !== b!.updated ? (a!.updated > b!.updated ? 'source' : 'target') : undefined;
  return { path: n.path, name: n.name, depth, status, ...(newer && { newer }), source: a, target: b };
}

/**
 * The `__Updated` stamp ("yyyyMMddTHHmmssZ", UTC) of the start of `day` (YYYY-MM-DD) in local time, or undefined when
 * `day` isn't a date (an empty or cleared date input).
 */
export function startOfDay(day: string): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return undefined;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().replace(/[-:]|\.\d+/g, '');
}

/**
 * Whether the item's source side was updated on or after `since` (a `startOfDay` stamp). An item with no source side,
 * or none that reports `__Updated`, never is. Only the date and time to the second are compared: Sitecore can add
 * milliseconds after them ("20261119T143000:123Z"), which would sort wrongly against a stamp that has none.
 */
export const changedSince = (item: CompareItem, since: string) => !!item.source?.updated && item.source.updated.slice(0, 15) >= since.slice(0, 15);

// Parents before children, siblings by name.
function byTree(a: CompareItem, b: CompareItem) {
  const [x, y] = [key(a.path).split('/'), key(b.path).split('/')];
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return x.length - y.length;
}

/**
 * Walks the tree under `root` on both environments a level at a time, reading each side only under the items it has,
 * and compares every item by ID and `__Revision` (default language). Stops after `limit` items (`truncated`).
 * Returns the items in tree order.
 */
export async function compareTrees(
  client: SdkClient,
  source: Env,
  target: Env,
  root: string,
  { onProgress, signal, limit = COMPARE_LIMIT }: { onProgress?(compared: number): void; signal?: AbortSignal; limit?: number } = {},
): Promise<{ items: CompareItem[]; truncated: boolean }> {
  const [s, t] = await Promise.all([rootOf(client, source, root), rootOf(client, target, root)]);
  if (!s && !t) throw new Error(`${root} isn't on ${source.name} or ${target.name}.`);

  const items: CompareItem[] = [];
  let truncated = false;
  let level: { s?: Node; t?: Node }[] = [{ s: s ?? undefined, t: t ?? undefined }];
  for (let depth = 0; level.length; depth++) {
    for (const n of level) {
      if (items.length >= limit) {
        truncated = true;
        break;
      }
      items.push(entry(n.s, n.t, depth));
    }
    onProgress?.(items.length);
    signal?.throwIfAborted();
    if (truncated) break;

    const withS = level.filter((n) => n.s);
    const withT = level.filter((n) => n.t);
    const [sKids, tKids] = await Promise.all([
      childrenOf(client, source, withS.map((n) => n.s!.path)),
      childrenOf(client, target, withT.map((n) => n.t!.path)),
    ]);
    signal?.throwIfAborted();
    // Pair each parent's children by path: the source's in order, then those only the target has.
    const next: { s?: Node; t?: Node }[] = [];
    for (const n of level) {
      const mine = n.s ? sKids[withS.indexOf(n)] : [];
      const theirs = new Map((n.t ? tKids[withT.indexOf(n)] : []).map((c) => [key(c.path), c]));
      for (const c of mine) {
        next.push({ s: c, t: theirs.get(key(c.path)) });
        theirs.delete(key(c.path));
      }
      for (const c of theirs.values()) next.push({ t: c });
    }
    level = next;
  }
  return { items: items.sort(byTree), truncated };
}

/**
 * The queue rows for the picked items (in tree order): changed items as "This item" replacing it; new ones as "This item"
 * kept if they exist by then, except that a new item picked with everything compared below it becomes one
 * "+ Everything below" row. Everything below a new item is new too, so that row brings nothing else.
 */
export function rowsFor(items: CompareItem[], picked: Set<string>): DataTree[] {
  const rows: DataTree[] = [];
  let branch: string | null = null;
  for (const it of items) {
    if (branch && isUnder(it.path, branch)) continue;
    branch = null;
    if (!picked.has(it.path)) continue;
    // ponytail: scans the items for each new pick, O(n²) over the 2,000-item cap.
    const whole = it.status === 'new' && items.every((x) => !isUnder(x.path, it.path) || picked.has(x.path));
    if (whole && items.some((x) => isUnder(x.path, it.path))) {
      rows.push({ itemPath: it.path, scope: 'ItemAndDescendants', mergeStrategy: 'KeepExistingItem' });
      branch = it.path;
    } else {
      rows.push({ itemPath: it.path, scope: 'SingleItem', mergeStrategy: it.status === 'changed' ? 'OverrideExistingItem' : 'KeepExistingItem' });
    }
  }
  return rows;
}
