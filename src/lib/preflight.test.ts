// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { addMissingParents, parentsOf, removeNotFound, runPreflight, type ItemCheck } from '@/lib/preflight';
import type { DataTree } from '@/lib/transfer';
import { fakeClient, preflightReply } from '@/test/fakeClient';

const DEV = { id: 'd', name: 'Dev', contextId: 'ctx-dev' };
const QA = { id: 'q', name: 'QA', contextId: 'ctx-qa' };
const GQL = 'xmc.authoring.graphql';
const ACME = '/sitecore/content/Acme';
const HOME = `${ACME}/Home`;

type Node = { id: string; children?: { id: string; name: string }[] };
type World = Record<string, Record<string, Node>>;

const gql = (world: World) => preflightReply((ctx, path) => world[ctx][path]);

const tree = (itemPath: string, scope: DataTree['scope'] = 'SingleItem', mergeStrategy: DataTree['mergeStrategy'] = 'OverrideExistingItem'): DataTree => ({
  itemPath,
  scope,
  mergeStrategy,
});
// Both environments have the standard roots with the same IDs.
const ROOTS = { '/sitecore/content': { id: 'content' } };

async function check(trees: DataTree[], source: Record<string, Node>, target: Record<string, Node>) {
  const { client, calls } = fakeClient({ [GQL]: gql({ 'ctx-dev': { ...ROOTS, ...source }, 'ctx-qa': { ...ROOTS, ...target } }) });
  const checks = await runPreflight(client, DEV, QA, trees);
  return { checks, calls };
}

const OK: Omit<ItemCheck, 'itemPath'> = { onSource: true, onTarget: 'same', missingParents: [], otherParents: [], deleted: [] };

describe('parentsOf', () => {
  it('lists the parents below /sitecore, top down, ignoring a trailing slash', () => {
    expect(parentsOf(HOME)).toEqual(['/sitecore/content', ACME]);
    expect(parentsOf(`${HOME}/`)).toEqual(['/sitecore/content', ACME]);
    expect(parentsOf('/sitecore/content')).toEqual([]);
  });
});

describe('runPreflight', () => {
  it('reports the same item with all its parents on the target as fine', async () => {
    const { checks } = await check([tree(HOME)], { [ACME]: { id: 'a' }, [HOME]: { id: 'h' } }, { [ACME]: { id: 'a' }, [HOME]: { id: 'h' } });
    expect(checks.get(HOME)).toEqual({ itemPath: HOME, ...OK });
  });

  it('compares IDs ignoring braces, dashes and case', async () => {
    const id = 'AB12CD34-0000-0000-0000-000000000001';
    const { checks } = await check([tree(HOME)], { [ACME]: { id: 'a' }, [HOME]: { id } }, { [ACME]: { id: 'a' }, [HOME]: { id: `{${id.toLowerCase()}}` } });
    expect(checks.get(HOME)!.onTarget).toBe('same');
  });

  it('reports a new item and the parents the target lacks, top down', async () => {
    const page = `${HOME}/About`;
    const { checks } = await check([tree(page)], { [ACME]: { id: 'a' }, [HOME]: { id: 'h' }, [page]: { id: 'p' } }, {});
    expect(checks.get(page)).toEqual({ itemPath: page, ...OK, onTarget: 'new', missingParents: [ACME, HOME] });
  });

  it('reports a different item at the same path, and a parent with a different ID', async () => {
    const { checks } = await check([tree(HOME)], { [ACME]: { id: 'a' }, [HOME]: { id: 'h' } }, { [ACME]: { id: 'other-a' }, [HOME]: { id: 'other-h' } });
    expect(checks.get(HOME)).toEqual({ itemPath: HOME, ...OK, onTarget: 'other', otherParents: [ACME] });
  });

  it('reports an item missing on the source, and checks nothing else for it', async () => {
    const { checks } = await check([tree(HOME)], {}, {});
    expect(checks.get(HOME)).toEqual({ itemPath: HOME, ...OK, onSource: false, onTarget: 'new' });
  });

  it('lists the target-only children that replacing everything below would delete', async () => {
    const children = (...names: string[]) => names.map((name) => ({ id: name.toLowerCase(), name }));
    const { checks } = await check(
      [tree(HOME, 'ItemAndDescendants', 'OverrideExistingTree')],
      { [ACME]: { id: 'a' }, [HOME]: { id: 'h', children: children('About', 'News') } },
      { [ACME]: { id: 'a' }, [HOME]: { id: 'h', children: children('About', 'Old promo', 'Test page') } },
    );
    expect(checks.get(HOME)!.deleted).toEqual(['Old promo', 'Test page']);
  });

  it('asks each environment once, for each path once, and only replace rows for children', async () => {
    const other = `${ACME}/Other`;
    const { calls } = await check(
      [tree(HOME, 'ItemAndDescendants', 'OverrideExistingTree'), tree(other)],
      { [ACME]: { id: 'a' }, [HOME]: { id: 'h' }, [other]: { id: 'o' } },
      { [ACME]: { id: 'a' }, [HOME]: { id: 'h' }, [other]: { id: 'o' } },
    );
    const lookups = calls.filter((c) => c.key === GQL) as any[];
    expect(lookups.map((c) => c.params.query.sitecoreContextId)).toEqual(['ctx-dev', 'ctx-qa']);
    for (const c of lookups) {
      const paths = Object.entries(c.params.body.variables as Record<string, string>);
      expect(paths.filter(([k]) => k.startsWith('p')).map(([, v]) => v).sort()).toEqual(['/sitecore/content', ACME, other, HOME].sort());
      expect(paths.filter(([k]) => k.startsWith('c')).map(([, v]) => v)).toEqual([HOME]);
      expect(c.params.body.query).toContain('database: "master"');
    }
  });

  it('does not report a parent the list itself brings along', async () => {
    const SITE = '/sitecore/content/Site';
    const section = `${ACME}/Section`;
    const paths = [ACME, HOME, section, `${section}/Deep`, `${section}/Deep/Page`, SITE, `${SITE}/Page`, `${SITE}/Page/Sub`, `${SITE}/Page/Sub/Deeper`];
    const { checks } = await check(
      [
        tree(ACME),
        tree(HOME), // Acme is in the list
        tree(section, 'ItemAndDescendants'),
        tree(`${section}/Deep/Page`), // Section brings everything below it
        tree(SITE, 'ItemAndChildren'),
        tree(`${SITE}/Page/Sub`), // Site brings its children, so Site/Page
        tree(`${SITE}/Page/Sub/Deeper`), // ...but not Site/Page/Sub's own parent chain below that
      ],
      Object.fromEntries(paths.map((p) => [p, { id: p }])),
      {},
    );
    expect(checks.get(ACME)!.missingParents).toEqual([]);
    expect(checks.get(HOME)!.missingParents).toEqual([]);
    expect(checks.get(`${section}/Deep/Page`)!.missingParents).toEqual([]);
    expect(checks.get(`${SITE}/Page/Sub`)!.missingParents).toEqual([]);
    expect(checks.get(`${SITE}/Page/Sub/Deeper`)!.missingParents).toEqual([]); // Site/Page/Sub is itself in the list
  });

  it('still reports a grandchild of a + Children item as a missing parent', async () => {
    const SITE = '/sitecore/content/Site';
    const paths = [SITE, `${SITE}/Page`, `${SITE}/Page/Sub`, `${SITE}/Page/Sub/Deeper`];
    const { checks } = await check(
      [tree(SITE, 'ItemAndChildren'), tree(`${SITE}/Page/Sub/Deeper`)],
      Object.fromEntries(paths.map((p) => [p, { id: p }])),
      {},
    );
    expect(checks.get(`${SITE}/Page/Sub/Deeper`)!.missingParents).toEqual([`${SITE}/Page/Sub`]);
  });
});

describe('fixes', () => {
  const page = `${HOME}/About`;
  const checks = new Map<string, ItemCheck>([
    [page, { itemPath: page, ...OK, onTarget: 'new', missingParents: [ACME, HOME] }],
    [`${HOME}/News`, { itemPath: `${HOME}/News`, ...OK, onTarget: 'new', missingParents: [ACME, HOME] }],
    ['/gone', { itemPath: '/gone', ...OK, onSource: false, onTarget: 'new' }],
  ]);

  it('addMissingParents puts each missing parent once, as a single item kept if it exists, before the first item that needs it', () => {
    const trees = [tree('/sitecore/content/Other'), tree(page, 'ItemAndDescendants'), tree(`${HOME}/News`), tree('/gone')];
    expect(addMissingParents(trees, checks)).toEqual([
      tree('/sitecore/content/Other'),
      tree(ACME, 'SingleItem', 'KeepExistingItem'),
      tree(HOME, 'SingleItem', 'KeepExistingItem'),
      tree(page, 'ItemAndDescendants'),
      tree(`${HOME}/News`),
      tree('/gone'),
    ]);
  });

  it('addMissingParents leaves a parent that is already in the list where it is', () => {
    const trees = [tree(page), tree(HOME, 'ItemAndDescendants')];
    expect(addMissingParents(trees, checks)).toEqual([tree(ACME, 'SingleItem', 'KeepExistingItem'), tree(page), tree(HOME, 'ItemAndDescendants')]);
  });

  it('removeNotFound drops the items the source does not have', () => {
    expect(removeNotFound([tree(page), tree('/gone')], checks)).toEqual([tree(page)]);
  });
});
