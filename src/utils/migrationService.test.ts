// src/utils/migrationService.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MigrationService, MigrationConfig, DataTree } from './migrationService';

describe('MigrationService', () => {
  let config: MigrationConfig;
  let callbacks: {
    onLog: any;
    onProgress: any;
    onStepChange: any;
  };

  beforeEach(() => {
    config = {
      sourceHost: 'https://source-test.com/',
      sourceClientId: 'src-client-id',
      sourceClientSecret: 'src-client-secret',
      sourceAuthority: 'https://auth-src.com',
      targetHost: 'target-test.com', // testing normalization (adding https://)
      targetClientId: 'tgt-client-id',
      targetClientSecret: 'tgt-client-secret',
      targetAuthority: 'https://auth-tgt.com',
      dataTrees: [
        { ItemPath: '/sitecore/content/Home', Scope: 'SingleItem', MergeStrategy: 'KeepExistingItem' }
      ],
      database: 'master',
      transferId: 'test-transfer-id-123',
      demoMode: true
    };

    callbacks = {
      onLog: vi.fn(),
      onProgress: vi.fn(),
      onStepChange: vi.fn()
    };

    global.fetch = vi.fn();
  });

  describe('Demo Mode', () => {
    it('runs the mock migration successfully and fires all callbacks', async () => {
      const service = new MigrationService(config, callbacks);
      const result = await service.runMigration();

      expect(result).toBe(true);
      expect(callbacks.onLog).toHaveBeenCalled();
      expect(callbacks.onProgress).toHaveBeenCalledWith(100);
      expect(callbacks.onStepChange).toHaveBeenCalledWith(0, 'done');
      expect(callbacks.onStepChange).toHaveBeenCalledWith(5, 'done');
    });
  });

  describe('Live Mode', () => {
    beforeEach(() => {
      config.demoMode = false;
    });

    it('throws error if source or target host/credentials is missing', async () => {
      config.sourceHost = '';
      const service = new MigrationService(config, callbacks);
      const result = await service.runMigration();

      expect(result).toBe(false);
      expect(callbacks.onLog).toHaveBeenCalledWith(
        expect.stringContaining('Source host, Client ID, Client Secret, and Authority Endpoint are required'),
        'error'
      );
    });

    it('executes the full API pipeline successfully when APIs return 200 OK', async () => {
      const mockFetch = vi.fn();
      
      // 1. Initiate
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ success: true }))
      });
      // 2. Poll Status
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          State: 'Completed',
          ChunkSetsMetadata: [{ ChunkSetId: 'chunkset-id-456', ChunkCount: 1 }]
        })
      });
      // 3. Chunk
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, isMedia: false })
      });
      // 4. Complete
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ContentTransferFileName: 'contentTransfer-test.raif' })
      });
      // 5. Consume
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });
      // 6. Verify
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ BlobState: 'Transferred', Error: null })
      });

      global.fetch = mockFetch;

      const service = new MigrationService(config, callbacks);
      const result = await service.runMigration();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(6);
      
      expect(mockFetch.mock.calls[0][0]).toBe('/api/migrate/initiate');
      const initiateBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(initiateBody.sourceHost).toBe('https://source-test.com');
      expect(initiateBody.sourceClientId).toBe('src-client-id');
      expect(initiateBody.sourceClientSecret).toBe('src-client-secret');
      expect(initiateBody.transferId).toBe('test-transfer-id-123');

      expect(mockFetch.mock.calls[1][0]).toBe('/api/migrate/status');
      
      expect(mockFetch.mock.calls[2][0]).toBe('/api/migrate/transfer-chunk');
      const chunkBody = JSON.parse(mockFetch.mock.calls[2][1].body);
      expect(chunkBody.chunkIndex).toBe(0);
      expect(chunkBody.chunksetId).toBe('chunkset-id-456');

      expect(mockFetch.mock.calls[3][0]).toBe('/api/migrate/complete');
      expect(mockFetch.mock.calls[4][0]).toBe('/api/migrate/consume');
      expect(mockFetch.mock.calls[5][0]).toBe('/api/migrate/verify');
    });

    it('copies, assembles, imports and verifies every chunk set the source returns', async () => {
      const ok = (body: unknown) => ({ ok: true, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(ok({ success: true }))
        .mockResolvedValueOnce(ok({
          State: 'Completed',
          ChunkSetsMetadata: [{ ChunkSetId: 'set-a', ChunkCount: 2 }, { ChunkSetId: 'set-b', ChunkCount: 1 }]
        }))
        .mockResolvedValueOnce(ok({ isMedia: false }))
        .mockResolvedValueOnce(ok({ isMedia: false }))
        .mockResolvedValueOnce(ok({ isMedia: true }))
        .mockResolvedValueOnce(ok({ ContentTransferFileName: 'a.raif' }))
        .mockResolvedValueOnce(ok({ ContentTransferFileName: 'b.raif' }))
        .mockResolvedValueOnce(ok({ success: true }))
        .mockResolvedValueOnce(ok({ success: true }))
        .mockResolvedValueOnce(ok({ BlobState: 'Transferred', Error: null }))
        .mockResolvedValueOnce(ok({ BlobState: 'Consumed', Error: null }));
      global.fetch = mockFetch;
      config.demoMode = false;

      const result = await new MigrationService(config, callbacks).runMigration();

      expect(result).toBe(true);
      const calls = mockFetch.mock.calls.slice(2).map(([url, init]) => {
        const body = JSON.parse(init.body);
        return [url.replace('/api/migrate/', ''), body.chunksetId, body.chunkIndex];
      });
      expect(calls).toEqual([
        ['transfer-chunk', 'set-a', 0],
        ['transfer-chunk', 'set-a', 1],
        ['transfer-chunk', 'set-b', 0],
        ['complete', 'set-a', undefined],
        ['complete', 'set-b', undefined],
        ['consume', 'set-a', undefined],
        ['consume', 'set-b', undefined],
        ['verify', 'set-a', undefined],
        ['verify', 'set-b', undefined],
      ]);
    });

    it('successfully completes migration when blob state is Consumed during verification', async () => {
      const mockFetch = vi.fn()
        // 1. Initiate
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ TransferId: 'test-transfer-id-123' })
        })
        // 2. Status
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ State: 'Completed', ChunkSetsMetadata: [{ ChunksetId: 'chunkset-id-456', ChunkCount: 1 }] })
        })
        // 3. Transfer Chunk
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, isMedia: false })
        })
        // 4. Complete
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ContentTransferFileName: 'contentTransfer-test.raif' })
        })
        // 5. Consume
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true })
        })
        // 6. Verify with Consumed state
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ BlobState: 'Consumed', Error: null })
        });

      global.fetch = mockFetch;

      const service = new MigrationService(config, callbacks);
      const result = await service.runMigration();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(6);
      expect(mockFetch.mock.calls[5][0]).toBe('/api/migrate/verify');
    });

    it('stops execution and logs error if any step fails', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal server error')
      });
      global.fetch = mockFetch;

      const service = new MigrationService(config, callbacks);
      const result = await service.runMigration();

      expect(result).toBe(false);
      expect(callbacks.onLog).toHaveBeenCalledWith(
        expect.stringContaining('Failed to initiate transfer: Internal server error'),
        'error'
      );
      expect(callbacks.onStepChange).toHaveBeenCalledWith(0, 'fail');
    });
  });

  describe('runPackageDownloadFlow', () => {
    const config = {
      sourceHost: 'https://source-test.com',
      sourceClientId: 'src-client-id',
      sourceClientSecret: 'src-client-secret',
      sourceAuthority: 'https://auth-src-test.com',
      sourceAudience: 'https://api-src-test.com',
      targetHost: 'https://target-test.com',
      targetClientId: 'tgt-client-id',
      targetClientSecret: 'tgt-client-secret',
      targetAuthority: 'https://auth-tgt-test.com',
      targetAudience: 'https://api-tgt-test.com',
      dataTrees: [{ ItemPath: '/sitecore/content/Home', Scope: 'ItemAndDescendants', MergeStrategy: 'OverrideExistingTree' }] as any[],
      database: 'master',
      transferId: 'test-transfer-id-123',
      demoMode: false
    };

    let callbacks: any;

    beforeEach(() => {
      callbacks = {
        onLog: vi.fn(),
        onProgress: vi.fn(),
        onStepChange: vi.fn()
      };
    });

    it('orchestrates package initiation, polling status, and backend stitching/download', async () => {
      const mockFetch = vi.fn()
        // 1. Initiate
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ TransferId: 'test-transfer-id-123' })
        })
        // 2. Status
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ State: 'Completed', ChunkSetsMetadata: [{ ChunksetId: 'chunkset-id-456', ChunkCount: 2 }] })
        })
        // 3. Download
        .mockResolvedValueOnce({
          ok: true,
          blob: () => Promise.resolve(new Blob(['mock-raif-package-data']))
        });

      global.fetch = mockFetch;

      const service = new MigrationService(config, callbacks);
      // Mock window download trigger
      const mockTrigger = vi.spyOn(service as any, 'triggerBrowserDownload').mockImplementation(() => {});

      const result = await service.runPackageDownloadFlow();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockFetch.mock.calls[0][0]).toBe('/api/migrate/initiate');
      expect(mockFetch.mock.calls[1][0]).toBe('/api/migrate/status');
      expect(mockFetch.mock.calls[2][0]).toBe('/api/migrate/download');
      
      const downloadBody = JSON.parse(mockFetch.mock.calls[2][1].body);
      expect(downloadBody.chunkCount).toBe(2);
      expect(downloadBody.chunksetId).toBe('chunkset-id-456');

      expect(mockTrigger).toHaveBeenCalledWith(expect.any(Blob), 'contentTransfer-test-transfer-id-123.zip');
    });
  });

  describe('runPackageImportFlow', () => {
    const config = {
      sourceHost: 'https://source-test.com',
      sourceClientId: 'src-client-id',
      sourceClientSecret: 'src-client-secret',
      sourceAuthority: 'https://auth-src-test.com',
      sourceAudience: 'https://api-src-test.com',
      targetHost: 'https://target-test.com',
      targetClientId: 'tgt-client-id',
      targetClientSecret: 'tgt-client-secret',
      targetAuthority: 'https://auth-tgt-test.com',
      targetAudience: 'https://api-tgt-test.com',
      dataTrees: [] as any[],
      database: 'master',
      transferId: 'test-transfer-id-123',
      demoMode: false
    };

    let callbacks: any;

    beforeEach(() => {
      callbacks = {
        onLog: vi.fn(),
        onProgress: vi.fn(),
        onStepChange: vi.fn()
      };
    });

    it('uploads file chunks, completes stitching, consumes, and verifies integrity', async () => {
      const mockFetch = vi.fn()
        // 1. Upload
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true })
        })
        // 2. Complete Complete
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ContentTransferFileName: 'contentTransfer-test.raif' })
        })
        // 3. Consume Consume
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true })
        })
        // 4. Verify Verify
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ BlobState: 'Consumed', Error: null })
        });

      global.fetch = mockFetch;

      const service = new MigrationService(config, callbacks);
      const mockBuffer = new TextEncoder().encode('my-imported-raif-data').buffer;
      const result = await service.runPackageImportFlow(mockBuffer);

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(4);
      expect(mockFetch.mock.calls[0][0]).toBe('/api/migrate/upload');
      expect(mockFetch.mock.calls[1][0]).toBe('/api/migrate/complete');
      expect(mockFetch.mock.calls[2][0]).toBe('/api/migrate/consume');
      expect(mockFetch.mock.calls[3][0]).toBe('/api/migrate/verify');
    });
  });
});

describe('MigrationService live transfer: waits, skipped items, retries and import states', () => {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
  const fail = (status: number, text = 'boom') => ({ ok: false, status, text: () => Promise.resolve(text) });

  type Route = unknown | ((call: number, body: any) => unknown);
  const happy: Record<string, Route> = {
    initiate: ok({ success: true }),
    status: ok({ State: 'Completed', ChunkSetsMetadata: [{ ChunkSetId: 'set-a', ChunkCount: 1 }] }),
    'transfer-chunk': ok({ success: true, isMedia: false }),
    complete: ok({ ContentTransferFileName: 'a.raif' }),
    consume: ok({ success: true, location: 'https://target-test.com/sitecore/shell/api/v3/ItemsTransfer/transfers/import-1' }),
    verify: ok({ BlobState: 'Transferred', Error: null }),
    upload: ok({ success: true }),
  };

  // Answers each route from `routes` (a response, or a function of the call number, 1-based, and the JSON body).
  function mockRoutes(routes: Record<string, Route>) {
    const counts: Record<string, number> = {};
    const fn = vi.fn((url: string, init?: { body?: unknown }) => {
      const name = url.replace('/api/migrate/', '');
      counts[name] = (counts[name] ?? 0) + 1;
      const route = { ...happy, ...routes }[name];
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      return Promise.resolve(typeof route === 'function' ? route(counts[name], body) : route);
    });
    global.fetch = fn as unknown as typeof fetch;
    return { fn, count: (name: string) => counts[name] ?? 0 };
  }

  const sets = (...s: object[]) => ok({ State: 'Completed', ChunkSetsMetadata: s });
  const raif = () => new TextEncoder().encode('raif').buffer;

  let config: MigrationConfig;
  let onLog: ReturnType<typeof vi.fn>;
  let callbacks: { onLog: any; onProgress: any; onStepChange: any };
  const logged = (type: string) => onLog.mock.calls.filter(([, t]) => t === type).map(([m]) => m as string);
  const run = () => new MigrationService(config, callbacks).runMigration();

  beforeEach(() => {
    config = {
      sourceHost: 'https://source-test.com',
      sourceClientId: 'src-client-id',
      sourceClientSecret: 'src-client-secret',
      sourceAuthority: 'https://auth-src.com',
      targetHost: 'https://target-test.com',
      targetClientId: 'tgt-client-id',
      targetClientSecret: 'tgt-client-secret',
      targetAuthority: 'https://auth-tgt.com',
      dataTrees: [{ ItemPath: '/sitecore/content/Home', Scope: 'SingleItem', MergeStrategy: 'KeepExistingItem' }],
      database: 'master',
      transferId: 'test-transfer-id-123',
      demoMode: false
    };
    onLog = vi.fn();
    callbacks = { onLog, onProgress: vi.fn(), onStepChange: vi.fn() };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('import wait', () => {
    it('waits 30 minutes plus half a second per item', async () => {
      // 3,000 items: (1,800,000 + 1,500,000) ms / 3,000 ms = 1,100 polls.
      const { count } = mockRoutes({
        status: sets({ ChunkSetId: 'set-a', ChunkCount: 1, TotalItemCount: 2000 }, { ChunkSetId: 'set-b', ChunkCount: 1, TotalItemCount: 1000 }),
        verify: ok({ BlobState: 'Queued', Error: null }),
      });

      expect(await run()).toBe(false);

      expect(count('verify')).toBe(1100);
      expect(logged('error').join()).toContain('Timed out waiting for the import to finish for chunkset set-a (last state: Queued)');
    });

    it('waits 30 minutes when the source gives no item count', async () => {
      const { count } = mockRoutes({ verify: ok({ BlobState: 'Uploaded', Error: null }) });

      expect(await run()).toBe(false);

      expect(count('verify')).toBe(600);
    });

    it('keeps the install flow at 30 minutes', async () => {
      const { count } = mockRoutes({ verify: ok({ BlobState: 'Queued', Error: null }) });

      const result = await new MigrationService(config, callbacks).runPackageImportFlow(raif());

      expect(result).toBe(false);
      expect(count('verify')).toBe(600);
      expect(logged('error').join()).toContain('Timed out waiting for the import to finish (last state: Queued)');
    });

    it('after a successful transfer, says the items can be used and how long Sitecore writes them in the background', async () => {
      mockRoutes({ status: sets({ ChunkSetId: 'set-a', ChunkCount: 1, TotalItemCount: 20000 }) });

      expect(await run()).toBe(true);

      // 45 s queued plus 0.2 s an item: 4,045 s, about 67 minutes.
      const note = "The 20,000 items are in the target and can be used now. Sitecore keeps writing them to the database in the background for about 67 minutes; until then the target may answer slowly, and another transfer into it waits its turn. This tab doesn't need to stay open for it.";
      const messages = onLog.mock.calls.map(([m]) => m);
      expect(messages.indexOf(note)).toBeGreaterThan(messages.indexOf('🎉 Live Content Migration completed successfully!'));
      expect(onLog).toHaveBeenCalledWith(note, 'info');
      expect(messages.some((m) => String(m).includes('keep this tab open'))).toBe(false);
    });

    it('gives the background write in whole minutes, from 2 minutes (225 items) up', async () => {
      mockRoutes({ status: sets({ ChunkSetId: 'set-a', ChunkCount: 1, TotalItemCount: 225 }) });

      expect(await run()).toBe(true);

      expect(onLog.mock.calls.filter(([m]) => String(m).includes('in the background for about 2 minutes;'))).toHaveLength(1);
    });

    it('says nothing about the background write under 2 minutes, or when the transfer fails', async () => {
      mockRoutes({ status: sets({ ChunkSetId: 'set-a', ChunkCount: 1, TotalItemCount: 224 }) });
      expect(await run()).toBe(true);

      mockRoutes({ status: sets({ ChunkSetId: 'set-a', ChunkCount: 1, TotalItemCount: 20000 }), verify: ok({ BlobState: 'Error', Error: 'disk full' }) });
      expect(await run()).toBe(false);

      expect(onLog.mock.calls.filter(([m]) => String(m).includes('in the background'))).toEqual([]);
    });
  });

  describe('skipped items', () => {
    it('totals the skipped items of every chunk and warns at the end', async () => {
      mockRoutes({
        status: sets({ ChunkSetId: 'set-a', ChunkCount: 2 }),
        'transfer-chunk': (call: number) => ok(call === 1
          ? { isMedia: false, itemsProcessed: 9980, itemsSkipped: 20 }
          : { isMedia: false, itemsProcessed: 9970, itemsSkipped: 30 }),
      });

      expect(await run()).toBe(true);

      const warning = 'Sitecore skipped 50 of 20,000 items while packaging (items that failed or were filtered out). Check those items before relying on this transfer.';
      expect(onLog).toHaveBeenCalledWith(warning, 'warning');
      expect(onLog.mock.calls.at(-1)).toEqual([warning, 'warning']);
    });

    it('does not warn when nothing was skipped, or the route reports no counts', async () => {
      mockRoutes({ 'transfer-chunk': ok({ isMedia: false, itemsProcessed: 12, itemsSkipped: 0 }) });
      expect(await run()).toBe(true);
      mockRoutes({ 'transfer-chunk': ok({ isMedia: false }) });
      expect(await run()).toBe(true);

      expect(logged('warning').filter(m => m.includes('skipped'))).toEqual([]);
    });
  });

  describe('retries', () => {
    it('retries a chunk while Sitecore answers 429, 502, 503 or 504, and logs each retry as a warning', async () => {
      const { count } = mockRoutes({
        'transfer-chunk': (call: number) => (call === 1 ? fail(503) : call === 2 ? fail(429) : ok({ isMedia: false })),
      });

      expect(await run()).toBe(true);

      expect(count('transfer-chunk')).toBe(3);
      expect(logged('warning').filter(m => m.includes('Chunk 1 answered HTTP'))).toHaveLength(2);
    });

    it.each([429, 502, 503, 504])('retries on %i', async (status) => {
      const { count } = mockRoutes({ 'transfer-chunk': (call: number) => (call === 1 ? fail(status) : ok({ isMedia: false })) });

      expect(await run()).toBe(true);

      expect(count('transfer-chunk')).toBe(2);
    });

    it('gives up after 3 attempts and fails with the last answer', async () => {
      const { count } = mockRoutes({ 'transfer-chunk': fail(502, 'bad gateway') });

      expect(await run()).toBe(false);

      expect(count('transfer-chunk')).toBe(3);
      expect(logged('error').join()).toContain('Failed to transfer chunk 0 of chunk set set-a: bad gateway');
    });

    it('does not retry any other answer', async () => {
      const { count } = mockRoutes({ 'transfer-chunk': fail(500) });

      expect(await run()).toBe(false);

      expect(count('transfer-chunk')).toBe(1);
    });

    it('retries the source status poll within the same poll', async () => {
      const { count } = mockRoutes({
        status: (call: number) => (call === 1 ? fail(504) : sets({ ChunkSetId: 'set-a', ChunkCount: 1 })),
      });

      expect(await run()).toBe(true);

      expect(count('status')).toBe(2);
      expect(logged('warning').some(m => m.startsWith('Status check answered HTTP 504'))).toBe(true);
    });

    it('retries the verify poll', async () => {
      const { count } = mockRoutes({
        verify: (call: number) => (call === 1 ? fail(503) : ok({ BlobState: 'Consumed', Error: null })),
      });

      expect(await run()).toBe(true);

      expect(count('verify')).toBe(2);
    });

    it('retries the install flow verify poll', async () => {
      const { count } = mockRoutes({ verify: (call: number) => (call === 1 ? fail(503) : ok({ BlobState: 'Consumed', Error: null })) });

      expect(await new MigrationService(config, callbacks).runPackageImportFlow(raif())).toBe(true);

      expect(count('verify')).toBe(2);
    });

    it('retries the export flow status poll and its download', async () => {
      const { count } = mockRoutes({
        status: (call: number) => (call === 1 ? fail(503) : sets({ ChunkSetId: 'set-a', ChunkCount: 1 })),
        download: (call: number) => (call === 1 ? fail(502) : { ok: true, status: 200, blob: () => Promise.resolve(new Blob(['zip'])) }),
      });
      const service = new MigrationService(config, callbacks);
      vi.spyOn(service as any, 'triggerBrowserDownload').mockImplementation(() => {});

      expect(await service.runPackageDownloadFlow()).toBe(true);

      expect(count('status')).toBe(2);
      expect(count('download')).toBe(2);
      expect(logged('warning').some(m => m.startsWith('Status check answered HTTP 503'))).toBe(true);
      expect(logged('warning').some(m => m.startsWith('Download answered HTTP 502'))).toBe(true);
    });

    it('retries an install flow chunk upload, sending the same chunk again', async () => {
      const { fn, count } = mockRoutes({ upload: (call: number) => (call === 1 ? fail(504) : ok({ success: true })) });

      expect(await new MigrationService(config, callbacks).runPackageImportFlow(raif())).toBe(true);

      expect(count('upload')).toBe(2);
      const [first, again] = fn.mock.calls.filter(([u]) => u === '/api/migrate/upload').map(([, init]) => init as any);
      expect(first.headers['x-chunk-index']).toBe('0');
      expect(again).toEqual(first);
      expect(logged('warning').some(m => m.startsWith('Upload 1 answered HTTP 504'))).toBe(true);
    });

    it.each(['initiate', 'complete', 'consume'])('never retries %s', async (route) => {
      const { count } = mockRoutes({ [route]: fail(503) });

      expect(await run()).toBe(false);

      expect(count(route)).toBe(1);
    });

    it('waits 2 s, then 5 s, between attempts', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      const waits: number[] = [];
      vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms: number) => {
        waits.push(ms);
        fn();
        return 0;
      }) as unknown as typeof setTimeout);
      mockRoutes({ 'transfer-chunk': (call: number) => (call < 3 ? fail(503) : ok({ isMedia: false })) });

      expect(await run()).toBe(true);

      // The status poll's own 4 s wait comes first.
      expect(waits).toEqual([4000, 2000, 5000]);
    });
  });

  describe('import states', () => {
    it('keeps polling on any state that is not final, up to the deadline', async () => {
      const states = ['Initializing', 'Queued', 'Uploaded', 'Unknown', 'Transferred'];
      const { count } = mockRoutes({ verify: (call: number) => ok({ BlobState: states[call - 1], Error: null }) });

      expect(await run()).toBe(true);

      expect(count('verify')).toBe(5);
    });

    it('logs the state when it changes, not on every poll', async () => {
      const states = ['Queued', 'Queued', 'Queued', 'Transferred'];
      mockRoutes({ verify: (call: number) => ok({ BlobState: states[call - 1], Error: null }) });

      await run();

      expect(onLog.mock.calls.filter(([m]) => String(m).startsWith('Verification completed'))).toHaveLength(2);
    });

    it.each(['OK', 'Transferred', 'Consumed'])('succeeds on %s', async (BlobState) => {
      mockRoutes({ verify: ok({ BlobState, Error: null }) });

      expect(await run()).toBe(true);
    });

    it.each(['Error', 'Failed', 'Discarded'])('fails at once on %s', async (BlobState) => {
      const { count } = mockRoutes({ verify: ok({ BlobState, Error: 'disk full' }) });

      expect(await run()).toBe(false);

      expect(count('verify')).toBe(1);
      expect(logged('error').join()).toContain(`Blob transfer verification state for chunkset set-a is ${BlobState}. Error: disk full`);
    });

    it('fails the install flow at once on a failed state', async () => {
      mockRoutes({ verify: ok({ BlobState: 'Discarded', Error: 'gone' }) });

      expect(await new MigrationService(config, callbacks).runPackageImportFlow(raif())).toBe(false);

      expect(logged('error').join()).toContain('Blob transfer verification state is Discarded. Error: gone');
    });
  });

  describe('TransferredWithErrors', () => {
    const withErrors = { verify: ok({ BlobState: 'TransferredWithErrors', Error: null }) };

    it('reads the import details from the target and shows why', async () => {
      const errors = Array.from({ length: 12 }, (_, i) => `Item ${i + 1} has no template`);
      const { count, fn } = mockRoutes({ ...withErrors, 'transfer-details': ok({ validationErrors: errors }) });

      expect(await run()).toBe(false);

      expect(count('verify')).toBe(1);
      const request = JSON.parse(fn.mock.calls.find(([u]) => u === '/api/migrate/transfer-details')![1]!.body as string);
      expect(request).toMatchObject({
        targetHost: 'https://target-test.com',
        transferId: 'test-transfer-id-123',
        chunksetId: 'set-a',
        location: 'https://target-test.com/sitecore/shell/api/v3/ItemsTransfer/transfers/import-1',
      });
      expect(logged('warning').filter(m => m.startsWith('Validation error '))).toHaveLength(10);
      expect(onLog).toHaveBeenCalledWith('Validation error 10: Item 10 has no template', 'warning');
      expect(onLog).toHaveBeenCalledWith('...and 2 more.', 'warning');
      expect(logged('error').join()).toContain('The target imported the package with errors: 12 validation errors. First: Item 1 has no template');
    });

    it('says "1 validation error" for one', async () => {
      mockRoutes({ ...withErrors, 'transfer-details': ok({ validationErrors: ['Bad field'] }) });

      await run();

      expect(logged('error').join()).toContain('with errors: 1 validation error. First: Bad field');
    });

    it('keeps the plain error and says why when the details cannot be read', async () => {
      mockRoutes({ ...withErrors, 'transfer-details': fail(404, 'No import found') });

      expect(await run()).toBe(false);

      expect(logged('error').join()).toContain("Blob transfer verification state for chunkset set-a is TransferredWithErrors. Error: null Couldn't read why: No import found");
    });

    it('keeps the plain error when the details call itself fails', async () => {
      mockRoutes({ ...withErrors, 'transfer-details': () => { throw new Error('network down'); } });

      expect(await run()).toBe(false);

      expect(logged('error').join()).toContain("is TransferredWithErrors. Error: null Couldn't read why: network down");
    });

    it('keeps the plain error when the target lists no validation errors', async () => {
      mockRoutes({ ...withErrors, 'transfer-details': ok({ validationErrors: [] }) });

      expect(await run()).toBe(false);

      expect(logged('error').join()).toContain("Couldn't read why: the target lists no validation errors");
    });

    it('explains the install flow too', async () => {
      mockRoutes({ ...withErrors, 'transfer-details': ok({ validationErrors: ['Bad field'] }) });

      expect(await new MigrationService(config, callbacks).runPackageImportFlow(raif())).toBe(false);

      expect(logged('error').join()).toContain('The target imported the package with errors: 1 validation error. First: Bad field');
    });

    it('does not retry the details call', async () => {
      const { count } = mockRoutes({ ...withErrors, 'transfer-details': fail(503) });

      await run();

      expect(count('transfer-details')).toBe(1);
    });
  });
});
