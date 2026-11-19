// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MERGES, SCOPES, labelOf, mergeTrees, mergesFor, nameOf, newTree, parseQueueFile, parseQueueJson, queueJson, withScope } from '@/lib/queue';
import type { DataTree } from '@/lib/transfer';

// A module file with the given includes.
const moduleFile = (...includes: object[]) => JSON.stringify({ namespace: 'Project', items: { includes } });

describe('queue', () => {
  it('uses the plain-language labels', () => {
    expect(SCOPES).toEqual([
      { value: 'SingleItem', label: 'This item', long: 'This item only' },
      { value: 'ItemAndChildren', label: '+ Children', long: 'Item + its children' },
      { value: 'ItemAndDescendants', label: '+ Everything below', long: 'Item + everything below' },
    ]);
    expect(MERGES).toEqual([
      { value: 'OverrideExistingTree', label: 'Replace it and everything below', long: 'Replace it and everything below' },
      { value: 'OverrideExistingItem', label: 'Replace this item only', long: 'Replace this item only' },
      { value: 'KeepExistingItem', label: "Keep what's there", long: "Keep what's there" },
    ]);
  });

  it('nameOf returns the last path segment, ignoring a trailing slash', () => {
    expect(nameOf('/sitecore/content/Acme/Home')).toBe('Home');
    expect(nameOf('/sitecore/content/Acme/Home/')).toBe('Home');
    expect(nameOf('/')).toBe('/');
  });

  it('labelOf returns the short label, the long one, or the value itself', () => {
    expect(labelOf(SCOPES, 'SingleItem')).toBe('This item');
    expect(labelOf(SCOPES, 'SingleItem', true)).toBe('This item only');
    expect(labelOf(SCOPES, 'Nope')).toBe('Nope');
    expect(labelOf([{ value: 'a', label: 'A' }], 'a', true)).toBe('A');
  });

  it('newTree uses the defaults', () => {
    expect(newTree('/a')).toEqual({
      itemPath: '/a',
      scope: 'ItemAndDescendants',
      mergeStrategy: 'OverrideExistingTree',
    });
  });

  it('offers replacing everything below only with + Everything below', () => {
    const labels = (scope: Parameters<typeof mergesFor>[0]) => mergesFor(scope).map((m) => [m.value, m.label]);
    expect(labels('SingleItem')).toEqual([
      ['OverrideExistingItem', 'Replace this item only'],
      ['KeepExistingItem', "Keep what's there"],
    ]);
    // + Children replaces the item and each child on its own, never anything deeper.
    expect(labels('ItemAndChildren')).toEqual([
      ['OverrideExistingItem', 'Replace it and its children'],
      ['KeepExistingItem', "Keep what's there"],
    ]);
    expect(mergesFor('ItemAndChildren')[0].long).toBe('Replace it and its children');
    expect(mergesFor('ItemAndDescendants')).toBe(MERGES);
  });

  it('mergesFor names the + Children replace option as given', () => {
    expect(mergesFor('ItemAndChildren', MERGES, 'Replace it and its child pages')[0]).toEqual({
      value: 'OverrideExistingItem',
      label: 'Replace it and its child pages',
      long: 'Replace it and its child pages',
    });
  });

  it('withScope moves "Replace it and everything below" to replacing the item (and its children) for the other scopes', () => {
    expect(withScope(newTree('/a'), 'ItemAndChildren')).toEqual({ itemPath: '/a', scope: 'ItemAndChildren', mergeStrategy: 'OverrideExistingItem' });
    expect(withScope(newTree('/a'), 'SingleItem')).toEqual({ itemPath: '/a', scope: 'SingleItem', mergeStrategy: 'OverrideExistingItem' });
    expect(withScope(newTree('/a'), 'ItemAndDescendants')).toEqual(newTree('/a'));
    const keep = { ...newTree('/a'), mergeStrategy: 'KeepExistingItem' as const };
    expect(withScope(keep, 'ItemAndChildren')).toEqual({ ...keep, scope: 'ItemAndChildren' });
  });

  it('mergeTrees dedupes by path', () => {
    const existing = [{ itemPath: '/a', scope: 'SingleItem' as const, mergeStrategy: 'KeepExistingItem' as const }];
    expect(mergeTrees(existing, [newTree('/a/'), newTree('/b')])).toEqual([existing[0], newTree('/b')]);
  });

  it('parseQueueJson accepts an array, { dataTrees } and { items }', () => {
    const rows = [
      { path: '/a', scope: 'SingleItem', strategy: 'OverrideExistingItem' },
      { ItemPath: '/b', Scope: 'SingleItem', MergeStrategy: 'KeepExistingItem' },
      { itemPath: '/c', mergeStrategy: 'OverrideExistingItem' },
    ];
    const expected = [
      { itemPath: '/a', scope: 'SingleItem', mergeStrategy: 'OverrideExistingItem' },
      { itemPath: '/b', scope: 'SingleItem', mergeStrategy: 'KeepExistingItem' },
      { itemPath: '/c', scope: 'ItemAndDescendants', mergeStrategy: 'OverrideExistingItem' },
    ];
    expect(parseQueueJson(JSON.stringify(rows))).toEqual(expected);
    expect(parseQueueJson(JSON.stringify({ dataTrees: rows }))).toEqual(expected);
    expect(parseQueueJson(JSON.stringify({ items: rows }))).toEqual(expected);
  });

  it('parseQueueJson maps unsupported scope and merge to the defaults', () => {
    expect(parseQueueJson('[{"path":"/a","scope":"Nope","strategy":"Nope"}]')).toEqual([newTree('/a')]);
  });

  it('parseQueueJson reads the retired LatestWin as "Keep what\'s there", never as a replace', () => {
    // The Content Transfer API has no LatestWin; keeping the target's item is the choice that can't lose content.
    expect(parseQueueJson('[{"path":"/a","strategy":"LatestWin"},{"path":"/b","scope":"SingleItem","MergeStrategy":"LatestWin"}]')).toEqual([
      { itemPath: '/a', scope: 'ItemAndDescendants', mergeStrategy: 'KeepExistingItem' },
      { itemPath: '/b', scope: 'SingleItem', mergeStrategy: 'KeepExistingItem' },
    ]);
  });

  it('parseQueueJson never replaces everything below a single item', () => {
    expect(parseQueueJson('[{"path":"/a","scope":"SingleItem","strategy":"OverrideExistingTree"}]')).toEqual([
      { itemPath: '/a', scope: 'SingleItem', mergeStrategy: 'OverrideExistingItem' },
    ]);
  });

  it('parseQueueJson accepts ItemAndChildren, without replacing everything below', () => {
    expect(parseQueueJson('[{"path":"/a","scope":"ItemAndChildren"},{"path":"/b","scope":"ItemAndChildren","strategy":"KeepExistingItem"}]')).toEqual([
      { itemPath: '/a', scope: 'ItemAndChildren', mergeStrategy: 'OverrideExistingItem' },
      { itemPath: '/b', scope: 'ItemAndChildren', mergeStrategy: 'KeepExistingItem' },
    ]);
  });

  it('parseQueueJson drops rows without a path', () => {
    expect(parseQueueJson('[{"scope":"SingleItem"},{"path":""},null,{"path":"/a"}]')).toEqual([newTree('/a')]);
  });

  it('parseQueueJson rejects other shapes', () => {
    expect(() => parseQueueJson('{}')).toThrow(
      'Invalid JSON format. Expected an array of items or a dataTrees object wrapper.',
    );
  });

  it('parseQueueJson rejects empty results', () => {
    expect(() => parseQueueJson('[]')).toThrow('No valid item paths found in JSON.');
    expect(() => parseQueueJson('[{"scope":"SingleItem"}]')).toThrow('No valid item paths found in JSON.');
  });

  it('queueJson saves rows that parseQueueJson reads back as the same rows', () => {
    // One of every scope and merge it offers, so nothing is coerced on the way back.
    const rows: DataTree[] = [
      newTree('/sitecore/content/Acme'),
      { itemPath: '/sitecore/content/Acme/Home', scope: 'ItemAndDescendants', mergeStrategy: 'KeepExistingItem' },
      { itemPath: '/sitecore/content/Acme/Home/About', scope: 'ItemAndChildren', mergeStrategy: 'OverrideExistingItem' },
      { itemPath: '/sitecore/content/Acme/Home/News', scope: 'ItemAndChildren', mergeStrategy: 'KeepExistingItem' },
      { itemPath: '/sitecore/content/Acme/Data', scope: 'SingleItem', mergeStrategy: 'OverrideExistingItem' },
      { itemPath: '/sitecore/content/Acme/Footer', scope: 'SingleItem', mergeStrategy: 'KeepExistingItem' },
    ];
    expect(parseQueueJson(queueJson(rows))).toEqual(rows);
    expect(parseQueueFile(queueJson(rows), 'content-transfer-list-2026-11-19.json')).toEqual({ trees: rows });
  });

  describe('parseQueueFile with a Sitecore CLI module file', () => {
    const load = (...includes: object[]) => parseQueueFile(moduleFile(...includes), 'Project.module.json');

    it('reads a queue file as before, with no note', () => {
      expect(parseQueueFile('[{ "path": "/a" }]', 'queue.json')).toEqual({ trees: [newTree('/a')] });
      // A queue's `items` is an array; a module's holds `includes`.
      expect(parseQueueFile('{ "items": [{ "path": "/a" }] }', 'queue.json')).toEqual({ trees: [newTree('/a')] });
    });

    it('uses the documented defaults: ItemAndDescendants, CreateUpdateAndDelete, master', () => {
      const { trees, note } = load({ name: 'Content', path: '/sitecore/content/Acme' });
      expect(trees).toEqual([newTree('/sitecore/content/Acme')]);
      expect(note).toBe('Loaded 1 item from Project.module.json.');
    });

    it('maps allowedPushOperations to the merge', () => {
      const { trees } = load(
        { name: 'a', path: '/a', allowedPushOperations: 'CreateOnly' },
        { name: 'b', path: '/b', allowedPushOperations: 'CreateAndUpdate' },
        { name: 'c', path: '/c', allowedPushOperations: 'CreateUpdateAndDelete' },
      );
      expect(trees).toEqual([
        { itemPath: '/a', scope: 'ItemAndDescendants', mergeStrategy: 'KeepExistingItem' },
        { itemPath: '/b', scope: 'ItemAndDescendants', mergeStrategy: 'OverrideExistingItem' },
        { itemPath: '/c', scope: 'ItemAndDescendants', mergeStrategy: 'OverrideExistingTree' },
      ]);
    });

    it('keeps the scope, and never replaces everything below unless the scope has one', () => {
      const { trees } = load(
        { name: 'a', path: '/a', scope: 'SingleItem' },
        { name: 'b', path: '/b', scope: 'ItemAndChildren' },
        { name: 'c', path: '/c', scope: 'ItemAndDescendants', allowedPushOperations: 'CreateOnly' },
      );
      expect(trees).toEqual([
        { itemPath: '/a', scope: 'SingleItem', mergeStrategy: 'OverrideExistingItem' },
        { itemPath: '/b', scope: 'ItemAndChildren', mergeStrategy: 'OverrideExistingItem' },
        { itemPath: '/c', scope: 'ItemAndDescendants', mergeStrategy: 'KeepExistingItem' },
      ]);
      // Whatever it maps to, a row's merge is one its scope offers.
      for (const t of trees) expect(mergesFor(t.scope).map((m) => m.value)).toContain(t.mergeStrategy);
    });

    it('matches values ignoring case', () => {
      const { trees } = load({ name: 'a', path: '/a', scope: 'singleItem', allowedPushOperations: 'createOnly', database: 'Master' });
      expect(trees).toEqual([{ itemPath: '/a', scope: 'SingleItem', mergeStrategy: 'KeepExistingItem' }]);
    });

    it('adds DescendantsOnly as everything below with its push operations, and says it brings the item too', () => {
      const { trees, note } = load(
        { name: 'a', path: '/a', scope: 'DescendantsOnly' },
        { name: 'b', path: '/b', scope: 'DescendantsOnly', allowedPushOperations: 'CreateAndUpdate' },
        { name: 'c', path: '/c' },
      );
      // Updates to existing descendants are what the module asks for, so they aren't turned into Keep what's there.
      expect(trees.map((t) => [t.scope, t.mergeStrategy])).toEqual([
        ['ItemAndDescendants', 'OverrideExistingTree'],
        ['ItemAndDescendants', 'OverrideExistingItem'],
        ['ItemAndDescendants', 'OverrideExistingTree'],
      ]);
      expect(note).toBe(
        "Loaded 3 items from Project.module.json. 2 were descendants only, so they were added as + Everything below, which also brings the item itself.",
      );
    });

    it('skips ignored includes, other databases and includes it cannot read, and counts them', () => {
      const { trees, note } = load(
        { name: 'a', path: '/a' },
        { name: 'b', path: '/b', scope: 'Ignored' },
        { name: 'c', path: '/c', database: 'core' },
        { name: 'd', path: '/d', scope: 'Everything' },
        { name: 'e', path: '/e', allowedPushOperations: 'Nope' },
        { name: 'f' },
        null,
      );
      expect(trees).toEqual([newTree('/a')]);
      expect(note).toBe('Loaded 1 item from Project.module.json. Skipped 6 (ignored, not in master or not valid).');
    });

    it('does not support rules: loads the whole path and says how many had them', () => {
      const rules = [{ path: 'Sub', scope: 'Ignored' }];
      const { trees, note } = load({ name: 'a', path: '/a', rules }, { name: 'b', path: '/b', rules }, { name: 'c', path: '/c', rules: [] }, { name: 'd', path: '/d' });
      expect(trees.map((t) => t.itemPath)).toEqual(['/a', '/b', '/c', '/d']);
      expect(note).toBe('Loaded 4 items from Project.module.json. 2 had rules, so their whole trees were added.');
      expect(load({ name: 'a', path: '/a', rules }).note).toBe('Loaded 1 item from Project.module.json. 1 had rules, so its whole tree was added.');
    });

    it('names everything it skipped or approximated in one line', () => {
      const { note } = load(
        { name: 'a', path: '/a', rules: [{ path: 'x', scope: 'Ignored' }] },
        { name: 'b', path: '/b', scope: 'DescendantsOnly' },
        { name: 'c', path: '/c', scope: 'Ignored' },
      );
      expect(note).toBe(
        "Loaded 2 items from Project.module.json. Skipped 1 (ignored, not in master or not valid). 1 had rules, so its whole tree was added. 1 was descendants only, so it was added as + Everything below, which also brings the item itself.",
      );
    });

    it('lists a path once, and trims it', () => {
      expect(load({ name: 'a', path: ' /a ' }, { name: 'b', path: '/a/' }).trees).toEqual([newTree('/a')]);
    });

    it('refuses a module with nothing to load, saying why', () => {
      expect(() => load()).toThrow('No items to load from Project.module.json.');
      expect(() => load({ name: 'a', path: '/a', scope: 'Ignored' }, { name: 'b', path: '/b', database: 'core' })).toThrow(
        'No items to load from Project.module.json. Skipped 2 (ignored, not in master or not valid).',
      );
    });

    it('rejects text that is not JSON', () => {
      expect(() => parseQueueFile('not json', 'Project.module.json')).toThrow();
    });
  });
});
