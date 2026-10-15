// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { compareTrees, rowsFor, type CompareItem } from '@/lib/compare';
import { compareReply, fakeClient, type CompareFake } from '@/test/fakeClient';

const DEV = { id: 'd', name: 'Dev', contextId: 'ctx-dev' };
const QA = { id: 'q', name: 'QA', contextId: 'ctx-qa' };
const GQL = 'xmc.authoring.graphql';
const R = '/sitecore/content/Acme';

// Source and target as path → item; children come from the paths themselves.
const SOURCE: Record<string, CompareFake> = {
  [R]: { id: 'root', rev: 'r1' },
  [`${R}/Home`]: { id: 'home', rev: 'r2', updated: '20261015T100000Z' },
  [`${R}/Home/About`]: { id: 'about', rev: 'r1' },
  [`${R}/Home/News`]: { id: 'news', rev: 'r1' },
  [`${R}/Home/News/Launch`]: { id: 'launch', rev: 'r1' },
  [`${R}/Data`]: { id: 'data', rev: 'r1', updated: '20261001T000000Z' },
  [`${R}/Footer`]: { id: 'footer', rev: 'r1' },
};
const TARGET: Record<string, CompareFake> = {
  [R]: { id: 'root', rev: 'r1' },
  [`${R}/Home`]: { id: 'home', rev: 'r1', updated: '20261001T000000Z' },
  [`${R}/Home/About`]: { id: 'about', rev: 'r1' },
  [`${R}/Data`]: { id: 'data', rev: 'r9', updated: '20261014T000000Z' },
  [`${R}/Footer`]: { id: 'another-footer', rev: 'r1' },
  [`${R}/Old`]: { id: 'old', rev: 'r1' },
  [`${R}/Old/Page`]: { id: 'old-page', rev: 'r1' },
};

function setup(source = SOURCE, target = TARGET) {
  const { client, calls } = fakeClient({ [GQL]: compareReply({ 'ctx-dev': source, 'ctx-qa': target }) });
  return { client, calls };
}
const brief = (items: CompareItem[]) => items.map((i) => [i.path.slice(R.length) || '/', i.status, i.newer ?? '', i.depth]);

describe('compareTrees', () => {
  it('compares both trees item by item, in tree order', async () => {
    const { client } = setup();
    const { items, truncated } = await compareTrees(client, DEV, QA, R);
    expect(truncated).toBe(false);
    expect(brief(items)).toEqual([
      ['/', 'same', '', 0],
      ['/Data', 'changed', 'target', 1],
      ['/Footer', 'other', '', 1],
      ['/Home', 'changed', 'source', 1],
      ['/Home/About', 'same', '', 2],
      ['/Home/News', 'new', '', 2],
      ['/Home/News/Launch', 'new', '', 3],
      ['/Old', 'onlyTarget', '', 1],
      ['/Old/Page', 'onlyTarget', '', 2],
    ]);
    expect(items.find((i) => i.path === `${R}/Home`)).toMatchObject({ name: 'Home', source: { id: 'home', revision: 'r2' }, target: { id: 'home', revision: 'r1' } });
  });

  it('reads each side only under the items it has, a level at a time', async () => {
    const { client, calls } = setup();
    await compareTrees(client, DEV, QA, R);
    const asked = (ctx: string) =>
      (calls.filter((c) => c.key === GQL && c.params.query.sitecoreContextId === ctx) as any[]).map((c) =>
        [...(c.params.body.query as string).matchAll(/path: "([^"]+)"/g)].map((m) => m[1].slice(R.length) || '/'),
      );
    // The root, then the children of each level's items on that side.
    expect(asked('ctx-dev')).toEqual([['/'], ['/'], ['/Home', '/Data', '/Footer'], ['/Home/About', '/Home/News'], ['/Home/News/Launch']]);
    expect(asked('ctx-qa')).toEqual([['/'], ['/'], ['/Home', '/Data', '/Footer', '/Old'], ['/Home/About', '/Old/Page']]);
    for (const c of calls as any[]) {
      expect(c.params.body.query).toContain('database: "master"');
      expect(c.params.body.query).toContain('field(name: "__Revision")');
    }
  });

  it('stops at the limit and says so', async () => {
    const { client } = setup();
    const progress: number[] = [];
    const { items, truncated } = await compareTrees(client, DEV, QA, R, { limit: 3, onProgress: (n) => progress.push(n) });
    expect(items).toHaveLength(3);
    expect(truncated).toBe(true);
    expect(progress).toEqual([1, 3]);
  });

  it('stops when asked', async () => {
    const { client } = setup();
    const ctrl = new AbortController();
    await expect(compareTrees(client, DEV, QA, R, { signal: ctrl.signal, onProgress: () => ctrl.abort() })).rejects.toThrow();
  });

  it('says when neither environment has the starting point', async () => {
    const { client } = setup();
    await expect(compareTrees(client, DEV, QA, '/sitecore/content/Nope')).rejects.toThrow("/sitecore/content/Nope isn't on Dev or QA.");
  });
});

describe('rowsFor', () => {
  const item = (rel: string, status: CompareItem['status']): CompareItem => ({ path: `${R}${rel}`, name: rel.split('/').pop()!, depth: rel.split('/').length - 1, status });
  const ITEMS = [
    item('/Data', 'changed'),
    item('/Home', 'changed'),
    item('/Home/News', 'new'),
    item('/Home/News/Launch', 'new'),
    item('/Home/News/Launch/Teaser', 'new'),
    item('/Home/Promo', 'new'),
    item('/Home/Promo/Child', 'new'),
  ];
  const rows = (...rel: string[]) => rowsFor(ITEMS, new Set(rel.map((r) => `${R}${r}`)));

  it('adds a new branch picked whole as one "+ Everything below" row, parents first', () => {
    expect(rows('/Home', '/Home/News', '/Home/News/Launch', '/Home/News/Launch/Teaser', '/Data')).toEqual([
      { itemPath: `${R}/Data`, scope: 'SingleItem', mergeStrategy: 'OverrideExistingItem' },
      { itemPath: `${R}/Home`, scope: 'SingleItem', mergeStrategy: 'OverrideExistingItem' },
      { itemPath: `${R}/Home/News`, scope: 'ItemAndDescendants', mergeStrategy: 'KeepExistingItem' },
    ]);
  });

  it('adds new items one by one when part of their branch was left out', () => {
    expect(rows('/Home/Promo')).toEqual([{ itemPath: `${R}/Home/Promo`, scope: 'SingleItem', mergeStrategy: 'KeepExistingItem' }]);
    expect(rows('/Home/News', '/Home/News/Launch')).toEqual([
      { itemPath: `${R}/Home/News`, scope: 'SingleItem', mergeStrategy: 'KeepExistingItem' },
      { itemPath: `${R}/Home/News/Launch`, scope: 'SingleItem', mergeStrategy: 'KeepExistingItem' },
    ]);
  });
});
