// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MERGES, SCOPES, labelOf, mergeTrees, nameOf, newTree, parseQueueJson } from '@/lib/queue';

describe('queue', () => {
  it('uses the plain-language labels', () => {
    expect(SCOPES).toEqual([
      { value: 'SingleItem', label: 'This item', long: 'This item only' },
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
    expect(parseQueueJson('[{"path":"/a","scope":"ItemAndChildren","strategy":"Nope"}]')).toEqual([newTree('/a')]);
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
