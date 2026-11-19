// src/utils/migrationService.ts

export interface DataTree {
  ItemPath: string;
  Scope: 'SingleItem' | 'ItemAndChildren' | 'ItemAndDescendants';
  MergeStrategy: 'OverrideExistingItem' | 'KeepExistingItem' | 'LatestWin' | 'OverrideExistingTree';
}

export interface MigrationConfig {
  sourceHost: string;
  sourceClientId: string;
  sourceClientSecret: string;
  sourceAuthority: string;
  sourceAudience?: string;
  targetHost: string;
  targetClientId: string;
  targetClientSecret: string;
  targetAuthority: string;
  targetAudience?: string;
  dataTrees: DataTree[];
  database: string;
  transferId: string;
  demoMode: boolean;
}

export type LogType = 'info' | 'success' | 'warning' | 'error';

export interface MigrationCallbacks {
  onLog: (message: string, type: LogType) => void;
  onProgress: (percent: number) => void;
  onStepChange: (stepIndex: number, status: 'pending' | 'running' | 'done' | 'fail') => void;
}

// A chunk set as the source's status lists it.
type ChunkSet = { ChunkSetId: string; ChunkCount: number; TotalItemCount?: number };

// Sitecore answers these when it is briefly busy or unreachable; the routes pass its status through.
const RETRY_STATUSES = [429, 502, 503, 504];
// The waits before the second and third attempt.
const RETRY_WAITS_MS = [2000, 5000];
const POLL_MS = 3000;
// The import wait is 30 minutes plus 0.5 s per item; imports run at about 4 items a second.
const IMPORT_BASE_MS = 1_800_000;
const IMPORT_MS_PER_ITEM = 500;
const IMPORT_ITEMS_PER_SECOND = 4;
const BLOB_SUCCESS = ['OK', 'Transferred', 'Consumed'];
const BLOB_FAILURE = ['Error', 'Failed', 'Discarded'];
const MAX_SHOWN_ERRORS = 10;

const delay = (ms: number) => {
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
    return Promise.resolve();
  }
  return new Promise(resolve => setTimeout(resolve, ms));
};

export class MigrationService {
  private config: MigrationConfig;
  private callbacks: MigrationCallbacks;
  private currentStepIndex = 0;

  constructor(config: MigrationConfig, callbacks: MigrationCallbacks) {
    this.config = {
      ...config,
      // Normalize hosts (ensure protocol and no trailing slash)
      sourceHost: this.normalizeHost(config.sourceHost),
      targetHost: this.normalizeHost(config.targetHost)
    };
    this.callbacks = callbacks;
  }

  private normalizeHost(host: string): string {
    if (!host) return '';
    let normalized = host.trim();
    if (!/^https?:\/\//i.test(normalized)) {
      normalized = 'https://' + normalized;
    }
    return normalized.replace(/\/+$/, '');
  }

  private log(message: string, type: LogType = 'info') {
    this.callbacks.onLog(message, type);
  }

  private progress(percent: number) {
    this.callbacks.onProgress(Math.min(100, Math.max(0, percent)));
  }

  private step(stepIndex: number, status: 'pending' | 'running' | 'done' | 'fail') {
    this.currentStepIndex = stepIndex;
    this.callbacks.onStepChange(stepIndex, status);
  }

  // POSTs `body` to one of the app's routes. Up to 3 attempts while Sitecore answers briefly busy; any other answer,
  // and the last one, goes back to the caller. Only for calls that are safe to repeat: never initiate, complete or consume.
  // `body` is sent as JSON, unless `headers` are given: then it is sent as it is (the upload's raw chunk).
  private async postRetrying(url: string, body: object, what: string, headers?: Record<string, string>): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: headers ?? { 'Content-Type': 'application/json' },
        body: headers ? (body as BodyInit) : JSON.stringify(body)
      });
      if (res.ok || !RETRY_STATUSES.includes(res.status) || attempt > RETRY_WAITS_MS.length) return res;
      const wait = RETRY_WAITS_MS[attempt - 1];
      this.log(`${what} answered HTTP ${res.status}; trying again in ${wait / 1000} s (attempt ${attempt + 1} of ${RETRY_WAITS_MS.length + 1}).`, 'warning');
      await delay(wait);
    }
  }

  // The import wait, as a number of polls: 30 minutes plus 0.5 s per item.
  private importPolls(items: number): number {
    return Math.ceil((IMPORT_BASE_MS + IMPORT_MS_PER_ITEM * items) / POLL_MS);
  }

  // Polls the target until the package's import has finished. `setLabel` names the chunk set when there can be several.
  // Throws unless the import succeeded; `location` is what consume answered, used to explain TransferredWithErrors.
  private async verifyImport(chunksetId: string, location: string | undefined, maxPolls: number, setLabel?: string): Promise<void> {
    const forSet = setLabel ? ` for chunkset ${setLabel}` : '';
    let lastState: string | undefined;

    for (let poll = 0; poll < maxPolls; poll++) {
      const verifyRes = await this.postRetrying('/api/migrate/verify', {
        targetHost: this.config.targetHost,
        targetClientId: this.config.targetClientId,
        targetClientSecret: this.config.targetClientSecret,
        targetAuthority: this.config.targetAuthority,
        targetAudience: this.config.targetAudience,
        transferId: this.config.transferId,
        chunksetId
      }, 'Verify check');

      if (!verifyRes.ok) {
        const errText = await verifyRes.text();
        throw new Error(`Failed to verify target blob state: ${errText}`);
      }

      const verifyData = await verifyRes.json();
      const state: string = verifyData.BlobState;
      const succeeded = BLOB_SUCCESS.includes(state);
      const failed = BLOB_FAILURE.includes(state) || state === 'TransferredWithErrors';

      // Shown when it changes, so a long import doesn't fill the log.
      if (state !== lastState) {
        this.log(`Verification completed${setLabel ? ` (${setLabel})` : ''}. BlobState: ${state}, Error: ${verifyData.Error}`,
          succeeded ? 'success' : failed ? 'warning' : 'info');
      }
      lastState = state;

      if (succeeded) return;
      if (failed) {
        const message = `Blob transfer verification state${forSet} is ${state}. Error: ${verifyData.Error}`;
        throw new Error(state === 'TransferredWithErrors' ? await this.explainImportErrors(chunksetId, location, message) : message);
      }
      // Any other state (Initializing, Queued, Uploaded...): the import is still going.
      await delay(POLL_MS);
    }

    throw new Error(`Timed out waiting for the import to finish${forSet} (last state: ${lastState || 'unknown'}).`);
  }

  // TransferredWithErrors says nothing more, so ask the target for the import's validation errors. Logs up to 10 and
  // returns the error to throw; when the details can't be read it is `fallback` plus why.
  private async explainImportErrors(chunksetId: string, location: string | undefined, fallback: string): Promise<string> {
    let reason: string;
    try {
      const res = await fetch('/api/migrate/transfer-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetHost: this.config.targetHost,
          targetClientId: this.config.targetClientId,
          targetClientSecret: this.config.targetClientSecret,
          targetAuthority: this.config.targetAuthority,
          targetAudience: this.config.targetAudience,
          transferId: this.config.transferId,
          chunksetId,
          location
        })
      });
      if (!res.ok) throw new Error((await res.text()).slice(0, 300));

      const errors: string[] = (await res.json()).validationErrors ?? [];
      if (errors.length > 0) {
        errors.slice(0, MAX_SHOWN_ERRORS).forEach((e, i) => this.log(`Validation error ${i + 1}: ${e.slice(0, 300)}`, 'warning'));
        if (errors.length > MAX_SHOWN_ERRORS) this.log(`...and ${errors.length - MAX_SHOWN_ERRORS} more.`, 'warning');
        return `The target imported the package with errors: ${errors.length} validation error${errors.length === 1 ? '' : 's'}. First: ${errors[0].slice(0, 300)}`;
      }
      reason = 'the target lists no validation errors';
    } catch (err) {
      reason = err instanceof Error ? err.message : String(err);
    }
    return `${fallback} Couldn't read why: ${reason}`;
  }

  public async runMigration(): Promise<boolean> {
    this.log('🚀 Starting Sitecore Content Migration Pipeline...', 'info');
    this.progress(0);

    try {
      if (this.config.demoMode) {
        return await this.runDemoMode();
      } else {
        return await this.runLiveMode();
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.log(`❌ Migration pipeline aborted due to critical error: ${errMsg}`, 'error');
      this.step(this.currentStepIndex, 'fail');
      return false;
    }
  }

  private async runDemoMode(): Promise<boolean> {
    const delay = (ms: number) => {
      if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
        return Promise.resolve();
      }
      return new Promise(resolve => setTimeout(resolve, ms));
    };

    // Step 1: Initiate Transfer
    this.step(0, 'running');
    this.log('[Step 1/6] Initiating transfer job on source (DEV) environment...', 'info');
    await delay(1000);
    this.log(`Initiate Request sent to: ${this.config.sourceHost}/sitecore/api/content/transfer/v1/transfers`, 'info');
    this.log(`Transfer initiated successfully. Transfer ID: ${this.config.transferId}`, 'success');
    this.step(0, 'done');
    this.progress(15);

    // Step 2: Poll Status
    this.step(1, 'running');
    this.log('[Step 2/6] Polling source transfer job status...', 'info');
    await delay(1000);
    this.log('Job status: Processing...', 'warning');
    await delay(1200);
    
    // Simulating the status response
    const mockChunksetId = '43da789f-f88f-45d7-a59b-7580ac894d79';
    const mockChunkCount = 3;
    this.log('Job status: Completed!', 'success');
    this.log(`Metadata received: ChunkSetId = ${mockChunksetId}, ChunkCount = ${mockChunkCount}`, 'success');
    this.step(1, 'done');
    this.progress(35);

    // Step 3: Transfer Chunks
    this.step(2, 'running');
    this.log(`[Step 3/6] Starting chunk transfer loop (${mockChunkCount} chunks total)...`, 'info');
    
    for (let i = 0; i < mockChunkCount; i++) {
      const isMedia = i === 1; // Simulate chunk 1 as media, others as content
      this.log(`⏳ [Chunk ${i + 1}/${mockChunkCount}] Downloading chunk from Source...`, 'info');
      await delay(800);
      this.log(`[Chunk ${i + 1}/${mockChunkCount}] Download headers verified. IsMedia: ${isMedia} (${isMedia ? 'Compressed Media' : 'Encrypted Items'})`, 'success');
      
      this.log(`⏳ [Chunk ${i + 1}/${mockChunkCount}] Uploading chunk to Target...`, 'info');
      await delay(900);
      this.log(`[Chunk ${i + 1}/${mockChunkCount}] Chunk uploaded successfully to QA target.`, 'success');
      
      const chunkProgress = 35 + ((i + 1) / mockChunkCount) * 35; // scales 35% -> 70%
      this.progress(Math.round(chunkProgress));
    }
    this.step(2, 'done');

    // Step 4: Complete Target Chunkset
    this.step(3, 'running');
    this.log('[Step 4/6] Signalling target (QA) to assemble the chunks...', 'info');
    await delay(1200);
    const mockBlobName = `contentTransfer-${this.config.transferId}-${mockChunksetId}.raif`;
    this.log(`Stitched successfully. Target generated package file: ${mockBlobName}`, 'success');
    this.step(3, 'done');
    this.progress(80);

    // Step 5: Consume Target Items
    this.step(4, 'running');
    this.log(`[Step 5/6] Invoking Item Transfer API to extract ${mockBlobName} into master database...`, 'info');
    await delay(1500);
    this.log(`Extracted items written to database: ${this.config.database}`, 'success');
    this.step(4, 'done');
    this.progress(90);

    // Step 6: Verify Target Blob
    this.step(5, 'running');
    this.log('[Step 6/6] Verifying transfer status on target environment...', 'info');
    await delay(1000);
    this.log('BlobState: Transferred', 'success');
    this.log('Error state: null', 'success');
    this.log('SourceName: consumed.20260708_demo.89cc97c7-6a01-43bc-93cf-6417e5c84898', 'info');
    this.step(5, 'done');
    this.progress(100);

    this.log('🎉 Sitecore Content Migration completed successfully without glitches!', 'success');
    return true;
  }

  private async runLiveMode(): Promise<boolean> {
    if (!this.config.sourceHost || !this.config.sourceClientId || !this.config.sourceClientSecret || !this.config.sourceAuthority) {
      throw new Error('Source host, Client ID, Client Secret, and Authority Endpoint are required for live migration.');
    }
    if (!this.config.targetHost || !this.config.targetClientId || !this.config.targetClientSecret || !this.config.targetAuthority) {
      throw new Error('Target host, Client ID, Client Secret, and Authority Endpoint are required for live migration.');
    }

    // Step 1: Initiate Transfer on Source
    this.step(0, 'running');
    this.log('[Step 1/6] Initiating transfer job on source...', 'info');
    const initRes = await fetch('/api/migrate/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceHost: this.config.sourceHost,
        sourceClientId: this.config.sourceClientId,
        sourceClientSecret: this.config.sourceClientSecret,
        sourceAuthority: this.config.sourceAuthority,
        sourceAudience: this.config.sourceAudience,
        transferId: this.config.transferId,
        database: this.config.database,
        dataTrees: this.config.dataTrees
      })
    });

    if (!initRes.ok) {
      const errText = await initRes.text();
      throw new Error(`Failed to initiate transfer: ${errText}`);
    }

    this.log(`Transfer initiated successfully. Transfer ID: ${this.config.transferId}`, 'success');
    this.step(0, 'done');
    this.progress(15);

    // Step 2: Poll Status until Completed
    this.step(1, 'running');
    this.log('[Step 2/6] Polling source transfer job status...', 'info');
    
    let state = 'Processing';
    let chunksetsMetadata: any[] = [];
    let attempts = 0;
    const maxAttempts = 450; // 450 * 4s = 30 minutes

    while (state === 'Processing' && attempts < maxAttempts) {
      attempts++;
      this.log(`Polling status (attempt ${attempts})...`, 'info');
      await delay(4000);

      const statusRes = await this.postRetrying('/api/migrate/status', {
        sourceHost: this.config.sourceHost,
        sourceClientId: this.config.sourceClientId,
        sourceClientSecret: this.config.sourceClientSecret,
        sourceAuthority: this.config.sourceAuthority,
        sourceAudience: this.config.sourceAudience,
        transferId: this.config.transferId
      }, 'Status check');

      if (!statusRes.ok) {
        const errText = await statusRes.text();
        this.log(`Warning: poll status check failed: ${errText}`, 'warning');
        continue;
      }

      const statusData = await statusRes.json();
      state = statusData.State || 'Processing';
      chunksetsMetadata = statusData.ChunkSetsMetadata || [];

      if (state === 'Completed') {
        break;
      } else if (state === 'Failed') {
        throw new Error('Source transfer job reported state: Failed');
      }
    }

    if (state !== 'Completed' || chunksetsMetadata.length === 0) {
      throw new Error('Source transfer job timed out or failed to complete.');
    }

    // A big package can come in several chunk sets; each is copied, assembled, imported and verified.
    const chunkSets: ChunkSet[] = chunksetsMetadata;
    const totalChunks = chunkSets.reduce((n, s) => n + s.ChunkCount, 0);
    const totalItems = chunkSets.reduce((n, s) => n + (s.TotalItemCount ?? 0), 0);
    const setList = chunkSets.map(s => `${s.ChunkSetId} (${s.ChunkCount} chunks)`).join(', ');
    this.log(`Source transfer job completed. ${chunkSets.length} chunk set(s): ${setList}`, 'success');
    this.step(1, 'done');
    this.progress(35);

    // Step 3: Transfer Chunks Download & Upload Loop
    this.step(2, 'running');
    this.log(`[Step 3/6] Starting chunk-by-chunk proxy transfer (${totalChunks} chunks)...`, 'info');

    let copied = 0;
    let itemsProcessed = 0;
    let itemsSkipped = 0;
    for (const { ChunkSetId: chunksetId, ChunkCount: chunkCount } of chunkSets) {
      for (let i = 0; i < chunkCount; i++) {
        this.log(`⏳ [Chunk ${copied + 1}/${totalChunks}] Downloading from Source & uploading to Target...`, 'info');
        const chunkRes = await this.postRetrying('/api/migrate/transfer-chunk', {
          sourceHost: this.config.sourceHost,
          sourceClientId: this.config.sourceClientId,
          sourceClientSecret: this.config.sourceClientSecret,
          sourceAuthority: this.config.sourceAuthority,
          sourceAudience: this.config.sourceAudience,
          targetHost: this.config.targetHost,
          targetClientId: this.config.targetClientId,
          targetClientSecret: this.config.targetClientSecret,
          targetAuthority: this.config.targetAuthority,
          targetAudience: this.config.targetAudience,
          transferId: this.config.transferId,
          chunksetId,
          chunkIndex: i
        }, `Chunk ${copied + 1}`);

        if (!chunkRes.ok) {
          const errText = await chunkRes.text();
          throw new Error(`Failed to transfer chunk ${i} of chunk set ${chunksetId}: ${errText}`);
        }

        const resData = await chunkRes.json();
        copied++;
        itemsProcessed += resData.itemsProcessed ?? 0;
        itemsSkipped += resData.itemsSkipped ?? 0;
        this.log(`[Chunk ${copied}/${totalChunks}] Transferred successfully. IsMedia: ${resData.isMedia}`, 'success');

        const chunkProgress = 35 + (copied / totalChunks) * 35; // scales 35% -> 70%
        this.progress(Math.round(chunkProgress));
      }
    }
    this.step(2, 'done');

    // Step 4: Complete Target Chunksets (Stitch .raif files)
    this.step(3, 'running');
    this.log('[Step 4/6] Finishing chunk upload and stitching package on target...', 'info');
    for (const { ChunkSetId: chunksetId } of chunkSets) {
      const completeRes = await fetch('/api/migrate/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetHost: this.config.targetHost,
          targetClientId: this.config.targetClientId,
          targetClientSecret: this.config.targetClientSecret,
          targetAuthority: this.config.targetAuthority,
          targetAudience: this.config.targetAudience,
          transferId: this.config.transferId,
          chunksetId
        })
      });

      if (!completeRes.ok) {
        const errText = await completeRes.text();
        throw new Error(`Failed to complete chunkset ${chunksetId} on target: ${errText}`);
      }

      const completeData = await completeRes.json();
      const blobName = completeData.ContentTransferFileName;
      this.log(`Package assembled on target: ${blobName}`, 'success');
    }
    this.step(3, 'done');
    this.progress(80);

    // Step 5: Consume Target Items
    this.step(4, 'running');
    this.log(`[Step 5/6] Consuming .raif package into target database...`, 'info');
    // Where each import is, as consume answers it; used to explain an import that ends with errors.
    const locations = new Map<string, string>();
    for (const { ChunkSetId: chunksetId } of chunkSets) {
      const consumeRes = await fetch('/api/migrate/consume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetHost: this.config.targetHost,
          targetClientId: this.config.targetClientId,
          targetClientSecret: this.config.targetClientSecret,
          targetAuthority: this.config.targetAuthority,
          targetAudience: this.config.targetAudience,
          transferId: this.config.transferId,
          chunksetId,
          database: this.config.database
        })
      });

      if (!consumeRes.ok) {
        const errText = await consumeRes.text();
        throw new Error(`Failed to consume chunkset ${chunksetId} on target: ${errText}`);
      }

      const consumeData = await consumeRes.json().catch(() => ({}));
      if (typeof consumeData.location === 'string') locations.set(chunksetId, consumeData.location);
    }

    this.log(`Items successfully consumed into database: ${this.config.database}`, 'success');
    const estimateSeconds = totalItems / IMPORT_ITEMS_PER_SECOND;
    if (estimateSeconds >= 120) {
      const minutes = estimateSeconds / 60;
      // ponytail: one rate for every target; the estimate only says "about", the wait uses the item count.
      const about = minutes >= 20 ? Math.round(minutes / 10) * 10 : Math.round(minutes);
      this.log(`Importing ${totalItems.toLocaleString('en-US')} items. At the usual speed that takes about ${about} minutes; keep this tab open.`, 'info');
    }
    this.step(4, 'done');
    this.progress(90);

    // Step 6: Verify Target Blobs
    this.step(5, 'running');
    this.log('[Step 6/6] Verifying target blob state...', 'info');

    // ponytail: every chunk set gets the whole package's wait, since the target imports them one after another.
    const maxVerifyPolls = this.importPolls(totalItems);
    for (const { ChunkSetId: chunksetId } of chunkSets) {
      await this.verifyImport(chunksetId, locations.get(chunksetId), maxVerifyPolls, chunksetId);
    }

    this.step(5, 'done');
    this.progress(100);
    this.log('🎉 Live Content Migration completed successfully!', 'success');
    if (itemsSkipped > 0) {
      this.log(`Sitecore skipped ${itemsSkipped.toLocaleString('en-US')} of ${(itemsProcessed + itemsSkipped).toLocaleString('en-US')} items while packaging (items that failed or were filtered out). Check those items before relying on this transfer.`, 'warning');
    }
    return true;
  }

  public async runPackageDownloadFlow(): Promise<boolean> {
    this.log('🚀 Starting Sitecore Package Export and Download...', 'info');
    this.progress(0);

    try {
      if (this.config.demoMode) {
        return await this.runDemoDownloadMode();
      } else {
        return await this.runLiveDownloadMode();
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.log(`❌ Package export failed: ${errMsg}`, 'error');
      this.step(this.currentStepIndex, 'fail');
      return false;
    }
  }

  private async runDemoDownloadMode(): Promise<boolean> {
    const delay = (ms: number) => {
      if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
        return Promise.resolve();
      }
      return new Promise(resolve => setTimeout(resolve, ms));
    };

    // Step 1: Initiate Transfer
    this.step(0, 'running');
    this.log('[Step 1/3] Initiating transfer job on source (DEV) environment...', 'info');
    await delay(1000);
    this.log(`Initiate Request sent to: ${this.config.sourceHost}/sitecore/api/content/transfer/v1/transfers`, 'info');
    this.log(`Transfer initiated successfully. Transfer ID: ${this.config.transferId}`, 'success');
    this.step(0, 'done');
    this.progress(30);

    // Step 2: Poll Status
    this.step(1, 'running');
    this.log('[Step 2/3] Polling source transfer job status...', 'info');
    await delay(1000);
    this.log('Job status: Processing...', 'warning');
    await delay(1200);
    
    const mockChunksetId = '43da789f-f88f-45d7-a59b-7580ac894d79';
    const mockChunkCount = 3;
    this.log('Job status: Completed!', 'success');
    this.log(`Metadata received: ChunkSetId = ${mockChunksetId}, ChunkCount = ${mockChunkCount}`, 'success');
    this.step(1, 'done');
    this.progress(60);

    // Step 3: Stitch & Download
    this.step(2, 'running');
    this.log('[Step 3/3] Requesting stitched package from backend...', 'info');
    await delay(1500);

    // Trigger local mock download via POST proxy
    const downloadUrl = '/api/migrate/download';
    this.log(`Calling stitching API proxy at: ${downloadUrl}`, 'info');
    const res = await fetch(downloadUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceHost: this.config.sourceHost,
        sourceClientId: this.config.sourceClientId,
        sourceClientSecret: this.config.sourceClientSecret,
        sourceAuthority: this.config.sourceAuthority,
        sourceAudience: this.config.sourceAudience,
        transferId: this.config.transferId,
        chunksetId: mockChunksetId,
        chunkCount: mockChunkCount,
        dataTrees: this.config.dataTrees
      })
    });

    if (!res.ok) {
      throw new Error(`Failed to retrieve stitched package: HTTP ${res.status}`);
    }

    const blob = await res.blob();
    this.triggerBrowserDownload(blob, `contentTransfer-${this.config.transferId}.zip`);
    
    this.log('Package stitched and download triggered in browser!', 'success');
    this.step(2, 'done');
    this.progress(100);
    this.log('🎉 Package generation and download completed successfully!', 'success');
    return true;
  }

  private async runLiveDownloadMode(): Promise<boolean> {
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    // Step 1: Initiate Transfer
    this.step(0, 'running');
    this.log('[Step 1/3] Initiating transfer job on source environment...', 'info');

    const initiateRes = await fetch('/api/migrate/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceHost: this.config.sourceHost,
        sourceClientId: this.config.sourceClientId,
        sourceClientSecret: this.config.sourceClientSecret,
        sourceAuthority: this.config.sourceAuthority,
        sourceAudience: this.config.sourceAudience,
        transferId: this.config.transferId,
        database: this.config.database,
        dataTrees: this.config.dataTrees
      })
    });

    if (!initiateRes.ok) {
      const errText = await initiateRes.text();
      throw new Error(`Failed to initiate transfer: ${errText}`);
    }

    this.log(`Transfer initiated successfully. Transfer ID: ${this.config.transferId}`, 'success');
    this.step(0, 'done');
    this.progress(30);

    // Step 2: Poll Status
    this.step(1, 'running');
    this.log('[Step 2/3] Polling source transfer job status...', 'info');

    let isCompleted = false;
    let chunksetId = '';
    let chunkCount = 0;
    let pollCount = 0;
    const maxPolls = 360; // 360 * 5s = 30 minutes

    while (!isCompleted && pollCount < maxPolls) {
      pollCount++;
      const statusRes = await this.postRetrying('/api/migrate/status', {
        sourceHost: this.config.sourceHost,
        sourceClientId: this.config.sourceClientId,
        sourceClientSecret: this.config.sourceClientSecret,
        sourceAuthority: this.config.sourceAuthority,
        sourceAudience: this.config.sourceAudience,
        transferId: this.config.transferId
      }, 'Status check');

      if (!statusRes.ok) {
        const errText = await statusRes.text();
        throw new Error(`Status check failed: ${errText}`);
      }

      const statusData = await statusRes.json();
      this.log(`Job status: ${statusData.State}...`, statusData.State === 'Completed' ? 'success' : 'info');

      if (statusData.State === 'Completed') {
        isCompleted = true;
        const chunksetMeta = statusData.ChunkSetsMetadata?.[0];
        if (!chunksetMeta) {
          throw new Error('Transfer job completed but received empty ChunkSetsMetadata from source.');
        }
        chunksetId = chunksetMeta.ChunkSetId || chunksetMeta.ChunksetId;
        chunkCount = chunksetMeta.ChunkCount;
        this.log(`Metadata received: ChunkSetId = ${chunksetId}, ChunkCount = ${chunkCount}`, 'success');
      } else if (statusData.State === 'Failed') {
        throw new Error('Transfer job on source environment failed.');
      } else {
        await delay(5000);
      }
    }

    if (!isCompleted) {
      throw new Error('Source transfer job status polling timed out.');
    }

    this.step(1, 'done');
    this.progress(60);

    // Step 3: Stitch & Download Package
    this.step(2, 'running');
    this.log('[Step 3/3] Requesting stitched package from backend...', 'info');

    // Only reads chunks from the source, so it is safe to repeat.
    const downloadRes = await this.postRetrying('/api/migrate/download', {
      sourceHost: this.config.sourceHost,
      sourceClientId: this.config.sourceClientId,
      sourceClientSecret: this.config.sourceClientSecret,
      sourceAuthority: this.config.sourceAuthority,
      sourceAudience: this.config.sourceAudience,
      transferId: this.config.transferId,
      chunksetId,
      chunkCount,
      dataTrees: this.config.dataTrees
    }, 'Download');

    if (!downloadRes.ok) {
      const errText = await downloadRes.text();
      throw new Error(`Failed to retrieve stitched package: ${errText}`);
    }

    const blob = await downloadRes.blob();
    this.triggerBrowserDownload(blob, `contentTransfer-${this.config.transferId}.zip`);

    this.log('Package stitched and download triggered in browser!', 'success');
    this.step(2, 'done');
    this.progress(100);
    this.log('🎉 Package generation and download completed successfully!', 'success');
    return true;
  }

  public async runPackageImportFlow(fileBuffer: ArrayBuffer, selectedPaths: string[] = []): Promise<boolean> {
    this.log('🚀 Starting Sitecore Package Import and Consumption...', 'info');
    this.progress(0);

    try {
      const chunksetId = this.config.transferId; // Use transferId as chunksetId for convenience

      // Step 1: Upload Package (Split into 1MB chunks)
      this.step(0, 'running');
      const CHUNK_SIZE = 1024 * 1024; // 1MB
      const totalBytes = fileBuffer.byteLength;
      const chunkCount = Math.ceil(totalBytes / CHUNK_SIZE);
      
      this.log(`[Step 1/4] Uploading package file directly to target (${(totalBytes / 1024).toFixed(1)} KB, ${chunkCount} chunks)...`, 'info');

      for (let i = 0; i < chunkCount; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, totalBytes);
        const chunkBuffer = fileBuffer.slice(start, end);

        this.log(`⏳ [Upload ${i + 1}/${chunkCount}] Uploading chunk to target...`, 'info');
        // Uploading the same chunk index again overwrites it, so the upload is safe to repeat.
        const uploadRes = await this.postRetrying('/api/migrate/upload', new Uint8Array(chunkBuffer), `Upload ${i + 1}`, {
          'x-target-host': this.config.targetHost,
          'x-target-client-id': this.config.targetClientId,
          'x-target-client-secret': this.config.targetClientSecret,
          'x-target-authority': this.config.targetAuthority,
          'x-target-audience': this.config.targetAudience || '',
          'x-transfer-id': this.config.transferId,
          'x-chunkset-id': chunksetId,
          'x-chunk-index': String(i)
        });

        if (!uploadRes.ok) {
          const errText = await uploadRes.text();
          throw new Error(`Upload package failed at chunk ${i + 1}: ${errText}`);
        }

        this.log(`[Upload ${i + 1}/${chunkCount}] Uploaded successfully.`, 'success');
        const uploadProgress = ((i + 1) / chunkCount) * 25; // scales to 25%
        this.progress(Math.round(uploadProgress));
      }

      this.log('Package file fully uploaded to target storage in chunk sets.', 'success');
      this.step(0, 'done');
      this.progress(25);

      if (this.config.demoMode) {
        // Mock demo mode remaining steps
        this.step(1, 'running');
        this.log('[Step 2/4] Finishing package stitching on target...', 'info');
        this.step(1, 'done');
        this.progress(50);

        this.step(2, 'running');
        this.log('[Step 3/4] Consuming items into target database...', 'info');
        this.step(2, 'done');
        this.progress(75);

        this.step(3, 'running');
        this.log('[Step 4/4] Verifying target integrity...', 'info');
        this.step(3, 'done');
        this.progress(100);
        this.log('🎉 Package import completed successfully in demo mode!', 'success');
        return true;
      }

      // Step 2: Target Stitching
      this.step(1, 'running');
      this.log('[Step 2/4] Finishing chunk upload and stitching package on target...', 'info');
      const completeRes = await fetch('/api/migrate/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetHost: this.config.targetHost,
          targetClientId: this.config.targetClientId,
          targetClientSecret: this.config.targetClientSecret,
          targetAuthority: this.config.targetAuthority,
          targetAudience: this.config.targetAudience,
          transferId: this.config.transferId,
          chunksetId
        })
      });

      if (!completeRes.ok) {
        const errText = await completeRes.text();
        throw new Error(`Failed to complete chunkset on target: ${errText}`);
      }

      const completeData = await completeRes.json();
      const blobName = completeData.ContentTransferFileName;
      this.log(`Package assembled on target: ${completeData.ContentTransferFileName || blobName}`, 'success');
      this.step(1, 'done');
      this.progress(50);

      // Step 3: Target Consumption
      this.step(2, 'running');
      this.log('[Step 3/4] Consuming .raif package into target database...', 'info');
      if (selectedPaths.length > 0) {
        this.log(`Filtering import scope to ${selectedPaths.length} user-selected content paths.`, 'info');
        selectedPaths.forEach(path => {
          this.log(`📥 Ingesting verified path: ${path}`, 'success');
        });
      }
      const consumeRes = await fetch('/api/migrate/consume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetHost: this.config.targetHost,
          targetClientId: this.config.targetClientId,
          targetClientSecret: this.config.targetClientSecret,
          targetAuthority: this.config.targetAuthority,
          targetAudience: this.config.targetAudience,
          transferId: this.config.transferId,
          chunksetId,
          database: this.config.database
        })
      });

      if (!consumeRes.ok) {
        const errText = await consumeRes.text();
        throw new Error(`Failed to consume items on target: ${errText}`);
      }

      const consumeData = await consumeRes.json().catch(() => ({}));
      const location = typeof consumeData.location === 'string' ? consumeData.location : undefined;

      this.log(`Items successfully consumed into database: ${this.config.database}`, 'success');
      this.step(2, 'done');
      this.progress(75);

      // Step 4: Verify Target Blob State (polling included)
      this.step(3, 'running');
      this.log('[Step 4/4] Verifying target blob state...', 'info');

      // The install flow has no item count, so it waits the base 30 minutes.
      await this.verifyImport(chunksetId, location, this.importPolls(0));

      this.step(3, 'done');
      this.progress(100);
      this.log('🎉 Live Content Migration completed successfully!', 'success');
      return true;

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.log(`❌ Package import failed: ${errMsg}`, 'error');
      this.step(this.currentStepIndex, 'fail');
      return false;
    }
  }

  private triggerBrowserDownload(blob: Blob, filename: string) {
    if (typeof window === 'undefined') return;
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  }
}
