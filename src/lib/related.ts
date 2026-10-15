import { brought, sameId } from '@/lib/preflight';
import { graphql, type Env, type SdkClient } from '@/lib/sdk';
import type { DataTree } from '@/lib/transfer';

/** A content or media item the queued items use but the list doesn't bring, and what the target holds at its path. */
export type RelatedItem = {
  itemPath: string;
  name: string;
  /** The queued items that refer to it, in list order. */
  usedBy: string[];
  /** `new`: the target lacks it; `same`: it has it; `other`: a different item sits at its path. */
  onTarget: 'new' | 'same' | 'other';
};

// An item ID: braced or plain with dashes, or the 32-digit form rich text links (`_id=`) and media URLs (`/media/`) use.
const ID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})|(?:_id=|\/media\/)([0-9a-f]{32})/gi;
// ponytail: a raw path runs to the next quote, tag or query character; a path written into prose takes the words after it.
const PATH = /\/sitecore\/(?:content|media library)\/[^"'<>&|?#\r\n]+/gi;
const CONTENT = /^\/sitecore\/(?:content|media library)\//i;

const dashed = (n: string) => [n.slice(0, 8), n.slice(8, 12), n.slice(12, 16), n.slice(16, 20), n.slice(20)].join('-');
const key = (path: string) => path.replace(/\/+$/, '').toLowerCase();

/** The item IDs (lower case, with dashes) and content or media paths a field value refers to, in order, once each. */
export function referencesIn(value: string): { ids: string[]; paths: string[] } {
  const ids = [...value.matchAll(ID)].map((m) => (m[1] ?? dashed(m[2])).toLowerCase());
  const paths = [...value.matchAll(PATH)].map((m) => m[0].replace(/[\s/]+$/, ''));
  return { ids: [...new Set(ids)], paths: [...new Set(paths)] };
}

// Lookups go in as literals: the API's ID argument isn't typed as a String, so a String! variable wouldn't fit it.
const item = (alias: string, by: 'path' | 'itemId', value: string, body: string) =>
  `  ${alias}: item(where: { ${by}: ${JSON.stringify(value)}, database: "master" }) { ${body} }`;
const FIELDS = 'itemId fields(excludeStandardFields: true) { nodes { value } } r: field(name: "__Renderings") { value } f: field(name: "__Final Renderings") { value }';

type Found = { itemId: string; path: string; name: string };

/**
 * Finds the content and media the queued items refer to in their fields and presentation (datasources, images, links)
 * that the list doesn't bring along, and whether the target has each. Reads the source twice (fields, then the items
 * they name) and the target once; only the queued items themselves are scanned, in the default language.
 */
export async function scanRelated(client: SdkClient, source: Env, target: Env, trees: DataTree[]): Promise<RelatedItem[]> {
  if (!trees.length) return [];
  const read = (await graphql(client, source, `query RelatedFields {\n${trees.map((t, i) => item(`i${i}`, 'path', t.itemPath, FIELDS)).join('\n')}\n}`, {})) ?? {};

  // Each reference, with the queued items that use it.
  const refs = new Map<string, { by: 'itemId' | 'path'; value: string; usedBy: Set<string> }>();
  const note = (by: 'itemId' | 'path', value: string, user: string) => {
    const k = `${by}:${by === 'path' ? key(value) : value}`;
    if (!refs.has(k)) refs.set(k, { by, value: by === 'itemId' ? `{${value}}` : value, usedBy: new Set() });
    refs.get(k)!.usedBy.add(user);
  };
  trees.forEach((t, i) => {
    const it = read[`i${i}`];
    if (!it) return;
    const values = [...(it.fields?.nodes ?? []).map((n: { value?: string }) => n.value), it.r?.value, it.f?.value].filter(Boolean).join('\n');
    const { ids, paths } = referencesIn(values);
    ids.forEach((id) => note('itemId', id, t.itemPath));
    paths.forEach((p) => note('path', p, t.itemPath));
  });
  // IDs first, then paths, each in the order they were found.
  const asked = [...refs.values()].sort((a, b) => (a.by === b.by ? 0 : a.by === 'itemId' ? -1 : 1));
  if (!asked.length) return [];

  const resolved = (await graphql(client, source, `query RelatedItems {\n${asked.map((r, i) => item(`r${i}`, r.by, r.value, 'itemId path name')).join('\n')}\n}`, {})) ?? {};
  // Content and media only, not what the list brings, once per path.
  const related = new Map<string, Found & { usedBy: Set<string> }>();
  asked.forEach((r, i) => {
    const found: Found | null = resolved[`r${i}`];
    if (!found?.path || !CONTENT.test(found.path) || brought(found.path, trees)) return;
    const k = key(found.path);
    if (!related.has(k)) related.set(k, { ...found, usedBy: new Set() });
    r.usedBy.forEach((u) => related.get(k)!.usedBy.add(u));
  });
  const list = [...related.values()];
  if (!list.length) return [];

  const there = (await graphql(client, target, `query RelatedOnTarget {\n${list.map((r, i) => item(`t${i}`, 'path', r.path, 'itemId')).join('\n')}\n}`, {})) ?? {};
  return list.map((r, i) => {
    const id: string | undefined = there[`t${i}`]?.itemId;
    const order = trees.map((t) => t.itemPath).filter((p) => r.usedBy.has(p));
    return { itemPath: r.path, name: r.name, usedBy: order, onTarget: !id ? 'new' : sameId(id, r.itemId) ? 'same' : 'other' };
  });
}

/** Adds the related items the target lacks, once each, as "This item" kept if it exists by then. */
export function addRelated(trees: DataTree[], related: RelatedItem[]): DataTree[] {
  const queued = new Set(trees.map((t) => key(t.itemPath)));
  const added = related
    .filter((r) => r.onTarget === 'new' && !queued.has(key(r.itemPath)))
    .map((r): DataTree => ({ itemPath: r.itemPath, scope: 'SingleItem', mergeStrategy: 'KeepExistingItem' }));
  return [...trees, ...added];
}
