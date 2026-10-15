import type { DataTree, MergeStrategy, Scope } from '@/lib/transfer';

export const SCOPES: { value: Scope; label: string; long: string }[] = [
  { value: 'SingleItem', label: 'This item', long: 'This item only' },
  { value: 'ItemAndChildren', label: '+ Children', long: 'Item + its children' },
  { value: 'ItemAndDescendants', label: '+ Everything below', long: 'Item + everything below' },
];

export const MERGES: { value: MergeStrategy; label: string; long: string }[] = [
  { value: 'OverrideExistingTree', label: 'Replace it and everything below', long: 'Replace it and everything below' },
  { value: 'OverrideExistingItem', label: 'Replace this item only', long: 'Replace this item only' },
  { value: 'KeepExistingItem', label: "Keep what's there", long: "Keep what's there" },
  { value: 'LatestWin', label: 'Keep the newer one', long: 'Keep the newer one' },
];

/** "+ Children" leaves the nested items out, so it doesn't offer replacing (deleting) everything below. */
export const mergesFor = (scope: Scope, merges = MERGES) =>
  scope === 'ItemAndChildren' ? merges.filter((m) => m.value !== 'OverrideExistingTree') : merges;

/** Changes the scope, moving a merge strategy the new scope doesn't offer to "Replace this item only". */
export const withScope = <T extends Pick<DataTree, 'scope' | 'mergeStrategy'>>(t: T, scope: Scope): T => ({
  ...t,
  scope,
  mergeStrategy: mergesFor(scope).some((m) => m.value === t.mergeStrategy) ? t.mergeStrategy : 'OverrideExistingItem',
});

/** Plain-language label for a value: short for controls, `long` for review screens and tables. */
export const labelOf = (options: { value: string; label: string; long?: string }[], value: string, long = false): string => {
  const o = options.find((o) => o.value === value);
  return (long && o?.long) || o?.label || value;
};

/** Last path segment, ignoring a trailing slash; the path itself when there is none. */
export const nameOf = (path: string): string => path.replace(/\/+$/, '').split('/').pop() || path;

export const newTree = (itemPath: string): DataTree => ({
  itemPath,
  scope: 'ItemAndDescendants',
  mergeStrategy: 'OverrideExistingTree',
});

const key = (path: string) => path.replace(/\/+$/, '');

/** Appends incoming rows whose path (ignoring a trailing slash) isn't queued yet. */
export function mergeTrees(existing: DataTree[], incoming: DataTree[]): DataTree[] {
  const seen = new Set(existing.map((t) => key(t.itemPath)));
  const added = incoming.filter((t) => {
    const k = key(t.itemPath);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return [...existing, ...added];
}

const pick = (row: Record<string, unknown>, ...names: string[]) => names.map((n) => row[n]).find(Boolean);
const oneOf = <T extends string>(options: { value: T }[], value: unknown, fallback: T) =>
  options.find((o) => o.value === value)?.value ?? fallback;

/** Reads a queue file: an array, `{ dataTrees }` or `{ items }`; unsupported scope/merge fall back to the defaults. */
export function parseQueueJson(text: string): DataTree[] {
  const parsed = JSON.parse(text);
  const rows = [parsed, parsed?.dataTrees, parsed?.items].find(Array.isArray);
  if (!rows) {
    throw new Error('Invalid JSON format. Expected an array of items or a dataTrees object wrapper.');
  }
  const defaults = newTree('');
  const trees = rows.flatMap((row): DataTree[] => {
    if (!row || typeof row !== 'object') return [];
    const path = pick(row, 'path', 'ItemPath', 'itemPath');
    if (typeof path !== 'string' || !path.trim()) return [];
    const tree: DataTree = {
      itemPath: path.trim(),
      scope: defaults.scope,
      mergeStrategy: oneOf(MERGES, pick(row, 'strategy', 'MergeStrategy', 'mergeStrategy'), defaults.mergeStrategy),
    };
    return [withScope(tree, oneOf(SCOPES, pick(row, 'scope', 'Scope'), defaults.scope))];
  });
  if (trees.length === 0) throw new Error('No valid item paths found in JSON.');
  return trees;
}
