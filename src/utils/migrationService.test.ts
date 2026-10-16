// src/utils/migrationService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
