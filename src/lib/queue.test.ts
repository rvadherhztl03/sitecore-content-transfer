// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mergeTrees, newTree, parseQueueJson } from '@/lib/queue';

describe('queue', () => {
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
