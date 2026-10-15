import type { DataTree, MergeStrategy, Scope } from '@/lib/transfer';

export const SCOPES: { value: Scope; label: string }[] = [
  { value: 'SingleItem', label: 'Single item' },
  { value: 'ItemAndDescendants', label: 'Item & descendants' },
];

export const MERGES: { value: MergeStrategy; label: string; description: string }[] = [
  {
    value: 'OverrideExistingTree',
    label: 'Override tree',
    description: 'Replace the item and all its descendants on the target.',
  },
  {
    value: 'OverrideExistingItem',
    label: 'Override item',
    description: 'Replace only this item; leave its descendants alone.',
  },
  {
    value: 'KeepExistingItem',
    label: 'Keep existing',
    description: 'Skip items that already exist on the target.',
  },
  {
    value: 'LatestWin',
    label: 'Latest wins',
    description: 'Keep whichever version was modified most recently.',
  },
];

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
    return [
      {
        itemPath: path.trim(),
        scope: oneOf(SCOPES, pick(row, 'scope', 'Scope'), defaults.scope),
        mergeStrategy: oneOf(MERGES, pick(row, 'strategy', 'MergeStrategy', 'mergeStrategy'), defaults.mergeStrategy),
      },
    ];
  });
  if (trees.length === 0) throw new Error('No valid item paths found in JSON.');
  return trees;
}
