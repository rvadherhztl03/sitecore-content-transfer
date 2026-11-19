/* eslint-disable @typescript-eslint/no-explicit-any */
import { usePreflights, type Preflight } from '@/components/transfer/usePreflight';
import type { Env } from '@/lib/sdk';
import type { DataTree } from '@/lib/transfer';
import { fakeClient, preflightReply, relatedReply, type FakeReply } from '@/test/fakeClient';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const DEV: Env = { id: 'd', name: 'Dev', contextId: 'ctx-dev' };
const QA: Env = { id: 'q', name: 'QA', contextId: 'ctx-qa' };
const UAT: Env = { id: 'u', name: 'UAT', contextId: 'ctx-uat' };
const GQL = 'xmc.authoring.graphql';
const HOME = '/sitecore/content/Acme/Home';
const NEWS = '/sitecore/content/Acme/News';

const row = (itemPath: string): DataTree => ({ itemPath, scope: 'SingleItem', mergeStrategy: 'OverrideExistingItem' });
const lang = (name: string) => ({ name, iso: name.split('-')[0], englishName: name });
const done = (p: Preflight | undefined) => (p?.status === 'done' ? p : undefined);

// A world where both environments have every item, the source has French and German, and the targets lack them.
function world() {
  const state = {
    targetLanguages: [lang('en')],
    locked: [] as string[],
    // What a query for these paths waits for first, to put results in a chosen order.
    gates: {} as Record<string, Promise<void>>,
    fail: new Set<string>(),
  };
  const aliases = (p: any) => [...(p.body.query as string).matchAll(/(\w+): item\(where: \{ path: ("[^"]*")/g)].map(([, alias, path]) => [alias, JSON.parse(path)] as const);
  const { client, calls } = fakeClient({
    'xmc.sites.listLanguages': (p) => (state.fail.has('languages') ? { status: 500, error: { title: 'No languages' } } : { data: p.query.sitecoreContextId === 'ctx-dev' ? [lang('en'), lang('fr-FR'), lang('de-DE')] : state.targetLanguages }),
    [GQL]: async (p): Promise<FakeReply> => {
      const query: string = p.body.query;
      if (query.startsWith('query Preflight')) return preflightReply((_, path) => ({ id: path }))(p);
      if (/^query (Related|Definitions)/.test(query)) return relatedReply({})(p);
      if (state.fail.has(query.split(' ')[1])) return { data: { errors: [{ message: 'Cannot query field' }] } };
      const data: Record<string, unknown> = {};
      for (const [alias, path] of aliases(p)) {
        await state.gates[path];
        data[alias] = query.startsWith('query LocksOnTarget')
          ? { lock: { isLocked: state.locked.includes(path), lockedBy: 'sitecore\\jane' } }
          : { workflow: { workflowState: { displayName: 'Draft', final: false } } };
      }
      return { data: { data } };
    },
  });
  return { state, client, calls };
}

const hook = (client: ReturnType<typeof world>['client'], targets: Env[], trees: DataTree[]) =>
  renderHook((props) => usePreflights(client, DEV, targets, props.trees), { initialProps: { trees } });
const settled = (result: { current: Record<string, Preflight> | undefined }, ...targets: Env[]) =>
  waitFor(() => expect(targets.map((t) => result.current?.[t.id]?.status)).toEqual(targets.map(() => 'done')));

describe('usePreflights side scans', () => {
  it('runs the language, lock and workflow scans for each target alongside the check', async () => {
    const { client, state } = world();
    state.locked = [HOME];
    const { result } = hook(client, [QA, UAT], [row(HOME), row(NEWS)]);
    expect(result.current).toEqual({ [QA.id]: { status: 'checking' }, [UAT.id]: { status: 'checking' } });
    await settled(result, QA, UAT);
    for (const t of [QA, UAT]) {
      expect(done(result.current![t.id])).toMatchObject({
        languages: [
          { code: 'fr-FR', body: { languageCode: 'fr', regionCode: 'FR' } },
          { code: 'de-DE', body: { languageCode: 'de', regionCode: 'DE' } },
        ],
        locked: [{ itemPath: HOME, lockedBy: 'sitecore\\jane' }],
        unapproved: [
          { itemPath: HOME, state: 'Draft' },
          { itemPath: NEWS, state: 'Draft' },
        ],
      });
    }
  });

  it('reports a scan that fails without failing the check or the other scans', async () => {
    const { client, state } = world();
    state.fail = new Set(['LocksOnTarget', 'languages']);
    const { result } = hook(client, [QA], [row(HOME)]);
    await settled(result, QA);
    const qa = done(result.current![QA.id])!;
    expect(qa.lockedError).toBe('Cannot query field');
    expect(qa.languagesError).toBe('HTTP 500: No languages');
    expect(qa.locked).toBeUndefined();
    expect(qa.languages).toBeUndefined();
    expect(qa.checks.get(HOME)?.onSource).toBe(true);
    expect(qa.unapproved).toEqual([{ itemPath: HOME, state: 'Draft' }]);
    expect(qa.unapprovedError).toBeUndefined();

    const failing = world();
    failing.state.fail = new Set(['WorkflowOnSource']);
    const second = hook(failing.client, [QA], [row(HOME)]);
    await settled(second.result, QA);
    expect(done(second.result.current![QA.id])).toMatchObject({ unapprovedError: 'Cannot query field', locked: [] });
  });
});

describe('usePreflights recheck', () => {
  it('checks one target again, keeping its result until the new one is ready', async () => {
    const { client, state, calls } = world();
    const { result } = hook(client, [QA, UAT], [row(HOME)]);
    await settled(result, QA, UAT);
    const before = result.current![QA.id];
    const untouched = result.current![UAT.id];
    expect(done(before)?.languages).toHaveLength(2);
    const lookups = (ctx: string) => calls.filter((c) => c.key === 'xmc.sites.listLanguages' && c.params.query.sitecoreContextId === ctx).length;
    expect([lookups('ctx-qa'), lookups('ctx-uat')]).toEqual([1, 1]);

    // The languages get added, and the rerun waits at the workflow lookup.
    state.targetLanguages = [lang('en'), lang('fr-FR'), lang('de-DE')];
    let release!: () => void;
    state.gates[HOME] = new Promise<void>((resolve) => (release = resolve));
    let rechecked!: Promise<void>;
    act(() => {
      rechecked = done(before)!.recheck!();
    });
    await waitFor(() => expect(lookups('ctx-qa')).toBe(2));
    expect(result.current![QA.id]).toBe(before);

    await act(async () => {
      release();
      await rechecked;
    });
    expect(done(result.current![QA.id])?.languages).toEqual([]);
    expect(done(result.current![QA.id])?.recheck).toEqual(expect.any(Function));
    // The other target kept its result, and wasn't asked again.
    expect(result.current![UAT.id]).toBe(untouched);
    expect([lookups('ctx-qa'), lookups('ctx-uat')]).toEqual([2, 1]);
  });

  it('drops a recheck that finishes after the list changed', async () => {
    const { client, state } = world();
    const { result, rerender } = hook(client, [QA], [row(HOME)]);
    await settled(result, QA);
    const first = done(result.current![QA.id])!;

    // The old list's recheck waits at HOME; the new list's check waits at NEWS.
    let releaseOld!: () => void;
    let releaseNew!: () => void;
    state.gates[HOME] = new Promise<void>((resolve) => (releaseOld = resolve));
    state.gates[NEWS] = new Promise<void>((resolve) => (releaseNew = resolve));
    let rechecked!: Promise<void>;
    act(() => {
      rechecked = first.recheck!();
    });
    rerender({ trees: [row(NEWS)] });
    expect(result.current).toEqual({ [QA.id]: { status: 'checking' } });

    await act(async () => releaseNew());
    await settled(result, QA);
    await act(async () => {
      releaseOld();
      await rechecked;
    });
    expect(done(result.current![QA.id])?.unapproved).toEqual([{ itemPath: NEWS, state: 'Draft' }]);
  });
});
