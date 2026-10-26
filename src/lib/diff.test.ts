// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { fieldDiff } from '@/lib/diff';
import { fakeClient, fieldDiffReply } from '@/test/fakeClient';

const DEV = { id: 'd', name: 'Dev', contextId: 'ctx-dev' };
const QA = { id: 'q', name: 'QA', contextId: 'ctx-qa' };
const GQL = 'xmc.authoring.graphql';
const HOME = '/sitecore/content/Acme/Home';

function setup(source: Record<string, string> | undefined, target: Record<string, string> | undefined) {
  const { client, calls } = fakeClient({
    [GQL]: fieldDiffReply({ 'ctx-dev': source ? { [HOME]: source } : {}, 'ctx-qa': target ? { [HOME]: target } : {} }),
  });
  return { diff: () => fieldDiff(client, DEV, QA, HOME), calls };
}

describe('fieldDiff', () => {
  it('pairs the fields in source order, then the target-only ones, and flags the ones that differ', async () => {
    const { diff } = setup(
      { Title: 'Welcome', Text: '<p>New</p>', Summary: '', Image: '<image />' },
      { Text: '<p>Old</p>', Title: 'Welcome', Image: '<image />', Legacy: 'x' },
    );
    expect(await diff()).toEqual([
      { name: 'Title', source: 'Welcome', target: 'Welcome', changed: false },
      { name: 'Text', source: '<p>New</p>', target: '<p>Old</p>', changed: true },
      { name: 'Summary', source: '', target: undefined, changed: true },
      { name: 'Image', source: '<image />', target: '<image />', changed: false },
      { name: 'Legacy', source: undefined, target: 'x', changed: true },
    ]);
  });

  it('leaves out the fields every save changes', async () => {
    const { diff } = setup(
      { Title: 'A', __Revision: 'r2', __Updated: '20261015T000000Z', '__Updated by': 'sitecore\\ana', __Created: '20260101T000000Z' },
      { Title: 'A', __Revision: 'r1', __Updated: '20261001T000000Z', '__Updated by': 'sitecore\\bo', __Created: '20260101T000000Z' },
    );
    expect((await diff()).map((f) => [f.name, f.changed])).toEqual([
      ['Title', false],
      ['__Created', false],
    ]);
  });

  it('reads the item, standard fields included, once on each environment', async () => {
    const { diff, calls } = setup({ Title: 'A' }, { Title: 'A' });
    await diff();
    expect(calls.map((c: any) => c.params.query.sitecoreContextId).sort()).toEqual(['ctx-dev', 'ctx-qa']);
    for (const c of calls as any[]) {
      expect(c.params.body.query).toMatch(/^query FieldDiff/);
      expect(c.params.body.query).toContain(`item(where: { path: "${HOME}", database: "master" })`);
      expect(c.params.body.query).toContain('fields(excludeStandardFields: false) { nodes { name value } }');
    }
  });

  it('says which environment lacks the item', async () => {
    await expect(setup({ Title: 'A' }, undefined).diff()).rejects.toThrow(`${HOME} isn't on QA.`);
    await expect(setup(undefined, { Title: 'A' }).diff()).rejects.toThrow(`${HOME} isn't on Dev.`);
  });
});
