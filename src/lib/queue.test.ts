// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MERGES, SCOPES, labelOf, mergeTrees, mergesFor, nameOf, newTree, parseQueueJson, withScope } from '@/lib/queue';

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
      { value: 'LatestWin', label: 'Keep the newer one', long: 'Keep the newer one' },
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
      ['LatestWin', 'Keep the newer one'],
    ]);
    // + Children replaces the item and each child on its own, never anything deeper.
    expect(labels('ItemAndChildren')).toEqual([
      ['OverrideExistingItem', 'Replace it and its children'],
      ['KeepExistingItem', "Keep what's there"],
      ['LatestWin', 'Keep the newer one'],
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
    const keep = { ...newTree('/a'), mergeStrategy: 'LatestWin' as const };
    expect(withScope(keep, 'ItemAndChildren')).toEqual({ ...keep, scope: 'ItemAndChildren' });
  });

  it('mergeTrees dedupes by path', () => {
    const existing = [{ itemPath: '/a', scope: 'SingleItem' as const, mergeStrategy: 'LatestWin' as const }];
    expect(mergeTrees(existing, [newTree('/a/'), newTree('/b')])).toEqual([existing[0], newTree('/b')]);
  });

  it('parseQueueJson accepts an array, { dataTrees } and { items }', () => {
    const rows = [
      { path: '/a', scope: 'SingleItem', strategy: 'LatestWin' },
      { ItemPath: '/b', Scope: 'SingleItem', MergeStrategy: 'KeepExistingItem' },
      { itemPath: '/c', mergeStrategy: 'OverrideExistingItem' },
    ];
    const expected = [
      { itemPath: '/a', scope: 'SingleItem', mergeStrategy: 'LatestWin' },
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

  it('parseQueueJson never replaces everything below a single item', () => {
    expect(parseQueueJson('[{"path":"/a","scope":"SingleItem","strategy":"OverrideExistingTree"}]')).toEqual([
      { itemPath: '/a', scope: 'SingleItem', mergeStrategy: 'OverrideExistingItem' },
    ]);
  });

  it('parseQueueJson accepts ItemAndChildren, without replacing everything below', () => {
    expect(parseQueueJson('[{"path":"/a","scope":"ItemAndChildren"},{"path":"/b","scope":"ItemAndChildren","strategy":"LatestWin"}]')).toEqual([
      { itemPath: '/a', scope: 'ItemAndChildren', mergeStrategy: 'OverrideExistingItem' },
      { itemPath: '/b', scope: 'ItemAndChildren', mergeStrategy: 'LatestWin' },
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
});
