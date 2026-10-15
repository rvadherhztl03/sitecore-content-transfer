import { buildPackage, type ChunkData, type PackageItem, type PackagePart } from '@/lib/package';
import { SdkError, call, fetchItemId, type Env, type SdkClient } from '@/lib/sdk';

export type Scope = 'SingleItem' | 'ItemAndDescendants';
export type MergeStrategy = 'OverrideExistingItem' | 'KeepExistingItem' | 'LatestWin' | 'OverrideExistingTree';
export type DataTree = { itemPath: string; scope: Scope; mergeStrategy: MergeStrategy };
export type LogType = 'info' | 'success' | 'warning' | 'error';
export type StepStatus = 'pending' | 'running' | 'done' | 'fail';

export interface RunCallbacks {
  onLog(message: string, type: LogType): void;
  onProgress(percent: number): void;
  onStepChange(index: number, status: StepStatus): void;
}

export const TRANSFER_STEPS = ['Create job', 'Wait for package', 'Copy chunks', 'Assemble on target', 'Import into database', 'Verify'];
export const EXPORT_STEPS = ['Create job', 'Wait for package', 'Download & zip'];
export const IMPORT_STEPS = ['Upload package', 'Assemble on target', 'Import into database', 'Verify'];
export const TIMING = { pollMs: 3000, statusTimeoutMs: 600_000, verifyTimeoutMs: 300_000 };
export const BLOB_SUCCESS = ['OK', 'Transferred', 'Consumed'];
export const BLOB_FAILURE = ['Error', 'Failed'];

const CT = 'xmc.contentTransfer.';

type ChunkSet = { ChunkSetId: string; ChunkCount: number };

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

export async function waitForPackage(client: SdkClient, env: Env, transferId: string, signal?: AbortSignal): Promise<ChunkSet[]> {
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
      if (!sets.some((s) => s.ChunkCount > 0)) throw new Error('Source returned no content for the selected paths. Check that they exist.');
      return sets;
    }
    if (data?.State === 'Failed') throw new Error('The source environment reported the transfer as Failed.');
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the source package.');
    await sleep(TIMING.pollMs, signal);
  }
}

export async function consumeFiles(client: SdkClient, env: Env, database: string, files: string[], signal?: AbortSignal) {
  for (const fileName of files) {
    signal?.throwIfAborted();
    await call(client, env, 'query', CT + 'consumeFile', { query: { databaseName: database, fileName } });
  }
}

export async function verifyFiles(client: SdkClient, env: Env, files: string[], cb: RunCallbacks, signal?: AbortSignal) {
  for (const fileName of files) {
    const deadline = Date.now() + TIMING.verifyTimeoutMs;
    for (;;) {
      signal?.throwIfAborted();
      const { data } = await call<{ status?: string }>(client, env, 'query', CT + 'getBlobState', { query: { fileName } });
      const status = data?.status ?? '';
      if (BLOB_SUCCESS.includes(status)) {
        cb.onLog(`Imported ${fileName} (${status}).`, 'success');
        break;
      }
      if (BLOB_FAILURE.includes(status)) throw new Error(`Import failed on ${env.name}: ${status}`);
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
// returns `failed`, and always cleans up `envs`. From `importAt.step` on, the target may already be
// importing, so a failure or cancel also warns that it may still finish.
async function runSteps<T>(
  client: SdkClient,
  envs: Env[],
  transferId: string,
  cb: RunCallbacks,
  signal: AbortSignal | undefined,
  failed: T,
  body: (steps: Steps) => Promise<T>,
  importAt?: { step: number; target: Env },
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
    if (importAt && step >= importAt.step) {
      cb.onLog(`${importAt.target.name} may still finish importing; check it before running again.`, 'warning');
    }
    return failed;
  } finally {
    await cleanup(client, envs, transferId, cb);
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

export async function runTransfer(
  client: SdkClient,
  opts: { source: Env; target: Env; database: string; dataTrees: DataTree[] },
  cb: RunCallbacks,
  signal?: AbortSignal,
): Promise<boolean> {
  const { source, target, database, dataTrees } = opts;
  const transferId = crypto.randomUUID();
  return runSteps(client, [source, target], transferId, cb, signal, false, async ({ begin, done }) => {
    begin(0, `Creating transfer job on ${source.name}.`);
    signal?.throwIfAborted();
    await call(client, source, 'mutate', CT + 'createContentTransfer', {
      body: { transferId, configuration: { dataTrees } },
    });
    done(5);

    begin(1, `Waiting for ${source.name} to build the package.`);
    const sets = await waitForPackage(client, source, transferId, signal);
    done(15);

    begin(2, `Copying chunks from ${source.name} to ${target.name}.`);
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
        cb.onProgress(Math.round(15 + (60 * copied) / total));
      }
    }
    done(75);

    begin(3, `Assembling the package on ${target.name}.`);
    const files = await completeSets(client, target, transferId, sets.map((s) => s.ChunkSetId), signal);
    done(80);

    begin(4, `Importing into ${database} on ${target.name}.`);
    await consumeFiles(client, target, database, files, signal);
    done(88);

    begin(5, `Verifying the import on ${target.name}.`);
    await verifyFiles(client, target, files, cb, signal);
    done(100);
    cb.onLog('Transfer complete.', 'success');
    return true;
  }, { step: TRANSFER_STEPS.indexOf('Import into database'), target });
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
    signal?.throwIfAborted();
    await call(client, source, 'mutate', CT + 'createContentTransfer', {
      body: { transferId, configuration: { dataTrees } },
    });
    done(10);

    begin(1, `Waiting for ${source.name} to build the package.`);
    const sets = await waitForPackage(client, source, transferId, signal);
    done(30);

    begin(2, `Downloading the package from ${source.name}.`);
    const total = sets.reduce((n, s) => n + s.ChunkCount, 0);
    const chunks: ChunkData[] = [];
    for (const [chunkSet, set] of sets.entries()) {
      for (let index = 0; index < set.ChunkCount; index++) {
        signal?.throwIfAborted();
        cb.onLog(`Downloading chunk ${chunks.length + 1} / ${total}`, 'info');
        const { blob, isMedia } = await fetchChunk(client, source, transferId, set.ChunkSetId, index);
        chunks.push({ chunkSet, index, isMedia, data: blob });
        cb.onProgress(Math.round(30 + (65 * chunks.length) / total));
      }
    }
    const items: PackageItem[] = [];
    for (const t of dataTrees) {
      signal?.throwIfAborted();
      // The ID is only metadata in the package: a failed lookup shouldn't fail the export.
      const id = (await fetchItemId(client, source, t.itemPath).catch(() => null)) ?? '';
      items.push({ path: t.itemPath, id, scope: t.scope, mergeStrategy: t.mergeStrategy });
    }
    const zip = await buildPackage(chunks, items);
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
    await consumeFiles(client, target, database, files, signal);
    done(80);

    begin(3, `Verifying the import on ${target.name}.`);
    await verifyFiles(client, target, files, cb, signal);
    done(100);
    cb.onLog('Import complete.', 'success');
    return true;
  }, { step: IMPORT_STEPS.indexOf('Import into database'), target });
}
