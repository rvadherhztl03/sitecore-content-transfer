// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import { HISTORY_PATH, addEntry, historyName, loadHistory, withHistory, type HistoryEntry } from '@/lib/history';
import type { RunCallbacks } from '@/lib/transfer';
import { fakeClient } from '@/test/fakeClient';
import { entriesIn, historyReply, historyStore } from '@/test/fakeHistory';

const DEV = { id: 'd', name: 'Dev', contextId: 'ctx-dev' };
const QA = { id: 'q', name: 'QA', contextId: 'ctx-qa' };
const PROD = { id: 'p', name: 'Prod', contextId: 'ctx-prod' };
const GQL = 'xmc.authoring.graphql';
const HOME = { itemPath: '/sitecore/content/Home', scope: 'ItemAndDescendants', mergeStrategy: 'OverrideExistingTree' } as const;
const USER = { id: 'u1', name: 'Jane Doe', email: 'jane@acme.com' };

const entry = (over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: 'a1b2c3d4',
  kind: 'transfer',
  at: '2026-11-19T14:32:00.000Z',
  source: 'Dev',
  target: 'QA',
  items: [HOME],
  result: 'success',
  ...over,
});

const callbacks = () => {
  const logs: [string, string][] = [];
  const cb: RunCallbacks = { onLog: (t, type) => logs.push([t, type]), onProgress: vi.fn(), onStepChange: vi.fn(), onInfo: vi.fn() };
  return { cb, logs };
};

describe('historyName', () => {
  it('names the item from the local date and time and a short id, with only characters Sitecore allows', () => {
    const name = historyName(new Date(2026, 10, 9, 8, 5), 'a1b2c3d4e5');
    expect(name).toBe('2026-11-09 0805 a1b2c3');
    // Sitecore's default ItemNameValidation.
    expect(name).toMatch(/^[\w*$][\w\s\-$]*(\(\d{1,}\))?$/);
  });
});

describe('addEntry', () => {
  it('creates the Content Transfer and History folders the first time, with the Folder template, then the entry', async () => {
    const store = historyStore('ctx-qa');
    const { client, calls } = fakeClient({ [GQL]: historyReply(store) });
    await addEntry(client, QA, entry());
    const creates = calls.filter((c) => c.params.body.query.startsWith('mutation')).map((c) => c.params.body.query as string);
    expect(creates).toHaveLength(3);
    for (const q of creates) expect(q).toContain('templateId: "{A87A00B1-E6DB-45AB-8B54-636FEC3B5523}"');
    expect(creates[0]).toContain('name: "Content Transfer", templateId: "{A87A00B1-E6DB-45AB-8B54-636FEC3B5523}", parent: "ctx-qa-modules"');
    expect(Object.keys(store['ctx-qa'])).toContain(HISTORY_PATH);
    expect(entriesIn(store, 'ctx-qa')).toEqual([entry()]);
    expect(creates[2]).toContain('fields: [{ name: "__Long description", value: ');
  });

  it('adds to an existing History folder without creating folders', async () => {
    const store = historyStore('ctx-qa');
    const { client } = fakeClient({ [GQL]: historyReply(store) });
    await addEntry(client, QA, entry({ id: 'first1' }));
    const { client: again, calls } = fakeClient({ [GQL]: historyReply(store) });
    await addEntry(again, QA, entry({ id: 'second' }));
    expect(calls.filter((c) => c.params.body.query.startsWith('mutation'))).toHaveLength(1);
    expect(entriesIn(store, 'ctx-qa').map((e) => e.id)).toEqual(['first1', 'second']);
  });

  it('keeps quotes, backslashes and new lines in the entry intact', async () => {
    const store = historyStore('ctx-qa');
    const { client } = fakeClient({ [GQL]: historyReply(store) });
    const odd = entry({ by: 'O"Brien \\ x\ny', items: [{ ...HOME, itemPath: '/sitecore/content/"Quoted"' }] });
    await addEntry(client, QA, odd);
    expect(entriesIn(store, 'ctx-qa')).toEqual([odd]);
  });

  it('fails when the target has no /sitecore/system/Modules', async () => {
    const { client } = fakeClient({ [GQL]: historyReply({}) });
    await expect(addEntry(client, QA, entry())).rejects.toThrow("/sitecore/system/Modules wasn't found.");
  });
});

describe('loadHistory', () => {
  it('lists the entries newest first and skips unreadable ones', async () => {
    const store = historyStore('ctx-qa');
    const { client } = fakeClient({ [GQL]: historyReply(store) });
    await addEntry(client, QA, entry({ id: 'older1', at: '2026-11-18T09:00:00.000Z' }));
    await addEntry(client, QA, entry({ id: 'newer1', at: '2026-11-19T09:00:00.000Z' }));
    store['ctx-qa'][`${HISTORY_PATH}/junk`] = { id: 'x', name: 'junk', value: 'not json' };
    store['ctx-qa'][`${HISTORY_PATH}/empty`] = { id: 'y', name: 'empty' };
    expect((await loadHistory(client, QA)).map((e) => e.id)).toEqual(['newer1', 'older1']);
  });

  it('has no runs when the History folder does not exist yet', async () => {
    const { client } = fakeClient({ [GQL]: historyReply(historyStore('ctx-qa')) });
    expect(await loadHistory(client, QA)).toEqual([]);
  });

  it('fails with the API error', async () => {
    const { client } = fakeClient({ [GQL]: () => ({ data: { errors: [{ message: 'Access denied' }] } }) });
    await expect(loadHistory(client, QA)).rejects.toThrow('Access denied');
  });
});

describe('withHistory', () => {
  // A transfer to QA then Prod: QA imports at step 2, Prod at step 5. `upTo` is the last step that starts.
  const fakeRun = (upTo: number, ok = upTo >= 5) => async (cb: RunCallbacks) => {
    for (let i = 0; i <= upTo; i++) cb.onStepChange(i, 'running');
    cb.onInfo?.({ chunkCount: 2, itemCount: 7 });
    return ok;
  };
  const record = { kind: 'transfer', source: DEV, targets: [QA, PROD], importAt: [2, 5], items: [HOME] } as const;

  it('records the run on every target whose import started, with who ran it and the package count', async () => {
    const store = historyStore('ctx-qa', 'ctx-prod');
    const { client } = fakeClient({ [GQL]: historyReply(store), 'host.user': () => ({ data: USER }) });
    const { cb } = callbacks();
    expect(await withHistory(client, record, fakeRun(6))(cb, new AbortController().signal)).toBe(true);
    await vi.waitFor(() => expect(entriesIn(store, 'ctx-prod')).toHaveLength(1));
    const [qa] = entriesIn(store, 'ctx-qa');
    expect(qa).toEqual({ ...qa, kind: 'transfer', by: 'Jane Doe', source: 'Dev', target: 'QA', items: [HOME], result: 'success', itemCount: 7 });
    expect(qa.tookMs).toBeGreaterThanOrEqual(0);
    expect(entriesIn(store, 'ctx-prod')[0]).toEqual({ ...qa, target: 'Prod' });
    // The callbacks still reach the run.
    expect(cb.onStepChange).toHaveBeenCalledWith(6, 'running');
    expect(cb.onInfo).toHaveBeenCalledWith({ chunkCount: 2, itemCount: 7 });
  });

  it('records a failed run only on the targets it got as far as the import on', async () => {
    const store = historyStore('ctx-qa', 'ctx-prod');
    const { client } = fakeClient({ [GQL]: historyReply(store), 'host.user': () => ({ data: USER }) });
    expect(await withHistory(client, record, fakeRun(4))(callbacks().cb, new AbortController().signal)).toBe(false);
    await vi.waitFor(() => expect(entriesIn(store, 'ctx-qa')).toHaveLength(1));
    expect(entriesIn(store, 'ctx-qa')[0].result).toBe('fail');
    expect(entriesIn(store, 'ctx-prod')).toEqual([]);
  });

  it('in a run that stopped on a later target, records the earlier one, verified, as a success', async () => {
    const store = historyStore('ctx-qa', 'ctx-prod');
    const { client } = fakeClient({ [GQL]: historyReply(store), 'host.user': () => ({ data: USER }) });
    const stopsOnProd = async (cb: RunCallbacks) => {
      for (let i = 0; i <= 4; i++) cb.onStepChange(i, 'running'), cb.onStepChange(i, 'done');
      cb.onStepChange(5, 'running');
      cb.onStepChange(5, 'fail');
      return false;
    };
    expect(await withHistory(client, record, stopsOnProd)(callbacks().cb, new AbortController().signal)).toBe(false);
    await vi.waitFor(() => expect(entriesIn(store, 'ctx-prod')).toHaveLength(1));
    expect(entriesIn(store, 'ctx-qa')[0].result).toBe('success');
    expect(entriesIn(store, 'ctx-prod')[0].result).toBe('fail');
  });

  it('records nothing when no import started', async () => {
    const { client, calls } = fakeClient({ [GQL]: historyReply({}) });
    await withHistory(client, record, fakeRun(1))(callbacks().cb, new AbortController().signal);
    await new Promise((r) => setTimeout(r));
    expect(calls).toEqual([]);
  });

  it('uses the email when the host gives no name, and leaves `by` out when it gives nothing', async () => {
    const store = historyStore('ctx-qa');
    const one = { ...record, targets: [QA], importAt: [2] };
    const { client } = fakeClient({ [GQL]: historyReply(store), 'host.user': () => ({ data: { ...USER, name: '' } }) });
    await withHistory(client, one, fakeRun(2, true))(callbacks().cb, new AbortController().signal);
    await vi.waitFor(() => expect(entriesIn(store, 'ctx-qa')).toHaveLength(1));
    const { client: anon } = fakeClient({ [GQL]: historyReply(store), 'host.user': () => Promise.reject(new Error('no user')) });
    await withHistory(anon, one, fakeRun(2, true))(callbacks().cb, new AbortController().signal);
    await vi.waitFor(() => expect(entriesIn(store, 'ctx-qa')).toHaveLength(2));
    expect(entriesIn(store, 'ctx-qa').map((e) => e.by)).toEqual(['jane@acme.com', undefined]);
  });

  it("doesn't wait for the history: the run ends while recording is still going", async () => {
    const { client } = fakeClient({ [GQL]: () => new Promise(() => {}), 'host.user': () => ({ data: USER }) });
    expect(await withHistory(client, record, fakeRun(6))(callbacks().cb, new AbortController().signal)).toBe(true);
  });

  it('logs one warning per target it could not record on, and the run still succeeds', async () => {
    const store = historyStore('ctx-qa');
    const { client } = fakeClient({ [GQL]: historyReply(store), 'host.user': () => ({ data: USER }) });
    const { cb, logs } = callbacks();
    expect(await withHistory(client, record, fakeRun(6))(cb, new AbortController().signal)).toBe(true);
    await vi.waitFor(() => expect(logs).toHaveLength(1));
    expect(logs).toEqual([["Couldn't record this run in Prod's history: /sitecore/system/Modules wasn't found.", 'warning']]);
    expect(entriesIn(store, 'ctx-qa')).toHaveLength(1);
  });

  it('records a run whose exec throws as failed, and passes the throw on', async () => {
    const store = historyStore('ctx-qa');
    const { client } = fakeClient({ [GQL]: historyReply(store), 'host.user': () => ({ data: USER }) });
    const boom = async (cb: RunCallbacks) => {
      cb.onStepChange(2, 'running');
      throw new Error('boom');
    };
    await expect(withHistory(client, { ...record, targets: [QA], importAt: [2] }, boom)(callbacks().cb, new AbortController().signal)).rejects.toThrow('boom');
    await vi.waitFor(() => expect(entriesIn(store, 'ctx-qa')).toHaveLength(1));
    expect(entriesIn(store, 'ctx-qa')[0].result).toBe('fail');
  });

  it('keeps an install count given up front', async () => {
    const store = historyStore('ctx-qa');
    const { client } = fakeClient({ [GQL]: historyReply(store), 'host.user': () => ({ data: USER }) });
    const install = { kind: 'install', targets: [QA], importAt: [2], items: [HOME], itemCount: 2 } as const;
    await withHistory(client, install, async (cb) => (cb.onStepChange(2, 'running'), true))(callbacks().cb, new AbortController().signal);
    await vi.waitFor(() => expect(entriesIn(store, 'ctx-qa')).toHaveLength(1));
    const [e] = entriesIn(store, 'ctx-qa');
    expect(e).toEqual({ ...e, kind: 'install', target: 'QA', itemCount: 2 });
    expect(e).not.toHaveProperty('source');
  });
});
