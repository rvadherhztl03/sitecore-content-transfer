import { SdkError, call, type Env, type SdkClient } from '@/lib/sdk';

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
      if (!sets.length) throw new Error('Source returned no content for the selected paths. Check that they exist.');
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

export async function runTransfer(
  client: SdkClient,
  opts: { source: Env; target: Env; database: string; dataTrees: DataTree[] },
  cb: RunCallbacks,
  signal?: AbortSignal,
): Promise<boolean> {
  const { source, target, database, dataTrees } = opts;
  const transferId = crypto.randomUUID();
  let step = 0;
  const begin = (i: number, message: string) => {
    step = i;
    cb.onStepChange(i, 'running');
    cb.onLog(message, 'info');
  };
  const done = (percent: number) => {
    cb.onStepChange(step, 'done');
    cb.onProgress(percent);
  };

  try {
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
        cb.onLog(`Copying chunk ${copied + 1} / ${total}`, 'info');
        const path = { transferId, chunksetId: set.ChunkSetId, chunkId };
        signal?.throwIfAborted();
        const { data, response } = await call<Blob>(client, source, 'query', CT + 'getChunk', { path });
        // Never write a non-binary body into the target.
        if (!(data instanceof Blob)) throw new Error(`${source.name} returned no data for chunk ${copied + 1} / ${total}.`);
        const isMedia = parseIsMedia(response?.headers.get('content-disposition') ?? null);
        signal?.throwIfAborted();
        await call(client, target, 'mutate', CT + 'saveChunk', { path, query: { isMedia }, body: data });
        copied++;
        cb.onProgress(Math.round(15 + (60 * copied) / total));
      }
    }
    done(75);

    begin(3, `Assembling the package on ${target.name}.`);
    const files: string[] = [];
    for (const set of sets) {
      signal?.throwIfAborted();
      const { data } = await call<{ ContentTransferFileName: string }>(
        client, target, 'mutate', CT + 'completeChunkSetTransfer', { path: { transferId, chunksetId: set.ChunkSetId } },
      );
      files.push(data.ContentTransferFileName);
    }
    done(80);

    begin(4, `Importing into ${database} on ${target.name}.`);
    await consumeFiles(client, target, database, files, signal);
    done(88);

    begin(5, `Verifying the import on ${target.name}.`);
    await verifyFiles(client, target, files, cb, signal);
    done(100);
    cb.onLog('Transfer complete.', 'success');
    return true;
  } catch (e) {
    cb.onStepChange(step, 'fail');
    if (signal?.aborted) cb.onLog('Cancelled.', 'warning');
    else cb.onLog(e instanceof Error ? e.message : String(e), 'error');
    return false;
  } finally {
    await cleanup(client, [source, target], transferId, cb);
  }
}
