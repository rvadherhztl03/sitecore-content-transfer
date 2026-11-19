// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { addLanguages, scanLanguages, scanLocks, scanWorkflow, type MissingLanguage } from '@/lib/checks';
import type { DataTree } from '@/lib/transfer';
import { fakeClient, type FakeReply } from '@/test/fakeClient';

const DEV = { id: 'd', name: 'Dev', contextId: 'ctx-dev' };
const QA = { id: 'q', name: 'QA', contextId: 'ctx-qa' };
const GQL = 'xmc.authoring.graphql';
const HOME = '/sitecore/content/Acme/Home';
const NEWS = '/sitecore/content/Acme/News';

const row = (itemPath: string, mergeStrategy: DataTree['mergeStrategy'] = 'OverrideExistingItem'): DataTree => ({ itemPath, scope: 'SingleItem', mergeStrategy });

/** Answers each `i<n>` alias of a lookup by path from a map of path → what that item returns. */
const byPath = (items: Record<string, unknown>) => (p: any): FakeReply => {
  const data: Record<string, unknown> = {};
  for (const [, alias, literal] of (p.body.query as string).matchAll(/(\w+): item\(where: \{ path: ("[^"]*")/g)) data[alias] = items[JSON.parse(literal)] ?? null;
  return { data: { data } };
};

const language = (name: string, englishName: string, iso = name.split('-')[0]) => ({ name, iso, englishName, regionalIsoCode: name });
const EN = language('en', 'English');
const FR = language('fr-FR', 'French (France)');
const DE = language('de-DE', 'German (Germany)');

describe('scanLanguages', () => {
  const scan = (source: unknown[], target: unknown[]) => {
    const { client, calls } = fakeClient({ 'xmc.sites.listLanguages': (p) => ({ data: p.query.sitecoreContextId === 'ctx-dev' ? source : target }) });
    return scanLanguages(client, DEV, QA).then((missing) => ({ missing, calls }));
  };

  it('lists the source languages the target lacks, named and ready to add', async () => {
    const { missing, calls } = await scan([EN, FR, DE], [EN]);
    expect(missing).toEqual<MissingLanguage[]>([
      { code: 'fr-FR', label: 'French (fr-FR)', body: { languageCode: 'fr', regionCode: 'FR' } },
      { code: 'de-DE', label: 'German (de-DE)', body: { languageCode: 'de', regionCode: 'DE' } },
    ]);
    // Each environment's own list, once.
    expect(calls.map((c) => c.params.query.sitecoreContextId).sort()).toEqual(['ctx-dev', 'ctx-qa']);
  });

  it('finds nothing when the target has them all, ignoring case, and ignores the languages only the target has', async () => {
    expect((await scan([EN, FR], [language('FR-fr', 'French'), EN, DE])).missing).toEqual([]);
  });

  it('adds a language with no region by its code alone', async () => {
    const { missing } = await scan([EN, language('da', 'Danish')], [EN]);
    expect(missing).toEqual([{ code: 'da', label: 'Danish (da)', body: { languageCode: 'da' } }]);
  });

  it('keeps every part of a region code, and falls back to the code when the English name is missing', async () => {
    const { missing } = await scan([EN, { name: 'zh-Hans-CN', iso: 'zh' }], [EN]);
    expect(missing).toEqual([{ code: 'zh-Hans-CN', label: 'zh (zh-Hans-CN)', body: { languageCode: 'zh', regionCode: 'Hans-CN' } }]);
  });

  it('fails when an environment lists no languages, rather than calling every one missing', async () => {
    await expect(scan([EN, FR], [])).rejects.toThrow('QA listed no languages.');
    await expect(scan([], [EN])).rejects.toThrow('Dev listed no languages.');
  });

  it('fails with the error of a call that fails', async () => {
    const { client } = fakeClient({ 'xmc.sites.listLanguages': () => ({ status: 500, error: { title: 'Boom' } }) });
    await expect(scanLanguages(client, DEV, QA)).rejects.toThrow('HTTP 500: Boom');
  });
});

describe('addLanguages', () => {
  const [fr, de]: MissingLanguage[] = [
    { code: 'fr-FR', label: 'French (fr-FR)', body: { languageCode: 'fr', regionCode: 'FR' } },
    { code: 'de-DE', label: 'German (de-DE)', body: { languageCode: 'de', regionCode: 'DE' } },
  ];

  it('creates each language on the target, in order, and reports progress', async () => {
    const { client, calls } = fakeClient({ 'xmc.sites.createLanguage': () => ({ data: {} }) });
    const progress: number[] = [];
    expect(await addLanguages(client, QA, [fr, de], (n) => progress.push(n))).toEqual([]);
    expect(calls.map((c) => [c.kind, c.key, c.params.query.sitecoreContextId, c.params.body])).toEqual([
      ['mutate', 'xmc.sites.createLanguage', 'ctx-qa', fr.body],
      ['mutate', 'xmc.sites.createLanguage', 'ctx-qa', de.body],
    ]);
    expect(progress).toEqual([1, 2]);
  });

  it('carries on after one fails, and says which and why', async () => {
    const { client, calls } = fakeClient({
      'xmc.sites.createLanguage': (p) => (p.body.languageCode === 'fr' ? { status: 400, error: { title: 'Already exists' } } : { data: {} }),
    });
    expect(await addLanguages(client, QA, [fr, de])).toEqual([{ label: 'French (fr-FR)', error: 'HTTP 400: Already exists' }]);
    expect(calls).toHaveLength(2);
  });
});

describe('scanLocks', () => {
  const scan = (trees: DataTree[], target: Record<string, unknown>) => {
    const { client, calls } = fakeClient({ [GQL]: byPath(target) });
    return scanLocks(client, QA, trees).then((locked) => ({ locked, calls }));
  };

  it('lists the queued items that are locked on the target, and who holds the lock', async () => {
    const { locked } = await scan([row(HOME), row(NEWS)], {
      [HOME]: { lock: { isLocked: true, lockedBy: 'sitecore\\jane' } },
      [NEWS]: { lock: { isLocked: false, lockedBy: null } },
    });
    expect(locked).toEqual([{ itemPath: HOME, lockedBy: 'sitecore\\jane' }]);
  });

  it('asks the target once, for every row, by the lock fields the authoring API documents', async () => {
    const { calls } = await scan([row(HOME), row(NEWS)], {});
    expect(calls).toHaveLength(1);
    expect(calls[0].params.query.sitecoreContextId).toBe('ctx-qa');
    const query: string = calls[0].params.body.query;
    expect(query).toContain('lock { isLocked lockedBy }');
    expect(query).toContain('database: "master"');
    expect(query).toContain(JSON.stringify(HOME));
    expect(query).toContain(JSON.stringify(NEWS));
  });

  it('leaves out rows that keep what is there, and asks nothing when none overwrites', async () => {
    const lock = { lock: { isLocked: true, lockedBy: 'sitecore\\jane' } };
    const mixed = await scan([row(HOME, 'KeepExistingItem'), row(NEWS, 'OverrideExistingTree')], { [HOME]: lock, [NEWS]: lock });
    expect(mixed.locked.map((l) => l.itemPath)).toEqual([NEWS]);
    expect(mixed.calls[0].params.body.query).not.toContain(HOME);
    const none = await scan([row(HOME, 'KeepExistingItem')], { [HOME]: lock });
    expect(none).toEqual({ locked: [], calls: [] });
  });

  it('skips items the target does not have, and says nothing about an unnamed holder', async () => {
    const { locked } = await scan([row(HOME), row(NEWS)], { [NEWS]: { lock: { isLocked: true, lockedBy: '' } } });
    expect(locked).toEqual([{ itemPath: NEWS, lockedBy: undefined }]);
  });

  it('fails with the first GraphQL error', async () => {
    const { client } = fakeClient({ [GQL]: () => ({ data: { errors: [{ message: 'Cannot query field "lock"' }] } }) });
    await expect(scanLocks(client, QA, [row(HOME)])).rejects.toThrow('Cannot query field "lock"');
  });
});

describe('scanWorkflow', () => {
  const state = (displayName: string, final: boolean) => ({ workflow: { workflowState: { displayName, final } } });
  const scan = (trees: DataTree[], source: Record<string, unknown>) => {
    const { client, calls } = fakeClient({ [GQL]: byPath(source) });
    return scanWorkflow(client, DEV, trees).then((unapproved) => ({ unapproved, calls }));
  };

  it('lists the queued items in a state that is not final, with the state', async () => {
    const { unapproved } = await scan([row(HOME), row(NEWS)], { [HOME]: state('Draft', false), [NEWS]: state('Approved', true) });
    expect(unapproved).toEqual([{ itemPath: HOME, state: 'Draft' }]);
  });

  it('asks the source once, for every row, by the workflow fields', async () => {
    const { calls } = await scan([row(HOME), row(NEWS, 'KeepExistingItem')], {});
    expect(calls).toHaveLength(1);
    expect(calls[0].params.query.sitecoreContextId).toBe('ctx-dev');
    const query: string = calls[0].params.body.query;
    expect(query).toContain('workflow { workflowState { displayName final } }');
    expect(query).toContain('database: "master"');
    // Every row is read: what the source says doesn't depend on what the target does with it.
    expect(query).toContain(JSON.stringify(NEWS));
  });

  it('skips items without a workflow or a state, and items it does not find', async () => {
    const { unapproved } = await scan([row(HOME), row(NEWS), row('/sitecore/content/Acme/Gone'), row('/sitecore/content/Acme/Bare')], {
      [HOME]: { workflow: null },
      [NEWS]: { workflow: { workflowState: null } },
      '/sitecore/content/Acme/Bare': {},
    });
    expect(unapproved).toEqual([]);
  });

  it('names a state without a display name', async () => {
    const { unapproved } = await scan([row(HOME)], { [HOME]: { workflow: { workflowState: { displayName: null, final: false } } } });
    expect(unapproved).toEqual([{ itemPath: HOME, state: 'a non-final state' }]);
  });

  it('asks nothing for an empty list', async () => {
    expect(await scan([], {})).toEqual({ unapproved: [], calls: [] });
  });

  it('fails with the first GraphQL error', async () => {
    const { client } = fakeClient({ [GQL]: () => ({ data: { errors: [{ message: 'Cannot query field "workflow"' }] } }) });
    await expect(scanWorkflow(client, DEV, [row(HOME)])).rejects.toThrow('Cannot query field "workflow"');
  });
});
