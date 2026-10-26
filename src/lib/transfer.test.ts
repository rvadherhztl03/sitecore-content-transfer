// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it } from 'vitest';
import { readPackage, type PackagePart } from '@/lib/package';
import {
  IMPORT_STEP,
  IMPORT_STEPS,
  TIMING,
  TRANSFER_STEPS,
  backupTreesFor,
  transferSteps,
  runExport,
  runImport,
  runTransfer,
  type DataTree,
  type LogType,
  type RunCallbacks,
  type StepStatus,
} from '@/lib/transfer';
import { fakeClient, type FakeReply } from '@/test/fakeClient';

const DEV = { id: 'r1', name: 'Dev', contextId: 'ctx-dev' };
const QA = { id: 'r2', name: 'QA', contextId: 'ctx-qa' };
const TREES: DataTree[] = [
  { itemPath: '/sitecore/media library/Images/Hero Banner', scope: 'SingleItem', mergeStrategy: 'OverrideExistingItem' },
];
const UAT = { id: 'r3', name: 'UAT', contextId: 'ctx-uat' };
const OPTS = { source: DEV, targets: [{ env: QA }], database: 'master', dataTrees: TREES };
const CT = 'xmc.contentTransfer.';
const KIND: Record<string, 'query' | 'mutate'> = {
  createContentTransfer: 'mutate',
  getContentTransferStatus: 'query',
  getChunk: 'mutate',
  saveChunk: 'mutate',
  completeChunkSetTransfer: 'mutate',
  consumeFile: 'query',
  getBlobState: 'query',
  deleteContentTransfer: 'mutate',
};

type Handler = (params: any) => FakeReply | Promise<FakeReply>;

function happyHandlers(overrides: Record<string, Handler> = {}) {
  let statusCalls = 0;
  let blobCalls = 0;
  const base: Record<string, Handler> = {
    getContentTransferStatus: () =>
      statusCalls++ === 0
        ? { data: { State: 'Processing' } }
        : { data: { State: 'Completed', ChunkSetsMetadata: [{ ChunkSetId: 'cs1', ChunkCount: 2, TotalItemCount: 3 }] } },
    getChunk: (p) => ({
      data: new Blob(['c' + p.path.chunkId]),
      headers: { 'content-disposition': `attachment; IsMedia=${p.path.chunkId === 1}` },
    }),
    completeChunkSetTransfer: (p) => ({ data: { ContentTransferFileName: 'f-' + p.path.chunksetId + '.raif' } }),
    getBlobState: () => ({ data: { status: blobCalls++ === 0 ? 'NotFound' : 'OK' } }),
  };
  const all = { ...base, ...overrides };
  return Object.fromEntries(Object.keys(KIND).map((k) => [CT + k, all[k] ?? (() => ({}))]));
}

function recorder() {
  const logs: [string, LogType][] = [];
  const progress: number[] = [];
  const steps: [number, StepStatus][] = [];
  const infos: { chunkCount: number; itemCount: number }[] = [];
  const cb: RunCallbacks = {
    onLog: (m, t) => logs.push([m, t]),
    onProgress: (p) => progress.push(p),
    onStepChange: (i, s) => steps.push([i, s]),
    onInfo: (i) => infos.push(i),
  };
  return { cb, logs, progress, steps, infos };
}

const short = (key: string) => key.replace(CT, '');
const STILL_IMPORTING = (env: string) => [`${env} may still finish importing; check it before running again.`, 'warning'];
const ofKey = (calls: { key: string }[], k: string) => calls.filter((c) => c.key === CT + k) as any[];
const ctxOf = (c: any) => c.params.query.sitecoreContextId;

// Two chunk sets; the second one has no TotalItemCount (counts as 0).
const TWO_SETS: Record<string, Handler> = {
  getContentTransferStatus: () => ({
    data: {
      State: 'Completed',
      ChunkSetsMetadata: [
        { ChunkSetId: 'cs1', ChunkCount: 2, TotalItemCount: 3 },
        { ChunkSetId: 'cs2', ChunkCount: 1 },
      ],
    },
  }),
};

describe('IMPORT_STEP', () => {
  it('points at the Import into database step', () => {
    expect(TRANSFER_STEPS[IMPORT_STEP.transfer]).toBe('Import into database');
    expect(IMPORT_STEPS[IMPORT_STEP.import]).toBe('Import into database');
  });
});

beforeEach(() => {
  Object.assign(TIMING, { pollMs: 0, statusTimeoutMs: 50, verifyTimeoutMs: 50, publishTimeoutMs: 50 });
});

describe('runTransfer', () => {
  it('runs the full pipeline against the right environments', async () => {
    const { client, calls } = fakeClient(happyHandlers());
    const r = recorder();
    expect(await runTransfer(client, OPTS, r.cb)).toBe(true);

    const seq = calls
      .map((c) => [short(c.key), ctxOf(c)])
      .filter(([k, ctx], i, a) => i === 0 || k !== a[i - 1][0] || ctx !== a[i - 1][1]);
    expect(seq).toEqual([
      ['createContentTransfer', 'ctx-dev'],
      ['getContentTransferStatus', 'ctx-dev'],
      ['getChunk', 'ctx-dev'],
      ['saveChunk', 'ctx-qa'],
      ['getChunk', 'ctx-dev'],
      ['saveChunk', 'ctx-qa'],
      ['completeChunkSetTransfer', 'ctx-qa'],
      ['consumeFile', 'ctx-qa'],
      ['getBlobState', 'ctx-qa'],
      ['deleteContentTransfer', 'ctx-dev'],
    ]);
    for (const c of calls) expect(c.kind).toBe(KIND[short(c.key)]);

    const body = calls[0].params.body;
    expect(body).toEqual({ transferId: expect.any(String), configuration: { dataTrees: TREES } });
    const { transferId } = body;
    for (const c of calls.slice(1)) expect(c.params.path?.transferId ?? transferId).toBe(transferId);

    const saves = ofKey(calls, 'saveChunk');
    expect(saves.map((c) => c.params.path)).toEqual([
      { transferId, chunksetId: 'cs1', chunkId: 0 },
      { transferId, chunksetId: 'cs1', chunkId: 1 },
    ]);
    expect(saves.map((c) => c.params.query.isMedia)).toEqual([false, true]);
    expect(saves[0].params.body).toBeInstanceOf(Blob);
    expect(await Promise.all(saves.map((c) => c.params.body.text()))).toEqual(['c0', 'c1']);

    expect(ofKey(calls, 'consumeFile')[0].params.query).toEqual({
      databaseName: 'master',
      fileName: 'blob://f-cs1.raif',
      sitecoreContextId: 'ctx-qa',
    });
    expect(ofKey(calls, 'getBlobState')[0].params.query).toEqual({ fileName: 'f-cs1.raif', sitecoreContextId: 'ctx-qa' });

    expect(r.progress.at(-1)).toBe(100);
    for (let i = 0; i < 6; i++) expect(r.steps).toContainEqual([i, 'done']);
    expect(r.steps.some(([, s]) => s === 'fail')).toBe(false);
  });

  it('handles every chunk set', async () => {
    const { client, calls } = fakeClient(
      happyHandlers({
        getContentTransferStatus: () => ({
          data: {
            State: 'Completed',
            ChunkSetsMetadata: [
              { ChunkSetId: 'cs1', ChunkCount: 1, TotalItemCount: 1 },
              { ChunkSetId: 'cs2', ChunkCount: 1, TotalItemCount: 1 },
            ],
          },
        }),
      }),
    );
    expect(await runTransfer(client, OPTS, recorder().cb)).toBe(true);
    expect(ofKey(calls, 'saveChunk').map((c) => c.params.path.chunksetId)).toEqual(['cs1', 'cs2']);
    expect(ofKey(calls, 'completeChunkSetTransfer').map((c) => c.params.path.chunksetId)).toEqual(['cs1', 'cs2']);
    expect(ofKey(calls, 'consumeFile').map((c) => c.params.query.fileName)).toEqual(['blob://f-cs1.raif', 'blob://f-cs2.raif']);
    expect([...new Set(ofKey(calls, 'getBlobState').map((c) => c.params.query.fileName))]).toEqual([
      'f-cs1.raif',
      'f-cs2.raif',
    ]);
  });

  it('keeps a file name that already has a scheme', async () => {
    const { client, calls } = fakeClient(
      happyHandlers({ completeChunkSetTransfer: () => ({ data: { ContentTransferFileName: 'file://pkg.raif' } }) }),
    );
    expect(await runTransfer(client, OPTS, recorder().cb)).toBe(true);
    expect(ofKey(calls, 'consumeFile')[0].params.query.fileName).toBe('file://pkg.raif');
    expect(ofKey(calls, 'getBlobState')[0].params.query.fileName).toBe('file://pkg.raif');
  });

  it('ends the import on the Item Transfer API terminal states', async () => {
    for (const BlobState of ['Error', 'Discarded']) {
      const { client } = fakeClient(happyHandlers({ getBlobState: () => ({ data: { BlobState, Error: 'boom' } }) }));
      const r = recorder();
      expect(await runTransfer(client, OPTS, r.cb)).toBe(false);
      expect(r.logs.map(([m]) => m).join('\n')).toContain(`Import failed on QA: ${BlobState} (boom)`);
    }
  });

  it('reports the chunk and item counts once the package is ready', async () => {
    const { client } = fakeClient(happyHandlers(TWO_SETS));
    const r = recorder();
    expect(await runTransfer(client, OPTS, r.cb)).toBe(true);
    expect(r.infos).toEqual([{ chunkCount: 3, itemCount: 3 }]);
  });

  it('treats a 404 status as still processing', async () => {
    let n = 0;
    const { client } = fakeClient(
      happyHandlers({
        getContentTransferStatus: () =>
          n++ === 0
            ? { status: 404 }
            : { data: { State: 'Completed', ChunkSetsMetadata: [{ ChunkSetId: 'cs1', ChunkCount: 1, TotalItemCount: 1 }] } },
      }),
    );
    expect(await runTransfer(client, OPTS, recorder().cb)).toBe(true);
  });

  it('fails when the source reports Failed', async () => {
    const { client, calls } = fakeClient(happyHandlers({ getContentTransferStatus: () => ({ data: { State: 'Failed' } }) }));
    const r = recorder();
    expect(await runTransfer(client, OPTS, r.cb)).toBe(false);
    expect(r.steps).toContainEqual([1, 'fail']);
    expect(r.infos).toEqual([]);
    expect(r.logs.some(([, t]) => t === 'error')).toBe(true);
    // Nothing reached QA, so only the source has the transfer to clean up.
    expect(ofKey(calls, 'deleteContentTransfer').map(ctxOf)).toEqual(['ctx-dev']);
  });

  it('fails when the source has no content', async () => {
    const { client } = fakeClient(
      happyHandlers({ getContentTransferStatus: () => ({ data: { State: 'Completed', ChunkSetsMetadata: [] } }) }),
    );
    const r = recorder();
    expect(await runTransfer(client, OPTS, r.cb)).toBe(false);
    expect(r.logs.map(([m]) => m).join('\n')).toContain(
      'Source returned no content for the selected paths. Check that they exist.',
    );
  });

  it('times out waiting for the package', async () => {
    const { client } = fakeClient(happyHandlers({ getContentTransferStatus: () => ({ data: { State: 'Processing' } }) }));
    const r = recorder();
    expect(await runTransfer(client, OPTS, r.cb)).toBe(false);
    expect(r.logs.map(([m]) => m).join('\n')).toContain('Timed out waiting for the source package.');
  });

  it('shows the access message on 403', async () => {
    const { client } = fakeClient(happyHandlers({ saveChunk: () => ({ status: 403 }) }));
    const r = recorder();
    expect(await runTransfer(client, OPTS, r.cb)).toBe(false);
    expect(r.logs.map(([m]) => m).join('\n')).toContain(
      "The app can't access QA. Grant it in Cloud Portal → app → environment access.",
    );
    expect(r.logs).not.toContainEqual(STILL_IMPORTING('QA'));
  });

  it('reads the import state from BlobState as the Item Transfer API reports it', async () => {
    let polls = 0;
    const { client } = fakeClient(
      happyHandlers({ getBlobState: () => ({ data: polls++ === 0 ? { BlobState: 'Uploaded' } : { BlobState: 'Transferred', Error: null } }) }),
    );
    const r = recorder();
    expect(await runTransfer(client, OPTS, r.cb)).toBe(true);
    expect(r.steps).toContainEqual([5, 'done']);
  });

  it('fails with a clear message when the import finished with errors', async () => {
    const { client } = fakeClient(happyHandlers({ getBlobState: () => ({ data: { BlobState: 'TransferredWithErrors' } }) }));
    const r = recorder();
    expect(await runTransfer(client, OPTS, r.cb)).toBe(false);
    expect(r.steps).toContainEqual([5, 'fail']);
    expect(r.logs.map(([m]) => m).join('\n')).toContain('QA imported the package with errors (TransferredWithErrors).');
  });

  it('logs the raw import state each time it changes', async () => {
    let polls = 0;
    const states = [{ status: 'NotFound' }, { status: 'NotFound' }, { BlobState: 'Uploaded' }, { status: 'OK' }];
    const { client } = fakeClient(happyHandlers({ getBlobState: () => ({ data: states[Math.min(polls++, 3)] }) }));
    const r = recorder();
    expect(await runTransfer(client, OPTS, r.cb)).toBe(true);
    const raw = r.logs.filter(([m]) => m.startsWith('QA import state: '));
    expect(raw.map(([m]) => m)).toEqual([
      'QA import state: {"status":"NotFound"}',
      'QA import state: {"BlobState":"Uploaded"}',
      'QA import state: {"status":"OK"}',
    ]);
  });

  it('does not warn the target may still import when it rejected the import', async () => {
    const reject = { status: 400, error: 'Allowed schema is not specified. Use either file://<fileName> or blob://<fileName>.' };
    const { client, calls } = fakeClient(happyHandlers({ consumeFile: () => reject }));
    const r = recorder();
    expect(await runTransfer(client, OPTS, r.cb)).toBe(false);
    expect(r.steps).toContainEqual([4, 'fail']);
    expect(r.logs.map(([m]) => m).join('\n')).toContain('Allowed schema is not specified');
    expect(r.logs).not.toContainEqual(STILL_IMPORTING('QA'));
    expect(ofKey(calls, 'getBlobState')).toHaveLength(0);
  });

  it('fails when the blob state is Error and warns the target may still import', async () => {
    const { client } = fakeClient(happyHandlers({ getBlobState: () => ({ data: { status: 'Error' } }) }));
    const r = recorder();
    expect(await runTransfer(client, OPTS, r.cb)).toBe(false);
    expect(r.steps).toContainEqual([5, 'fail']);
    expect(r.logs).toContainEqual(STILL_IMPORTING('QA'));
  });

  it('fails before any write when the chunk sets hold no chunks', async () => {
    const { client, calls } = fakeClient(
      happyHandlers({
        getContentTransferStatus: () => ({
          data: { State: 'Completed', ChunkSetsMetadata: [{ ChunkSetId: 'cs1', ChunkCount: 0, TotalItemCount: 0 }] },
        }),
      }),
    );
    const r = recorder();
    expect(await runTransfer(client, OPTS, r.cb)).toBe(false);
    expect(r.logs).toContainEqual(['Source returned no content for the selected paths. Check that they exist.', 'error']);
    expect(ofKey(calls, 'saveChunk')).toHaveLength(0);
    expect(ofKey(calls, 'completeChunkSetTransfer')).toHaveLength(0);
  });

  it('cancels and still cleans up', async () => {
    const ctrl = new AbortController();
    const { client, calls } = fakeClient(
      happyHandlers({
        createContentTransfer: () => {
          ctrl.abort();
          return {};
        },
      }),
    );
    const r = recorder();
    expect(await runTransfer(client, OPTS, r.cb, ctrl.signal)).toBe(false);
    expect(r.logs).toContainEqual(['Cancelled.', 'warning']);
    expect(r.logs.some(([, t]) => t === 'error')).toBe(false);
    expect(ofKey(calls, 'getContentTransferStatus')).toHaveLength(0);
    expect(ofKey(calls, 'deleteContentTransfer').map(ctxOf)).toEqual(['ctx-dev']);
  });

  it('cancels mid-copy without logging a chunk that never starts', async () => {
    const ctrl = new AbortController();
    const { client, calls } = fakeClient(
      happyHandlers({
        saveChunk: () => {
          ctrl.abort();
          return {};
        },
      }),
    );
    const r = recorder();
    expect(await runTransfer(client, OPTS, r.cb, ctrl.signal)).toBe(false);
    expect(ofKey(calls, 'getChunk')).toHaveLength(1);
    expect(ofKey(calls, 'saveChunk')).toHaveLength(1);
    expect(r.logs.filter(([m]) => /^Copying chunk \d/.test(m))).toHaveLength(1);
    expect(r.logs).toContainEqual(['Cancelled.', 'warning']);
  });

  it('never saves a chunk the source returned without binary data', async () => {
    const { client, calls } = fakeClient(happyHandlers({ getChunk: () => ({ data: { foo: 1 } }) }));
    const r = recorder();
    expect(await runTransfer(client, OPTS, r.cb)).toBe(false);
    expect(ofKey(calls, 'saveChunk')).toHaveLength(0);
    expect(r.logs).toContainEqual(['Dev returned no data for chunk 1 of chunk set cs1.', 'error']);
    expect(ofKey(calls, 'deleteContentTransfer').map(ctxOf)).toEqual(['ctx-dev', 'ctx-qa']);
  });

  it('never cleans up the target once it accepted the import', async () => {
    // Deleting the transfer on the target removes the package it is still importing from.
    const { client, calls } = fakeClient(happyHandlers({ getBlobState: () => ({ data: { status: 'Error' } }) }));
    expect(await runTransfer(client, OPTS, recorder().cb)).toBe(false);
    expect(ofKey(calls, 'deleteContentTransfer').map(ctxOf)).toEqual(['ctx-dev']);
  });

  it('treats a cleanup failure as a warning', async () => {
    const { client } = fakeClient(happyHandlers({ deleteContentTransfer: () => ({ status: 500 }) }));
    const r = recorder();
    expect(await runTransfer(client, OPTS, r.cb)).toBe(true);
    expect(r.logs.some(([m, t]) => t === 'warning' && m.startsWith('Cleanup failed'))).toBe(true);
  });
});

describe('backupTreesFor', () => {
  const t = (itemPath: string, scope: DataTree['scope'], mergeStrategy: DataTree['mergeStrategy']): DataTree => ({ itemPath, scope, mergeStrategy });
  const ROWS = [
    t('/tree', 'ItemAndDescendants', 'OverrideExistingTree'),
    t('/tree-items', 'ItemAndDescendants', 'OverrideExistingItem'),
    t('/item', 'SingleItem', 'OverrideExistingItem'),
    t('/children', 'ItemAndChildren', 'OverrideExistingItem'),
    t('/kept', 'ItemAndDescendants', 'KeepExistingItem'),
  ];
  const check = (itemPath: string, onTarget: 'new' | 'same' | 'other') => ({ itemPath, onSource: true, onTarget, missingParents: [], otherParents: [], deleted: [] });

  it('backs up what each row can overwrite, so that installing it puts the target back', () => {
    expect(backupTreesFor(ROWS)).toEqual([
      // A whole tree comes back exactly, removing whatever the transfer added under it.
      t('/tree', 'ItemAndDescendants', 'OverrideExistingTree'),
      t('/tree-items', 'ItemAndDescendants', 'OverrideExistingTree'),
      t('/item', 'SingleItem', 'OverrideExistingItem'),
      t('/children', 'ItemAndChildren', 'OverrideExistingItem'),
    ]);
  });

  it('with a pre-flight check, backs up only items the target has as the same item', () => {
    const checks = new Map([check('/tree', 'same'), check('/tree-items', 'new'), check('/item', 'other')].map((c) => [c.itemPath, c]));
    expect(backupTreesFor(ROWS, checks)).toEqual([t('/tree', 'ItemAndDescendants', 'OverrideExistingTree')]);
  });
});

describe('backup before the transfer', () => {
  const BACKUP: DataTree[] = [{ itemPath: TREES[0].itemPath, scope: 'SingleItem', mergeStrategy: 'OverrideExistingItem' }];
  const onQa = (p: any) => p.query.sitecoreContextId === 'ctx-qa';
  const withBackup = (overrides: Record<string, Handler> = {}) => {
    const r = recorder();
    const zips: Blob[] = [];
    r.cb.onBackup = (zip) => zips.push(zip);
    const { client, calls } = fakeClient(happyHandlers(overrides));
    return { r, zips, calls, run: () => runTransfer(client, { ...OPTS, targets: [{ env: QA, backup: BACKUP }] }, r.cb) };
  };

  it('exports the target under its own job first, hands over the zip, then transfers', async () => {
    const { r, zips, calls, run } = withBackup();
    expect(await run()).toBe(true);

    const creates = ofKey(calls, 'createContentTransfer');
    expect(creates.map(ctxOf)).toEqual(['ctx-qa', 'ctx-dev']);
    expect(creates[0].params.body.configuration.dataTrees).toEqual(BACKUP);
    const backupId = creates[0].params.body.transferId;
    expect(backupId).not.toBe(creates[1].params.body.transferId);
    // Everything before the transfer starts is the backup: read from QA, under the backup job, cleaned up there.
    const before = calls.slice(0, calls.indexOf(creates[1])).filter((c) => c.key.startsWith(CT));
    expect(before.map((c) => short(c.key)).filter((k, i, a) => i === 0 || k !== a[i - 1])).toEqual([
      'createContentTransfer',
      'getContentTransferStatus',
      'getChunk',
      'deleteContentTransfer',
    ]);
    for (const c of before) {
      expect(ctxOf(c)).toBe('ctx-qa');
      expect(c.params.path?.transferId ?? c.params.body.transferId).toBe(backupId);
    }

    expect(zips).toHaveLength(1);
    const { items, parts } = await readPackage(new File([zips[0]], 'b.zip'));
    expect(items).toEqual([{ path: TREES[0].itemPath, id: '', scope: 'SingleItem', mergeStrategy: 'OverrideExistingItem' }]);
    expect(await Promise.all(parts.flatMap((p) => p.chunks).map((c) => c.data.text()))).toEqual(['c0', 'c1']);

    expect(r.logs).toContainEqual(['Backup chunk 1 / 2', 'info']);
    expect(r.logs).toContainEqual(['Backed up QA.', 'success']);
    for (let i = 0; i <= TRANSFER_STEPS.length; i++) expect(r.steps).toContainEqual([i, 'done']);
    expect(r.steps).toContainEqual([IMPORT_STEP.transfer + 1, 'running']);
    expect(r.progress.at(-1)).toBe(100);
    expect(r.progress).toEqual([...r.progress].sort((a, b) => a - b));
  });

  it('stops before anything is written when the backup fails', async () => {
    const { r, zips, calls, run } = withBackup({
      getContentTransferStatus: (p) => (onQa(p) ? { data: { State: 'Failed' } } : { data: { State: 'Completed', ChunkSetsMetadata: [] } }),
    });
    expect(await run()).toBe(false);
    expect(ofKey(calls, 'createContentTransfer').map(ctxOf)).toEqual(['ctx-qa']);
    expect(ofKey(calls, 'saveChunk')).toHaveLength(0);
    expect(zips).toHaveLength(0);
    expect(r.steps).toContainEqual([0, 'fail']);
    expect(r.logs).toContainEqual([
      'Backup of QA failed: The source environment reported the transfer as Failed. Nothing was written to QA; to transfer without a backup, untick it on Review.',
      'error',
    ]);
    const backupId = ofKey(calls, 'createContentTransfer')[0].params.body.transferId;
    expect(ofKey(calls, 'deleteContentTransfer').some((c) => onQa(c.params) && c.params.path.transferId === backupId)).toBe(true);
  });

  it('carries on without a zip when the target has none of the items', async () => {
    let n = 0;
    const { r, zips, calls, run } = withBackup({
      getContentTransferStatus: (p) =>
        onQa(p)
          ? { data: { State: 'Completed', ChunkSetsMetadata: [{ ChunkSetId: 'b1', ChunkCount: 0 }] } }
          : n++ === 0
            ? { data: { State: 'Processing' } }
            : { data: { State: 'Completed', ChunkSetsMetadata: [{ ChunkSetId: 'cs1', ChunkCount: 2, TotalItemCount: 3 }] } },
    });
    expect(await run()).toBe(true);
    expect(zips).toHaveLength(0);
    expect(r.logs).toContainEqual(['Nothing on QA to back up.', 'info']);
    expect(r.steps).toContainEqual([0, 'done']);
    expect(ofKey(calls, 'saveChunk')).toHaveLength(2);
  });

  it('runs no backup step for an empty backup list', async () => {
    const { client, calls } = fakeClient(happyHandlers());
    const r = recorder();
    expect(await runTransfer(client, { ...OPTS, targets: [{ env: QA, backup: [] }] }, r.cb)).toBe(true);
    expect(ofKey(calls, 'createContentTransfer').map(ctxOf)).toEqual(['ctx-dev']);
    expect(r.steps).not.toContainEqual([TRANSFER_STEPS.length, 'done']);
  });
});

describe('publish to Experience Edge', () => {
  const GQL = 'xmc.authoring.graphql';
  const LANGS = 'xmc.sites.listLanguages';
  const C = '/sitecore/content/C';
  const ROWS: DataTree[] = [
    { itemPath: '/sitecore/content/A', scope: 'ItemAndDescendants', mergeStrategy: 'OverrideExistingTree' },
    { itemPath: '/sitecore/content/B', scope: 'SingleItem', mergeStrategy: 'OverrideExistingItem' },
    { itemPath: C, scope: 'ItemAndChildren', mergeStrategy: 'OverrideExistingItem' },
  ];
  // The children lookup, the publish mutation and the status query, answered by what the query asks for.
  function gql(status: (n: number) => Record<string, unknown>) {
    let started = 0;
    let polled = 0;
    return (p: any): FakeReply => {
      const q: string = p.body.query;
      if (q.includes('GetItemChildren')) return { data: { data: { item: { children: { nodes: [{ itemId: 'c1', name: 'C1', path: `${C}/C1`, children: { nodes: [] } }] } } } } };
      if (q.startsWith('mutation')) return { data: { data: { publishItem: { operationId: `op-${++started}` } } } };
      return { data: { data: { publishingStatus: status(polled++) } } };
    };
  }
  const RUNNING_THEN_DONE = (n: number) => (n % 2 === 0 ? { state: 'RUNNING', isDone: false, isFailed: false, processed: 3 } : { state: 'COMPLETED', isDone: true, isFailed: false, processed: 7 });
  const handlers = (status = RUNNING_THEN_DONE) => ({
    ...happyHandlers(),
    [GQL]: gql(status),
    [LANGS]: () => ({ data: [{ name: 'en' }, { name: 'da-DK' }] }),
  });
  const mutations = (calls: any[]) => calls.filter((c) => c.key === GQL && c.params.body.query.startsWith('mutation'));

  it('publishes what was sent from master to Experience Edge, in every target language, and waits for each publish', async () => {
    const { client, calls } = fakeClient(handlers());
    const r = recorder();
    expect(await runTransfer(client, { ...OPTS, dataTrees: ROWS, publish: true }, r.cb)).toBe(true);

    const [tree, single] = mutations(calls);
    for (const m of [tree, single]) {
      expect(m.params.query.sitecoreContextId).toBe('ctx-qa');
      const q: string = m.params.body.query;
      expect(q).toContain('sourceDatabase: "master"');
      expect(q).toContain('targetDatabases: ["experienceedge"]');
      expect(q).toContain('publishItemMode: SMART');
      expect(q).toContain('publishRelatedItems: false');
      expect(q).toContain('languages: ["en","da-DK"]');
    }
    // + Everything below with its subitems; This item and + Children (as sent: the item and each child) without.
    expect(tree.params.body.query).toContain('rootItemPaths: ["/sitecore/content/A"]');
    expect(tree.params.body.query).toContain('publishSubItems: true');
    expect(single.params.body.query).toContain(`rootItemPaths: ["/sitecore/content/B","${C}","${C}/C1"]`);
    expect(single.params.body.query).toContain('publishSubItems: false');
    expect(mutations(calls)).toHaveLength(2);
    expect(calls.find((c) => c.key === LANGS)!.params.query.sitecoreContextId).toBe('ctx-qa');

    const statuses = calls.filter((c) => c.key === GQL && c.params.body.query.includes('publishingStatus')) as any[];
    expect(statuses.map((c) => c.params.body.query.match(/publishingOperationId: "([^"]+)"/)[1])).toEqual(['op-1', 'op-1', 'op-2', 'op-2']);
    expect(r.logs).toContainEqual(['Published 7 items', 'info']);
    expect(r.logs).toContainEqual(['Published to Experience Edge.', 'success']);
    expect(r.steps).toContainEqual([TRANSFER_STEPS.length, 'done']);
    expect(r.progress.at(-1)).toBe(100);
    expect(r.logs.at(-1)).toEqual(['Transfer complete.', 'success']);
  });

  it('a failed publish leaves the transfer done, marks the step failed and says what to do', async () => {
    const { client } = fakeClient(handlers(() => ({ state: 'FAILED', isDone: false, isFailed: true, processed: 0 })));
    const r = recorder();
    expect(await runTransfer(client, { ...OPTS, publish: true }, r.cb)).toBe(true);
    expect(r.steps).toContainEqual([TRANSFER_STEPS.length, 'fail']);
    expect(r.logs).toContainEqual([
      "Publishing to Experience Edge didn't finish: QA reported the publish as failed (FAILED). Publish the items from Pages instead.",
      'error',
    ]);
    expect(r.logs).not.toContainEqual(STILL_IMPORTING('QA'));
    expect(r.logs.at(-1)).toEqual(['Transfer complete.', 'success']);
  });

  it('gives up waiting for a publish that never finishes', async () => {
    const { client } = fakeClient(handlers(() => ({ state: 'RUNNING', isDone: false, isFailed: false, processed: 1 })));
    const r = recorder();
    expect(await runTransfer(client, { ...OPTS, publish: true }, r.cb)).toBe(true);
    expect(r.logs).toContainEqual([
      "Publishing to Experience Edge didn't finish: Timed out waiting for the publish to finish. Publish the items from Pages instead.",
      'error',
    ]);
  });

  it('publishes in English when the target lists no languages', async () => {
    const { client, calls } = fakeClient({ ...handlers(), [LANGS]: () => ({ data: [] }) });
    expect(await runTransfer(client, { ...OPTS, publish: true }, recorder().cb)).toBe(true);
    expect(mutations(calls)[0].params.body.query).toContain('languages: ["en"]');
  });

  it('a restore publishes the backup rows, expanding + Children on the target', async () => {
    const { client, calls } = fakeClient(handlers());
    const parts: PackagePart[] = [{ chunks: [{ data: new Blob(['a0']), isMedia: false }] }];
    const r = recorder();
    expect(await runImport(client, { target: QA, database: 'master', parts, publish: [ROWS[0], ROWS[2]] }, r.cb)).toBe(true);
    const [tree, single] = mutations(calls);
    expect(tree.params.body.query).toContain('rootItemPaths: ["/sitecore/content/A"]');
    expect(single.params.body.query).toContain(`rootItemPaths: ["${C}","${C}/C1"]`);
    expect(calls.filter((c) => c.key === GQL).every((c: any) => c.params.query.sitecoreContextId === 'ctx-qa')).toBe(true);
    expect(r.steps).toContainEqual([IMPORT_STEPS.length, 'done']);
  });
});

describe('several targets', () => {
  const both = (backup?: DataTree[]) => [{ env: QA, backup }, { env: UAT, backup }];
  const ctxSeq = (calls: any[], k: string) => ofKey(calls, k).map(ctxOf);

  it('lays the steps out: backups first, the source once, then each target named on every step', () => {
    const plan = transferSteps(DEV, both(TREES), true);
    expect(plan.labels).toEqual([
      'Back up QA',
      'Back up UAT',
      'Create job on Dev',
      'Package content',
      'Copy chunks to QA',
      'Assemble package on QA',
      'Import into master on QA',
      'Verify on QA',
      'Publish to Experience Edge on QA',
      'Copy chunks to UAT',
      'Assemble package on UAT',
      'Import into master on UAT',
      'Verify on UAT',
      'Publish to Experience Edge on UAT',
    ]);
    expect(plan.targetAt).toEqual([4, 9]);
    expect(plan.firstImport).toBe(6);
    // One target: the layout the single-target screens and IMPORT_STEP already use.
    const one = transferSteps(DEV, [{ env: QA }]);
    expect(one.labels).toEqual(['Create job on Dev', 'Package content', 'Copy chunks to QA', 'Assemble package on QA', 'Import into master', 'Verify']);
    expect(one.firstImport).toBe(IMPORT_STEP.transfer);
  });

  it('packages on the source once, then imports into each target in turn, and never cleans up a target that imported', async () => {
    const { client, calls } = fakeClient(happyHandlers());
    const r = recorder();
    expect(await runTransfer(client, { ...OPTS, targets: both() }, r.cb)).toBe(true);
    expect(ctxSeq(calls, 'createContentTransfer')).toEqual(['ctx-dev']);
    expect(ctxSeq(calls, 'saveChunk')).toEqual(['ctx-qa', 'ctx-qa', 'ctx-uat', 'ctx-uat']);
    expect(ctxSeq(calls, 'consumeFile')).toEqual(['ctx-qa', 'ctx-uat']);
    expect(ctxSeq(calls, 'deleteContentTransfer')).toEqual(['ctx-dev']);
    // UAT starts only once QA is verified.
    const qaVerified = calls.findLastIndex((c) => c.key === CT + 'getBlobState' && ctxOf(c) === 'ctx-qa');
    expect(calls.findIndex((c) => c.key === CT + 'saveChunk' && ctxOf(c) === 'ctx-uat')).toBeGreaterThan(qaVerified);
    expect(r.logs).toContainEqual(['QA has the content.', 'success']);
    expect(r.logs).toContainEqual(['UAT has the content.', 'success']);
    for (let i = 0; i < 10; i++) expect(r.steps).toContainEqual([i, 'done']);
    expect(r.progress.at(-1)).toBe(100);
    expect(r.progress).toEqual([...r.progress].sort((a, b) => a - b));
  });

  it('backs up every target before anything is written, and hands each backup over with its target', async () => {
    const { client, calls } = fakeClient(happyHandlers());
    const r = recorder();
    const got: string[] = [];
    r.cb.onBackup = (_zip, env) => got.push(env.name);
    expect(await runTransfer(client, { ...OPTS, targets: both(TREES) }, r.cb)).toBe(true);
    expect(ctxSeq(calls, 'createContentTransfer')).toEqual(['ctx-qa', 'ctx-uat', 'ctx-dev']);
    expect(got).toEqual(['QA', 'UAT']);
    expect(r.progress).toEqual([...r.progress].sort((a, b) => a - b));
  });

  it('stops at the first failure: earlier targets keep the content, later ones are left alone', async () => {
    const { client, calls } = fakeClient(
      happyHandlers({ completeChunkSetTransfer: (p) => (p.query.sitecoreContextId === 'ctx-uat' ? { status: 500 } : { data: { ContentTransferFileName: 'f.raif' } }) }),
    );
    const r = recorder();
    expect(await runTransfer(client, { ...OPTS, targets: [...both(), { env: { id: 'r4', name: 'Prod', contextId: 'ctx-prod' } }] }, r.cb)).toBe(false);
    expect(ctxSeq(calls, 'consumeFile')).toEqual(['ctx-qa']);
    expect(calls.some((c) => ctxOf(c) === 'ctx-prod')).toBe(false);
    // QA imported: never cleaned up. UAT only held chunks: cleaned up, with the source. Prod was never written to.
    expect(ctxSeq(calls, 'deleteContentTransfer')).toEqual(['ctx-dev', 'ctx-uat']);
    expect(r.steps).toContainEqual([7, 'fail']);
    expect(r.logs.some(([m]) => /may still finish importing/.test(m))).toBe(false);
  });

  it('warns about the target that was importing when the run fails there', async () => {
    const { client, calls } = fakeClient(happyHandlers({ getBlobState: (p) => ({ data: { status: p.query.sitecoreContextId === 'ctx-uat' ? 'Error' : 'OK' } }) }));
    const r = recorder();
    expect(await runTransfer(client, { ...OPTS, targets: both() }, r.cb)).toBe(false);
    expect(r.logs).toContainEqual(STILL_IMPORTING('UAT'));
    expect(r.logs).not.toContainEqual(STILL_IMPORTING('QA'));
    expect(ctxSeq(calls, 'deleteContentTransfer')).toEqual(['ctx-dev']);
  });
});

describe('+ Children', () => {
  const GQL = 'xmc.authoring.graphql';
  const HOME = '/sitecore/content/Acme/Home';
  const node = (name: string) => ({ itemId: `{${name}}`, name, path: `${HOME}/${name}`, children: { nodes: [] } });
  // Answers both the children lookup and the item ID lookup.
  const withChildren = (names: string[], overrides: Record<string, Handler> = {}) => ({
    ...happyHandlers(overrides),
    [GQL]: () => ({ data: { data: { item: { itemId: '{HOME}', children: { nodes: names.map(node) } } } } }),
  });
  const ROW: DataTree = { itemPath: HOME, scope: 'ItemAndChildren', mergeStrategy: 'KeepExistingItem' };
  const single = (itemPath: string): DataTree => ({ itemPath, scope: 'SingleItem', mergeStrategy: 'KeepExistingItem' });
  const sent = (calls: any[]) => ofKey(calls, 'createContentTransfer')[0].params.body.configuration.dataTrees;

  it('sends the item and each direct child as single items', async () => {
    const { client, calls } = fakeClient(withChildren(['About', 'News']));
    const r = recorder();
    expect(await runTransfer(client, { ...OPTS, dataTrees: [ROW] }, r.cb)).toBe(true);
    expect(sent(calls)).toEqual([single(HOME), single(`${HOME}/About`), single(`${HOME}/News`)]);
    const lookup = calls.find((c) => c.key === GQL);
    expect(lookup.params.query.sitecoreContextId).toBe('ctx-dev');
    expect(lookup.params.body.variables).toEqual({ path: HOME });
    expect(r.logs).toContainEqual([`Including 2 children of ${HOME}.`, 'info']);
  });

  it('never replaces anything below a child, even if the row asks to', async () => {
    const { client, calls } = fakeClient(withChildren(['About']));
    expect(await runTransfer(client, { ...OPTS, dataTrees: [{ ...ROW, mergeStrategy: 'OverrideExistingTree' }] }, recorder().cb)).toBe(true);
    expect(sent(calls).map((t: DataTree) => t.mergeStrategy)).toEqual(['OverrideExistingItem', 'OverrideExistingItem']);
  });

  it('sends only the item when it has no children', async () => {
    const { client, calls } = fakeClient(withChildren([]));
    expect(await runTransfer(client, { ...OPTS, dataTrees: [ROW] }, recorder().cb)).toBe(true);
    expect(sent(calls)).toEqual([single(HOME)]);
  });

  it('leaves other rows alone, and a child listed on its own keeps its own row', async () => {
    const own: DataTree = { itemPath: `${HOME}/news/`, scope: 'ItemAndDescendants', mergeStrategy: 'OverrideExistingTree' };
    const { client, calls } = fakeClient(withChildren(['About', 'News']));
    expect(await runTransfer(client, { ...OPTS, dataTrees: [TREES[0], ROW, own] }, recorder().cb)).toBe(true);
    expect(sent(calls)).toEqual([TREES[0], single(HOME), single(`${HOME}/About`), own]);
  });

  it('stops before creating the job when the item has 1,000 or more children', async () => {
    const { client, calls } = fakeClient(withChildren(Array.from({ length: 1000 }, (_, i) => `c${i}`)));
    const r = recorder();
    expect(await runTransfer(client, { ...OPTS, dataTrees: [ROW] }, r.cb)).toBe(false);
    expect(ofKey(calls, 'createContentTransfer')).toHaveLength(0);
    expect(r.steps).toContainEqual([0, 'fail']);
    expect(r.logs).toContainEqual([
      `${HOME} has 1,000 or more children, too many to add one by one. Use + Everything below, or pick the children you need.`,
      'error',
    ]);
  });

  it('exports the expanded items, and the package lists the row as chosen', async () => {
    const { client, calls } = fakeClient(withChildren(['About']));
    const zip = await runExport(client, { source: DEV, dataTrees: [ROW] }, recorder().cb);
    expect(sent(calls)).toEqual([single(HOME), single(`${HOME}/About`)]);
    const { items } = await readPackage(new File([zip!], 'e.zip'));
    expect(items).toEqual([{ path: HOME, id: '{HOME}', scope: 'ItemAndChildren', mergeStrategy: 'KeepExistingItem' }]);
  });
});

describe('runExport', () => {
  const GQL = 'xmc.authoring.graphql';
  const withGraphql = (overrides: Record<string, Handler> = {}) => ({
    ...happyHandlers(overrides),
    [GQL]: () => ({ data: { data: { item: { itemId: '{ID}' } } } }),
  });

  it('exports a zip with metadata and every chunk', async () => {
    const { client, calls } = fakeClient(withGraphql());
    const r = recorder();
    const zip = await runExport(client, { source: DEV, dataTrees: TREES }, r.cb);
    expect(zip).toBeInstanceOf(Blob);

    const { items, parts } = await readPackage(new File([zip!], 'e.zip'));
    expect(items[0].id).toBe('{ID}');
    expect(items[0].path).toBe(TREES[0].itemPath);
    const chunks = parts.flatMap((p) => p.chunks);
    expect(await Promise.all(chunks.map((c) => c.data.text()))).toEqual(['c0', 'c1']);
    expect(chunks.map((c) => c.isMedia)).toEqual([false, true]);

    expect(ofKey(calls, 'saveChunk')).toHaveLength(0);
    expect(ofKey(calls, 'consumeFile')).toHaveLength(0);
    expect(ofKey(calls, 'deleteContentTransfer').map(ctxOf)).toEqual(['ctx-dev']);
    for (const c of calls) expect(ctxOf(c)).toBe('ctx-dev');
    expect(r.progress.at(-1)).toBe(100);
    for (let i = 0; i < 3; i++) expect(r.steps).toContainEqual([i, 'done']);
  });

  it('reports the chunk and item counts once the package is ready', async () => {
    const { client } = fakeClient(withGraphql(TWO_SETS));
    const r = recorder();
    expect(await runExport(client, { source: DEV, dataTrees: TREES }, r.cb)).toBeInstanceOf(Blob);
    expect(r.infos).toEqual([{ chunkCount: 3, itemCount: 3 }]);
  });

  it('exports with an empty ItemId when the ID lookup fails', async () => {
    const { client } = fakeClient({ ...withGraphql(), [GQL]: () => ({ status: 500 }) });
    const zip = await runExport(client, { source: DEV, dataTrees: TREES }, recorder().cb);
    expect(zip).toBeInstanceOf(Blob);
    const { items } = await readPackage(new File([zip!], 'e.zip'));
    expect(items[0]).toMatchObject({ path: TREES[0].itemPath, id: '' });
  });

  it('export returns null and cleans up on failure', async () => {
    const { client, calls } = fakeClient(withGraphql({ getContentTransferStatus: () => ({ data: { State: 'Failed' } }) }));
    const r = recorder();
    expect(await runExport(client, { source: DEV, dataTrees: TREES }, r.cb)).toBeNull();
    expect(r.steps).toContainEqual([1, 'fail']);
    expect(ofKey(calls, 'deleteContentTransfer').map(ctxOf)).toEqual(['ctx-dev']);
  });
});

describe('runImport', () => {
  const PARTS: PackagePart[] = [
    {
      chunks: [
        { data: new Blob(['a0']), isMedia: false },
        { data: new Blob(['a1']), isMedia: true },
      ],
    },
    { chunks: [{ data: new Blob(['b0']), isMedia: false }] },
  ];
  const IMPORT = { target: QA, database: 'master', parts: PARTS };

  it('imports each part into the target', async () => {
    const { client, calls } = fakeClient(happyHandlers());
    const r = recorder();
    expect(await runImport(client, IMPORT, r.cb)).toBe(true);

    for (const c of calls) expect(ctxOf(c)).toBe('ctx-qa');
    const seq = calls.map((c) => short(c.key)).filter((k, i, a) => i === 0 || k !== a[i - 1]);
    expect(seq).toEqual(['saveChunk', 'completeChunkSetTransfer', 'consumeFile', 'getBlobState']);

    const saves = ofKey(calls, 'saveChunk');
    const { transferId } = saves[0].params.path;
    for (const c of calls) expect(c.params.path?.transferId ?? transferId).toBe(transferId);
    expect(saves.map((c) => c.params.path.chunkId)).toEqual([0, 1, 0]);
    const [setA, , setB] = saves.map((c) => c.params.path.chunksetId);
    expect(saves[1].params.path.chunksetId).toBe(setA);
    expect(setB).not.toBe(setA);
    expect(saves.map((c) => c.params.query.isMedia)).toEqual([false, true, false]);
    expect(await Promise.all(saves.map((c) => c.params.body.text()))).toEqual(['a0', 'a1', 'b0']);

    expect(ofKey(calls, 'completeChunkSetTransfer').map((c) => c.params.path.chunksetId)).toEqual([setA, setB]);
    expect(ofKey(calls, 'consumeFile').map((c) => c.params.query)).toEqual([
      { databaseName: 'master', fileName: `blob://f-${setA}.raif`, sitecoreContextId: 'ctx-qa' },
      { databaseName: 'master', fileName: `blob://f-${setB}.raif`, sitecoreContextId: 'ctx-qa' },
    ]);
    expect(ofKey(calls, 'deleteContentTransfer')).toHaveLength(0);
    expect(r.progress.at(-1)).toBe(100);
    for (let i = 0; i < 4; i++) expect(r.steps).toContainEqual([i, 'done']);
  });

  it('import shows the access message on 403 and cleans up', async () => {
    const { client, calls } = fakeClient(happyHandlers({ saveChunk: () => ({ status: 403 }) }));
    const r = recorder();
    expect(await runImport(client, IMPORT, r.cb)).toBe(false);
    expect(r.logs.map(([m]) => m).join('\n')).toContain(
      "The app can't access QA. Grant it in Cloud Portal → app → environment access.",
    );
    expect(ofKey(calls, 'deleteContentTransfer').map(ctxOf)).toEqual(['ctx-qa']);
  });

  it('fails when the target returns no file name', async () => {
    const { client, calls } = fakeClient(happyHandlers({ completeChunkSetTransfer: () => ({ data: {} }) }));
    const r = recorder();
    expect(await runImport(client, IMPORT, r.cb)).toBe(false);
    expect(r.logs.map(([m]) => m).join('\n')).toMatch(/^QA returned no file name for chunk set .+\.$/m);
    expect(ofKey(calls, 'consumeFile')).toHaveLength(0);
    expect(r.logs).not.toContainEqual(STILL_IMPORTING('QA'));
  });

  it('import does not warn the target may still import when it rejected the import', async () => {
    const { client } = fakeClient(happyHandlers({ consumeFile: () => ({ status: 400 }) }));
    const r = recorder();
    expect(await runImport(client, IMPORT, r.cb)).toBe(false);
    expect(r.logs).not.toContainEqual(STILL_IMPORTING('QA'));
  });

  it('import warns the target may still import when verify fails', async () => {
    const { client, calls } = fakeClient(happyHandlers({ getBlobState: () => ({ data: { status: 'Error' } }) }));
    const r = recorder();
    expect(await runImport(client, IMPORT, r.cb)).toBe(false);
    expect(r.logs).toContainEqual(STILL_IMPORTING('QA'));
    expect(ofKey(calls, 'deleteContentTransfer')).toHaveLength(0);
  });

  it('cancels before uploading the next chunk', async () => {
    const ctrl = new AbortController();
    const { client, calls } = fakeClient(
      happyHandlers({
        saveChunk: () => {
          ctrl.abort();
          return {};
        },
      }),
    );
    const r = recorder();
    expect(await runImport(client, IMPORT, r.cb, ctrl.signal)).toBe(false);
    expect(ofKey(calls, 'saveChunk')).toHaveLength(1);
    expect(r.logs.filter(([m]) => /^Uploading chunk \d/.test(m))).toHaveLength(1);
    expect(r.logs).toContainEqual(['Cancelled.', 'warning']);
    expect(ofKey(calls, 'deleteContentTransfer').map(ctxOf)).toEqual(['ctx-qa']);
  });
});
