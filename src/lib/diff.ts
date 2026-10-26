import { graphql, type Env, type SdkClient } from '@/lib/sdk';

/** One field of an item on both environments; a side is `undefined` when its item lacks the field (e.g. templates differ). */
export type FieldValue = { name: string; source?: string; target?: string; changed: boolean };

// Every save changes these, so they'd always differ.
const IGNORED = new Set(['__Revision', '__Updated', '__Updated by']);

async function fieldsOf(client: SdkClient, env: Env, path: string): Promise<Map<string, string>> {
  const q = `query FieldDiff {\n  item(where: { path: ${JSON.stringify(path)}, database: "master" }) { fields(excludeStandardFields: false) { nodes { name value } } }\n}`;
  const item = ((await graphql(client, env, q, {})) ?? {}).item;
  if (!item) throw new Error(`${path} isn't on ${env.name}.`);
  return new Map((item.fields?.nodes ?? []).map((f: { name: string; value?: string | null }) => [f.name, f.value ?? '']));
}

/**
 * Reads the item at `itemPath` on both environments and pairs up its fields: the source's in order, then those only the
 * target has, leaving out the ones every save changes. Compares what `item(where:)` returns: the default language's
 * latest version. Throws when either environment lacks the item.
 */
export async function fieldDiff(client: SdkClient, source: Env, target: Env, itemPath: string): Promise<FieldValue[]> {
  const [s, t] = await Promise.all([fieldsOf(client, source, itemPath), fieldsOf(client, target, itemPath)]);
  return [...new Set([...s.keys(), ...t.keys()])]
    .filter((name) => !IGNORED.has(name))
    .map((name) => ({ name, source: s.get(name), target: t.get(name), changed: s.get(name) !== t.get(name) }));
}
