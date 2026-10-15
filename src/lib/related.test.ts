// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { addRelated, referencesIn, scanRelated, type RelatedItem } from '@/lib/related';
import type { DataTree } from '@/lib/transfer';
import { fakeClient, relatedReply, type RelatedFake } from '@/test/fakeClient';

const DEV = { id: 'd', name: 'Dev', contextId: 'ctx-dev' };
const QA = { id: 'q', name: 'QA', contextId: 'ctx-qa' };
const GQL = 'xmc.authoring.graphql';
const HOME = '/sitecore/content/Acme/Home';

const HERO_ID = '11111111-2222-3333-4444-555555555555';
const PROMO_ID = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
const RENDERING_ID = '99999999-0000-0000-0000-000000000000';

describe('referencesIn', () => {
  it('finds item IDs in any form and content or media paths', () => {
    const layout = `<r><d><r uid="{1}" s:id="{${RENDERING_ID}}" s:ds="{${HERO_ID}}" /><r s:ds="/sitecore/content/Acme/Data/Promo" /><r s:ds="local:/Data/Text" /></d></r>`;
    expect(referencesIn(layout)).toEqual({ ids: [RENDERING_ID.toLowerCase(), HERO_ID.toLowerCase()], paths: ['/sitecore/content/Acme/Data/Promo'] });
    expect(referencesIn(`{${HERO_ID}}|${PROMO_ID.toLowerCase()}`).ids).toEqual([HERO_ID.toLowerCase(), PROMO_ID.toLowerCase()]);
    // Rich text links and media URLs use the 32-digit form.
    expect(referencesIn(`<a href="~/link.aspx?_id=${HERO_ID.replace(/-/g, '')}&amp;_z=z">x</a><img src="-/media/${PROMO_ID.replace(/-/g, '')}.ashx" />`).ids).toEqual([
      HERO_ID.toLowerCase(),
      PROMO_ID.toLowerCase(),
    ]);
    expect(referencesIn('<image mediaid="{' + HERO_ID + '}" />').ids).toEqual([HERO_ID.toLowerCase()]);
    expect(referencesIn('/sitecore/media library/Acme/Hero banner').paths).toEqual(['/sitecore/media library/Acme/Hero banner']);
    expect(referencesIn('plain text, /sitecore/templates/Page, nothing else')).toEqual({ ids: [], paths: [] });
  });
});

type Item = RelatedFake;
const world = relatedReply;

const row = (itemPath: string, scope: DataTree['scope'] = 'SingleItem'): DataTree => ({ itemPath, scope, mergeStrategy: 'OverrideExistingItem' });

describe('scanRelated', () => {
  const SOURCE: Item[] = [
    {
      id: 'h',
      path: HOME,
      fields: { Image: `<image mediaid="{${HERO_ID}}" />`, Links: `{${PROMO_ID}}` },
      renderings: `<r s:id="{${RENDERING_ID}}" s:ds="/sitecore/content/Acme/Data/Shared" />`,
      final: `<r s:ds="{${'12345678-0000-0000-0000-00000000000a'}}" />`,
    },
    { id: HERO_ID, path: '/sitecore/media library/Acme/Hero', name: 'Hero' },
    { id: PROMO_ID, path: '/sitecore/content/Acme/Data/Promo', name: 'Promo' },
    { id: 's', path: '/sitecore/content/Acme/Data/Shared', name: 'Shared' },
    { id: '12345678-0000-0000-0000-00000000000a', path: '/sitecore/content/Acme/Data/Banner', name: 'Banner' },
    { id: RENDERING_ID, path: '/sitecore/layout/Renderings/Hero', name: 'Hero rendering' },
  ];
  async function scan(trees: DataTree[], target: Item[], source = SOURCE) {
    const { client, calls } = fakeClient({ [GQL]: world({ 'ctx-dev': source, 'ctx-qa': target }) });
    return { related: await scanRelated(client, DEV, QA, trees), calls };
  }

  it('lists the content and media the items use, with who uses them and whether the target has them', async () => {
    const { related } = await scan([row(HOME)], [
      { id: HERO_ID, path: '/sitecore/media library/Acme/Hero' },
      { id: 'different', path: '/sitecore/content/Acme/Data/Promo' },
    ]);
    expect(related).toEqual<RelatedItem[]>([
      { itemPath: '/sitecore/media library/Acme/Hero', name: 'Hero', usedBy: [HOME], onTarget: 'same' },
      { itemPath: '/sitecore/content/Acme/Data/Promo', name: 'Promo', usedBy: [HOME], onTarget: 'other' },
      { itemPath: '/sitecore/content/Acme/Data/Banner', name: 'Banner', usedBy: [HOME], onTarget: 'new' },
      { itemPath: '/sitecore/content/Acme/Data/Shared', name: 'Shared', usedBy: [HOME], onTarget: 'new' },
    ]);
  });

  it('reads the source for fields and references, and only the target for presence', async () => {
    const { calls } = await scan([row(HOME)], []);
    const lookups = calls.filter((c) => c.key === GQL) as any[];
    expect(lookups.map((c) => c.params.query.sitecoreContextId)).toEqual(['ctx-dev', 'ctx-dev', 'ctx-qa']);
    expect(lookups[0].params.body.query).toContain('fields(excludeStandardFields: true)');
    expect(lookups[0].params.body.query).toContain('field(name: "__Final Renderings")');
    for (const c of lookups) expect(c.params.body.query).toContain('database: "master"');
  });

  it('skips what the list brings along and the items themselves', async () => {
    const { related } = await scan([row(HOME), row('/sitecore/content/Acme/Data', 'ItemAndDescendants')], []);
    expect(related.map((r) => r.itemPath)).toEqual(['/sitecore/media library/Acme/Hero']);
  });

  it('collects every item that uses a reference', async () => {
    const other = { id: 'o', path: '/sitecore/content/Acme/Other', fields: { Image: `{${HERO_ID}}` } };
    const { related } = await scan([row(HOME), row(other.path)], [], [...SOURCE, other]);
    expect(related.find((r) => r.itemPath === '/sitecore/media library/Acme/Hero')!.usedBy).toEqual([HOME, other.path]);
  });

  it('asks nothing more when the items reference nothing', async () => {
    const { related, calls } = await scan([row('/sitecore/content/Acme/Plain')], [], [{ id: 'p', path: '/sitecore/content/Acme/Plain', fields: { Title: 'Hello' } }]);
    expect(related).toEqual([]);
    expect(calls.filter((c) => c.key === GQL)).toHaveLength(1);
  });
});

describe('addRelated', () => {
  const r = (itemPath: string, onTarget: RelatedItem['onTarget']): RelatedItem => ({ itemPath, name: itemPath, usedBy: [HOME], onTarget });

  it('adds the items the target lacks, once, as single items kept if they exist by then', () => {
    const trees = [row(HOME), row('/sitecore/content/Acme/Data/Banner')];
    expect(addRelated(trees, [r('/sitecore/media library/Acme/Hero', 'new'), r('/sitecore/content/Acme/Data/Banner', 'new'), r('/x', 'same'), r('/y', 'other')])).toEqual([
      ...trees,
      { itemPath: '/sitecore/media library/Acme/Hero', scope: 'SingleItem', mergeStrategy: 'KeepExistingItem' },
    ]);
  });
});
