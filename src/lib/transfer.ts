import { buildPackage, type ChunkData, type PackageItem, type PackagePart } from '@/lib/package';
import type { ItemCheck } from '@/lib/preflight';
import { SdkError, call, fetchChildren, fetchItemId, type Env, type SdkClient } from '@/lib/sdk';

// The API only knows SingleItem and ItemAndDescendants; ItemAndChildren is expanded before the job is created.
export type Scope = 'SingleItem' | 'ItemAndChildren' | 'ItemAndDescendants';
// The Content Transfer API's strategies. The SDK also types LatestWin, but the API doesn't list it.
export type MergeStrategy = 'OverrideExistingItem' | 'KeepExistingItem' | 'OverrideExistingTree';
export type DataTree = { itemPath: string; scope: Scope; mergeStrategy: MergeStrategy };
export type LogType = 'info' | 'success' | 'warning' | 'error';
export type StepStatus = 'pending' | 'running' | 'done' | 'fail';

export interface RunCallbacks {
  onLog(message: string, type: LogType): void;
  onProgress(percent: number): void;
  onStepChange(index: number, status: StepStatus): void;
  /** Called once, when the source package is ready. */
  onInfo?(info: { chunkCount: number; itemCount: number }): void;
  /** Called once with the target's backup package, when a transfer backs it up first and it had something to back up. */
  onBackup?(zip: Blob): void;
}

/** Every import writes into this database; there is no choice. */
export const DATABASE = 'master';

export const TRANSFER_STEPS = ['Create job', 'Wait for package', 'Copy chunks', 'Assemble on target', 'Import into database', 'Verify'];
export const IMPORT_STEPS = ['Upload package', 'Assemble on target', 'Import into database', 'Verify'];
// Index of 'Import into database' in each step list; from here on a failure or cancel may leave the target importing.
export const IMPORT_STEP = { transfer: 4, import: 2 } as const;
export const TIMING = { pollMs: 3000, statusTimeoutMs: 600_000, verifyTimeoutMs: 300_000 };
export const BLOB_SUCCESS = ['OK', 'Transferred', 'Consumed'];
export const BLOB_FAILURE = ['Error', 'Failed', 'Discarded'];
// The share of the progress bar the backup step takes, when there is one.
const BACKUP_SHARE = 20;

const CT = 'xmc.contentTransfer.';

type ChunkSet = { ChunkSetId: string; ChunkCount: number; TotalItemCount?: number };

const infoOf = (sets: ChunkSet[]) => ({
  chunkCount: sets.reduce((n, s) => n + s.ChunkCount, 0),
  itemCount: sets.reduce((n, s) => n + (s.TotalItemCount ?? 0), 0),
});

// fetchChildren reads at most this many children.
const MAX_CHILDREN = 1000;
const pathKey = (path: string) => path.replace(/\/+$/, '').toLowerCase();

/**
 * Replaces each ItemAndChildren row with the item and each of its direct children as single items, read from the
 * source now. A child the queue also lists on its own keeps that row instead.
 */
export async function expandTrees(client: SdkClient, env: Env, trees: DataTree[], cb: RunCallbacks, signal?: AbortSignal) {
  const listed = new Set(trees.map((t) => pathKey(t.itemPath)));
  const out: DataTree[] = [];
  for (const t of trees) {
    if (t.scope !== 'ItemAndChildren') {
      out.push(t);
      continue;
    }
    signal?.throwIfAborted();
    const children = await fetchChildren(client, env, t.itemPath);
    if (children.length >= MAX_CHILDREN) {
      throw new Error(
        `${t.itemPath} has 1,000 or more children, too many to add one by one. Use + Everything below, or pick the children you need.`,
      );
    }
    // Replacing a child's tree would delete what lies below it, which + Children leaves out: replace each item only.
    const merge = t.mergeStrategy === 'OverrideExistingTree' ? 'OverrideExistingItem' : t.mergeStrategy;
    const single = (itemPath: string): DataTree => ({ itemPath, scope: 'SingleItem', mergeStrategy: merge });
    out.push(single(t.itemPath), ...children.filter((c) => !listed.has(pathKey(c.path))).map((c) => single(c.path)));
    cb.onLog(`Including ${children.length} children of ${t.itemPath}.`, 'info');
  }
  return out;
}

export function parseIsMedia(header: string | null): boolean {
  return header?.match(/IsMedia\s*=\s*(true|false)/i)?.[1].toLowerCase() === 'true';
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function waitForPackage(client: SdkClient, env: Env, transferId: string, signal?: AbortSignal, allowEmpty = false): Promise<ChunkSet[]> {
  const deadline = Date.now() + TIMING.statusTimeoutMs;
  for (;;) {
    signal?.throwIfAborted();
    const data = await call<{ State?: string; ChunkSetsMetadata?: ChunkSet[] }>(
      client, env, 'query', CT + 'getContentTransferStatus', { path: { transferId } },
    ).then(
      (r) => r.data,
      (e) => {
        // Sitecore answers 404 until the job is registered: keep polling.
        if (e instanceof SdkError && e.status === 404) return undefined;
        throw e;
      },
    );
    if (data?.State === 'Completed') {
      const sets = data.ChunkSetsMetadata ?? [];
      if (!allowEmpty && !sets.some((s) => s.ChunkCount > 0)) throw new Error('Source returned no content for the selected paths. Check that they exist.');
      return sets;
    }
    if (data?.State === 'Failed') throw new Error('The source environment reported the transfer as Failed.');
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the source package.');
    await sleep(TIMING.pollMs, signal);
  }
}

// ConsumeFile wants a location with a scheme, and the assembled package lives in blob storage, so a bare
// `ContentTransferFileName` becomes `blob://<name>`. GetBlobState looks the blob up by its plain name.
const packageLocation = (name: string) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(name) ? name : `blob://${name}`);

export async function consumeFiles(
  client: SdkClient,
  env: Env,
  database: string,
  files: string[],
  signal?: AbortSignal,
  onAccepted?: () => void,
) {
  for (const fileName of files) {
    signal?.throwIfAborted();
    await call(client, env, 'query', CT + 'consumeFile', { query: { databaseName: database, fileName: packageLocation(fileName) } });
    onAccepted?.();
  }
}

// The SDK types GetBlobState as `{ status }`, but the Item Transfer API reports `BlobState`; accept either.
const importState = (data: unknown): string => {
  const d = (data ?? {}) as Record<string, unknown>;
  const value = [d.status, d.Status, d.BlobState, d.blobState].find((v) => typeof v === 'string');
  return typeof value === 'string' ? value : '';
};

export async function verifyFiles(client: SdkClient, env: Env, files: string[], cb: RunCallbacks, signal?: AbortSignal) {
  for (const fileName of files) {
    const deadline = Date.now() + TIMING.verifyTimeoutMs;
    let last: string | undefined;
    for (;;) {
      signal?.throwIfAborted();
      const { data } = await call(client, env, 'query', CT + 'getBlobState', { query: { fileName } });
      const status = importState(data);
      // Show what the target reports whenever it changes, so an unexpected state is visible rather than a silent wait.
      if (status !== last) cb.onLog(`${env.name} import state: ${JSON.stringify(data).slice(0, 300)}`, 'info');
      last = status;
      if (BLOB_SUCCESS.includes(status)) {
        cb.onLog(`Imported ${fileName} (${status}).`, 'success');
        break;
      }
      if (status === 'TransferredWithErrors') {
        throw new Error(`${env.name} imported the package with errors (TransferredWithErrors). Check the item transfer details on ${env.name}.`);
      }
      if (BLOB_FAILURE.includes(status)) {
        const detail = (data as { Error?: unknown } | undefined)?.Error;
        throw new Error(`Import failed on ${env.name}: ${status}${typeof detail === 'string' && detail ? ` (${detail.slice(0, 300)})` : ''}`);
      }
      if (Date.now() >= deadline) throw new Error('Timed out waiting for the import to finish.');
      await sleep(TIMING.pollMs, signal);
    }
  }
}

// Best-effort: never throws, and ignores the abort signal so a cancelled run still cleans up.
export async function cleanup(client: SdkClient, envs: Env[], transferId: string, cb: RunCallbacks) {
  for (const env of envs) {
    try {
      await call(client, env, 'mutate', CT + 'deleteContentTransfer', { path: { transferId } });
    } catch (e) {
      cb.onLog(`Cleanup failed on ${env.name}: ${e instanceof Error ? e.message : String(e)}`, 'warning');
    }
  }
}

type Steps = { begin(i: number, message: string): void; done(percent: number): void };

// Shared step bookkeeping: marks the running step failed on error, logs `Cancelled.` on abort,
// returns `failed`, and cleans up `envs` (never a target that accepted an import). Once the target has accepted an import
// (`importAt.started()`), it may still be importing, so a failure or cancel also warns that it may still finish.
async function runSteps<T>(
  client: SdkClient,
  envs: Env[],
  transferId: string,
  cb: RunCallbacks,
  signal: AbortSignal | undefined,
  failed: T,
  body: (steps: Steps) => Promise<T>,
  importAt?: { target: Env; started(): boolean },
): Promise<T> {
  let step = 0;
  const steps: Steps = {
    begin(i, message) {
      step = i;
      cb.onStepChange(i, 'running');
      cb.onLog(message, 'info');
    },
    done(percent) {
      cb.onStepChange(step, 'done');
      cb.onProgress(percent);
    },
  };
  try {
    return await body(steps);
  } catch (e) {
    cb.onStepChange(step, 'fail');
    if (signal?.aborted) cb.onLog('Cancelled.', 'warning');
    else cb.onLog(e instanceof Error ? e.message : String(e), 'error');
    if (importAt?.started()) {
      cb.onLog(`${importAt.target.name} may still finish importing; check it before running again.`, 'warning');
    }
    return failed;
  } finally {
    // The target imports from the package it assembled under this transfer and keeps syncing in the background
    // after GetBlobState reports Consumed; deleting the transfer there removes that package and the unsynced items.
    const importing = importAt?.started() ? importAt.target : undefined;
    await cleanup(client, envs.filter((e) => e !== importing), transferId, cb);
  }
}

async function fetchChunk(
  client: SdkClient,
  env: Env,
  transferId: string,
  chunksetId: string,
  chunkId: number,
): Promise<{ blob: Blob; isMedia: boolean }> {
  // mutate, not query: query() keeps every result in the ClientSDK cache, which would hold every chunk Blob.
  const { data, response } = await call<Blob>(client, env, 'mutate', CT + 'getChunk', { path: { transferId, chunksetId, chunkId } });
  // Never pass a non-binary body on to a target or a package.
  if (!(data instanceof Blob)) throw new Error(`${env.name} returned no data for chunk ${chunkId + 1} of chunk set ${chunksetId}.`);
  return { blob: data, isMedia: parseIsMedia(response?.headers.get('content-disposition') ?? null) };
}

async function completeSets(client: SdkClient, env: Env, transferId: string, chunksetIds: string[], signal?: AbortSignal) {
  const files: string[] = [];
  for (const chunksetId of chunksetIds) {
    signal?.throwIfAborted();
    const { data } = await call<{ ContentTransferFileName?: string }>(
      client, env, 'mutate', CT + 'completeChunkSetTransfer', { path: { transferId, chunksetId } },
    );
    if (!data?.ContentTransferFileName) throw new Error(`${env.name} returned no file name for chunk set ${chunksetId}.`);
    files.push(data.ContentTransferFileName);
  }
  return files;
}

// Creates the content transfer job for `dataTrees` on `env`, which packages them there.
async function createJob(client: SdkClient, env: Env, transferId: string, dataTrees: DataTree[], cb: RunCallbacks, signal?: AbortSignal) {
  signal?.throwIfAborted();
  await call(client, env, 'mutate', CT + 'createContentTransfer', {
    body: { transferId, configuration: { dataTrees: await expandTrees(client, env, dataTrees, cb, signal) } },
  });
}

// Downloads every chunk of a ready package; `onChunk(n, total)` runs before chunk n (1-based) is fetched.
async function downloadChunks(
  client: SdkClient,
  env: Env,
  transferId: string,
  sets: ChunkSet[],
  onChunk: (n: number, total: number) => void,
  signal?: AbortSignal,
): Promise<ChunkData[]> {
  const total = sets.reduce((n, s) => n + s.ChunkCount, 0);
  const chunks: ChunkData[] = [];
  for (const [chunkSet, set] of sets.entries()) {
    for (let index = 0; index < set.ChunkCount; index++) {
      signal?.throwIfAborted();
      onChunk(chunks.length + 1, total);
      const { blob, isMedia } = await fetchChunk(client, env, transferId, set.ChunkSetId, index);
      chunks.push({ chunkSet, index, isMedia, data: blob });
    }
  }
  return chunks;
}

// The package's item list. The ID is only metadata: a failed lookup leaves it empty rather than failing the package.
async function packageItems(client: SdkClient, env: Env, dataTrees: DataTree[], signal?: AbortSignal): Promise<PackageItem[]> {
  const items: PackageItem[] = [];
  for (const t of dataTrees) {
    signal?.throwIfAborted();
    const id = (await fetchItemId(client, env, t.itemPath).catch(() => null)) ?? '';
    items.push({ path: t.itemPath, id, scope: t.scope, mergeStrategy: t.mergeStrategy });
  }
  return items;
}

/**
 * What to back up from the target before a transfer, so that installing the backup puts it back: every row that can
 * overwrite (not "Keep what's there"), and with a pre-flight check only items the target has as the same item.
 * A tree comes back with "Replace it and everything below", which also removes what the transfer added under it.
 */
export function backupTreesFor(trees: DataTree[], checks?: Map<string, ItemCheck>): DataTree[] {
  return trees.flatMap((t): DataTree[] => {
    if (t.mergeStrategy === 'KeepExistingItem') return [];
    if (checks && checks.get(t.itemPath)?.onTarget !== 'same') return [];
    return t.scope === 'ItemAndDescendants'
      ? [{ itemPath: t.itemPath, scope: 'ItemAndDescendants', mergeStrategy: 'OverrideExistingTree' }]
      : [{ itemPath: t.itemPath, scope: t.scope, mergeStrategy: 'OverrideExistingItem' }];
  });
}

// Exports `trees` from the target under a job of its own, which is always cleaned up: it is never imported anywhere.
// Returns null when the target has none of them.
async function backUp(client: SdkClient, target: Env, trees: DataTree[], cb: RunCallbacks, signal?: AbortSignal): Promise<Blob | null> {
  const backupId = crypto.randomUUID();
  try {
    await createJob(client, target, backupId, trees, cb, signal);
    const sets = await waitForPackage(client, target, backupId, signal, true);
    if (!sets.some((s) => s.ChunkCount > 0)) return null;
    const chunks = await downloadChunks(client, target, backupId, sets, (n, total) => {
      cb.onLog(`Backup chunk ${n} / ${total}`, 'info');
      cb.onProgress(Math.round((BACKUP_SHARE * (n - 1)) / total));
    }, signal);
    const zip = await buildPackage(chunks, await packageItems(client, target, trees, signal));
    signal?.throwIfAborted();
    return zip;
  } finally {
    await cleanup(client, [target], backupId, cb);
  }
}

export async function runTransfer(
  client: SdkClient,
  /** `backup`: what to export from the target first (see backupTreesFor); empty or left out for no backup step. */
  opts: { source: Env; target: Env; database: string; dataTrees: DataTree[]; backup?: DataTree[] },
  cb: RunCallbacks,
  signal?: AbortSignal,
): Promise<boolean> {
  const { source, target, database, dataTrees } = opts;
  const backup = opts.backup?.length ? opts.backup : undefined;
  // With a backup it is step 0 and takes the first part of the progress bar; every other step moves along by one.
  const o = backup ? 1 : 0;
  const pct = (p: number) => (backup ? Math.round(BACKUP_SHARE + (p * (100 - BACKUP_SHARE)) / 100) : p);
  const transferId = crypto.randomUUID();
  // Set once the target accepts an import: from then on it may finish even if this run fails.
  let importing = false;
  return runSteps(client, [source, target], transferId, cb, signal, false, async ({ begin, done }) => {
    if (backup) {
      begin(0, `Backing up ${target.name}.`);
      const zip = await backUp(client, target, backup, cb, signal).catch((e) => {
        if (signal?.aborted) throw e;
        const reason = (e instanceof Error ? e.message : String(e)).replace(/\.?$/, '.');
        throw new Error(`Backup of ${target.name} failed: ${reason} Nothing was written to ${target.name}; to transfer without a backup, untick it on Review.`);
      });
      if (zip) {
        cb.onBackup?.(zip);
        cb.onLog(`Backed up ${target.name}.`, 'success');
      } else cb.onLog(`Nothing on ${target.name} to back up.`, 'info');
      done(BACKUP_SHARE);
    }

    begin(o, `Creating transfer job on ${source.name}.`);
    await createJob(client, source, transferId, dataTrees, cb, signal);
    done(pct(5));

    begin(o + 1, `Waiting for ${source.name} to build the package.`);
    const sets = await waitForPackage(client, source, transferId, signal);
    cb.onInfo?.(infoOf(sets));
    done(pct(15));

    begin(o + 2, `Copying chunks from ${source.name} to ${target.name}.`);
    const total = sets.reduce((n, s) => n + s.ChunkCount, 0);
    let copied = 0;
    for (const set of sets) {
      for (let chunkId = 0; chunkId < set.ChunkCount; chunkId++) {
        signal?.throwIfAborted();
        cb.onLog(`Copying chunk ${copied + 1} / ${total}`, 'info');
        const path = { transferId, chunksetId: set.ChunkSetId, chunkId };
        const { blob, isMedia } = await fetchChunk(client, source, transferId, set.ChunkSetId, chunkId);
        signal?.throwIfAborted();
        await call(client, target, 'mutate', CT + 'saveChunk', { path, query: { isMedia }, body: blob });
        copied++;
        cb.onProgress(pct(Math.round(15 + (60 * copied) / total)));
      }
    }
    done(pct(75));

    begin(o + 3, `Assembling the package on ${target.name}.`);
    const files = await completeSets(client, target, transferId, sets.map((s) => s.ChunkSetId), signal);
    done(pct(80));

    begin(o + 4, `Importing into ${database} on ${target.name}.`);
    await consumeFiles(client, target, database, files, signal, () => (importing = true));
    done(pct(88));

    begin(o + 5, `Verifying the import on ${target.name}.`);
    await verifyFiles(client, target, files, cb, signal);
    done(100);
    cb.onLog('Transfer complete.', 'success');
    return true;
  }, { target, started: () => importing });
}

export async function runExport(
  client: SdkClient,
  opts: { source: Env; dataTrees: DataTree[] },
  cb: RunCallbacks,
  signal?: AbortSignal,
): Promise<Blob | null> {
  const { source, dataTrees } = opts;
  const transferId = crypto.randomUUID();
  return runSteps<Blob | null>(client, [source], transferId, cb, signal, null, async ({ begin, done }) => {
    begin(0, `Creating transfer job on ${source.name}.`);
    await createJob(client, source, transferId, dataTrees, cb, signal);
    done(10);

    begin(1, `Waiting for ${source.name} to build the package.`);
    const sets = await waitForPackage(client, source, transferId, signal);
    cb.onInfo?.(infoOf(sets));
    done(30);

    begin(2, `Downloading the package from ${source.name}.`);
    const chunks = await downloadChunks(client, source, transferId, sets, (n, total) => {
      cb.onLog(`Downloading chunk ${n} / ${total}`, 'info');
      cb.onProgress(Math.round(30 + (65 * (n - 1)) / total));
    }, signal);
    const zip = await buildPackage(chunks, await packageItems(client, source, dataTrees, signal));
    signal?.throwIfAborted();
    done(100);
    cb.onLog('Export complete.', 'success');
    return zip;
  });
}

export async function runImport(
  client: SdkClient,
  opts: { target: Env; database: string; parts: PackagePart[] },
  cb: RunCallbacks,
  signal?: AbortSignal,
): Promise<boolean> {
  const { target, database, parts } = opts;
  const transferId = crypto.randomUUID();
  // Set once the target accepts an import: from then on it may finish even if this run fails.
  let importing = false;
  const chunksetIds = parts.map(() => crypto.randomUUID());
  return runSteps(client, [target], transferId, cb, signal, false, async ({ begin, done }) => {
    begin(0, `Uploading the package to ${target.name}.`);
    const total = parts.reduce((n, p) => n + p.chunks.length, 0);
    let sent = 0;
    for (const [i, part] of parts.entries()) {
      for (const [chunkId, { data, isMedia }] of part.chunks.entries()) {
        signal?.throwIfAborted();
        cb.onLog(`Uploading chunk ${sent + 1} / ${total}`, 'info');
        await call(client, target, 'mutate', CT + 'saveChunk', {
          path: { transferId, chunksetId: chunksetIds[i], chunkId },
          query: { isMedia },
          body: data,
        });
        sent++;
        cb.onProgress(Math.round((50 * sent) / total));
      }
    }
    done(50);

    begin(1, `Assembling the package on ${target.name}.`);
    const files = await completeSets(client, target, transferId, chunksetIds, signal);
    done(65);

    begin(2, `Importing into ${database} on ${target.name}.`);
    await consumeFiles(client, target, database, files, signal, () => (importing = true));
    done(80);

    begin(3, `Verifying the import on ${target.name}.`);
    await verifyFiles(client, target, files, cb, signal);
    done(100);
    cb.onLog('Import complete.', 'success');
    return true;
  }, { target, started: () => importing });
}
