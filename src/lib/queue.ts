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
];

/**
 * The merge options for a scope. Replacing (deleting) everything below is only offered with "+ Everything below".
 * "+ Children" replaces the item and each child on its own, so its item-only option is named `childrenReplace`.
 */
export const mergesFor = (scope: Scope, merges = MERGES, childrenReplace = 'Replace it and its children') => {
  if (scope === 'ItemAndDescendants') return merges;
  const options = merges.filter((m) => m.value !== 'OverrideExistingTree');
  if (scope !== 'ItemAndChildren') return options;
  return options.map((m) => (m.value === 'OverrideExistingItem' ? { ...m, label: childrenReplace, long: childrenReplace } : m));
};

/** Changes the scope, moving a merge strategy the new scope doesn't offer to replacing the item (and its children). */
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

// Older lists can name LatestWin, which the API doesn't support: keep the target's item rather than fall back
// to the default, which deletes everything below.
const retired = (strategy: unknown) => (strategy === 'LatestWin' ? 'KeepExistingItem' : strategy);

/** The list as a file's text: the plain array `parseQueueJson` reads back as the same rows. */
export const queueJson = (trees: DataTree[]): string => JSON.stringify(trees, null, 2);

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
      mergeStrategy: oneOf(MERGES, retired(pick(row, 'strategy', 'MergeStrategy', 'mergeStrategy')), defaults.mergeStrategy),
    };
    return [withScope(tree, oneOf(SCOPES, pick(row, 'scope', 'Scope'), defaults.scope))];
  });
  if (trees.length === 0) throw new Error('No valid item paths found in JSON.');
  return trees;
}

// Sitecore Content Serialization (CLI) module files, `items.includes[]`. Values are matched ignoring case: Sitecore's own
// examples write them in both cases. Ignored is only valid in rules, but is skipped here too rather than guessed at.
// https://doc.sitecore.com/xp/en/developers/104/developer-tools/sitecore-content-serialization-configuration-reference.html
const MODULE_SCOPES = new Map<string, Scope>([
  ['singleitem', 'SingleItem'],
  ['itemandchildren', 'ItemAndChildren'],
  ['itemanddescendants', 'ItemAndDescendants'],
  ['descendantsonly', 'ItemAndDescendants'],
]);
const MODULE_PUSH = new Map<string, MergeStrategy>([
  ['createonly', 'KeepExistingItem'],
  ['createandupdate', 'OverrideExistingItem'],
  ['createupdateanddelete', 'OverrideExistingTree'],
]);

// An include's property in lower case, or the documented default when it's absent; '' when it isn't a string.
const lower = (value: unknown, fallback: string) => (value === undefined ? fallback : typeof value === 'string' ? value.toLowerCase() : '');
const times = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Whether the parsed JSON is a module file: `items` holds an `includes` array (a queue's `items` is itself an array). */
const isModule = (parsed: unknown): parsed is { items: { includes: unknown[] } } =>
  Array.isArray((parsed as { items?: { includes?: unknown } } | null)?.items?.includes);

/**
 * Reads a Sitecore CLI module file's includes as queue rows, with a note on anything skipped or approximated.
 * - scope: DescendantsOnly becomes "+ Everything below" that keeps what's there (the item itself is only created if missing).
 * - allowedPushOperations (default CreateUpdateAndDelete): CreateOnly keeps, CreateAndUpdate replaces the item,
 *   CreateUpdateAndDelete replaces everything below, or just the item when the scope has no "below" to replace.
 * - Skipped: Ignored scope, a database other than master, and includes without a path or with a value Sitecore doesn't list.
 * - rules aren't supported: the include's whole path is added.
 */
function parseModule(parsed: { items: { includes: unknown[] } }, fileName: string): { trees: DataTree[]; note: string } {
  const rows: DataTree[] = [];
  let skipped = 0;
  let ruled = 0;
  let descendantsOnly = 0;
  for (const include of parsed.items.includes) {
    const inc = (include && typeof include === 'object' ? include : {}) as Record<string, unknown>;
    const path = typeof inc.path === 'string' ? inc.path.trim() : '';
    const scopeName = lower(inc.scope, 'itemanddescendants');
    const scope = MODULE_SCOPES.get(scopeName);
    const push = MODULE_PUSH.get(lower(inc.allowedPushOperations, 'createupdateanddelete'));
    if (!path || !scope || !push || lower(inc.database, 'master') !== 'master') {
      skipped++;
      continue;
    }
    const keepOnly = scopeName === 'descendantsonly';
    if (keepOnly) descendantsOnly++;
    if (Array.isArray(inc.rules) && inc.rules.length) ruled++;
    // withScope drops a merge the scope doesn't allow (replacing everything below, for all but + Everything below).
    rows.push(withScope({ itemPath: path, scope, mergeStrategy: keepOnly ? 'KeepExistingItem' : push }, scope));
  }
  const trees = mergeTrees([], rows);
  const notes = [
    skipped && `Skipped ${skipped} (ignored, not in master or not valid).`,
    ruled && `${ruled} had rules, so ${times(ruled, 'its whole tree was', 'their whole trees were')} added.`,
    descendantsOnly &&
      `${descendantsOnly} ${times(descendantsOnly, 'was', 'were')} descendants only, so ${times(descendantsOnly, 'it was', 'they were')} added as + Everything below with Keep what's there (the item itself is only created if missing).`,
  ].filter(Boolean);
  if (trees.length === 0) throw new Error(['No items to load from', `${fileName}.`, ...notes].join(' '));
  return { trees, note: [`Loaded ${trees.length} ${times(trees.length, 'item', 'items')} from ${fileName}.`, ...notes].join(' ') };
}

/** Reads a queue file or a Sitecore CLI `*.module.json`; `note` says what a module file skipped or approximated. */
export function parseQueueFile(text: string, fileName: string): { trees: DataTree[]; note?: string } {
  const parsed = JSON.parse(text);
  return isModule(parsed) ? parseModule(parsed, fileName) : { trees: parseQueueJson(text) };
}
