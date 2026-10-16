// src/app/api/migrate/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import JSZip from 'jszip';

// Import Route Handlers
import { POST as initiateHandler } from './initiate/route';
import { POST as statusHandler } from './status/route';
import { POST as transferChunkHandler } from './transfer-chunk/route';
import { POST as completeHandler } from './complete/route';
import { POST as consumeHandler } from './consume/route';
import { POST as verifyHandler } from './verify/route';
import { POST as childrenHandler } from './children/route';
import { POST as downloadHandler } from './download/route';
import { POST as uploadHandler } from './upload/route';

describe('Next.js API Route Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  describe('POST /api/migrate/initiate', () => {
    it('returns 400 bad request if parameters are missing', async () => {
      const req = new Request('http://localhost/api/migrate/initiate', {
        method: 'POST',
        body: JSON.stringify({ sourceHost: '' })
      });

      const res = await initiateHandler(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Missing required parameters');
    });

    it('handles server-side token generation and proxies the request correctly', async () => {
      const mockAuthResponse = { access_token: 'auth-token-123' };
      const mockInitiateResponse = { message: 'Initiated' };
      
      global.fetch = vi.fn()
        // 1st call: OAuth retrieval
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockAuthResponse)
        })
        // 2nd call: Initiate proxy
        .mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(mockInitiateResponse))
        });

      const req = new Request('http://localhost/api/migrate/initiate', {
        method: 'POST',
        body: JSON.stringify({
          sourceHost: 'https://source.com',
          sourceClientId: 'client-id',
          sourceClientSecret: 'client-secret',
          sourceAuthority: 'https://auth.com',
          transferId: 'transfer-guid',
          database: 'master',
          dataTrees: []
        })
      });

      const res = await initiateHandler(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.message).toBe('Initiated');
      
      // Verify OAuth call parameters
      expect(global.fetch).toHaveBeenNthCalledWith(
        1,
        'https://auth.sitecorecloud.io/oauth/token',
        expect.objectContaining({ method: 'POST' })
      );

      // Verify proxied call uses retrieved token
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        'https://source.com/sitecore/api/content/transfer/v1/transfers',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Authorization': 'Bearer auth-token-123',
            'Content-Type': 'application/json'
          }
        })
      );
    });
  });

  describe('POST /api/migrate/status', () => {
    it('returns status from source status check', async () => {
      global.fetch = vi.fn()
        // Auth call
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'auth-token' })
        })
        // Status call
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ State: 'Completed', ChunkSetsMetadata: [] })
        });

      const req = new Request('http://localhost/api/migrate/status', {
        method: 'POST',
        body: JSON.stringify({
          sourceHost: 'https://source.com',
          sourceClientId: 'client-id',
          sourceClientSecret: 'client-secret',
          sourceAuthority: 'https://auth.com',
          transferId: 'transfer-guid'
        })
      });

      const res = await statusHandler(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.State).toBe('Completed');
    });

    it('gracefully handles 404 from status endpoints (issue CFW-9663) by returning Processing', async () => {
      global.fetch = vi.fn()
        // Auth call
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'auth-token' })
        })
        // Status 404 call
        .mockResolvedValueOnce({
          ok: false,
          status: 404
        });

      const req = new Request('http://localhost/api/migrate/status', {
        method: 'POST',
        body: JSON.stringify({
          sourceHost: 'https://source.com',
          sourceClientId: 'client-id',
          sourceClientSecret: 'client-secret',
          sourceAuthority: 'https://auth.com',
          transferId: 'transfer-guid'
        })
      });

      const res = await statusHandler(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.State).toBe('Processing');
    });
  });

  describe('POST /api/migrate/transfer-chunk', () => {
    it('downloads binary package from source and uploads to target using dynamic tokens', async () => {
      const mockBinaryData = new TextEncoder().encode('mocked-chunk-data');
      const mockHeaders = new Headers();
      mockHeaders.set('content-disposition', 'attachment; filename="chunk.bin"; IsMedia=true');
      
      global.fetch = vi.fn()
        // 1. Source Auth Call
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'src-access-token' })
        })
        // 2. Target Auth Call
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'tgt-access-token' })
        })
        // 3. Source Chunk Download
        .mockResolvedValueOnce({
          ok: true,
          headers: mockHeaders,
          arrayBuffer: () => Promise.resolve(mockBinaryData.buffer)
        })
        // 4. Target Chunk Upload
        .mockResolvedValueOnce({
          ok: true
        });

      const req = new Request('http://localhost/api/migrate/transfer-chunk', {
        method: 'POST',
        body: JSON.stringify({
          sourceHost: 'https://source.com',
          sourceClientId: 'src-client',
          sourceClientSecret: 'src-secret',
          sourceAuthority: 'https://auth-src.com',
          targetHost: 'https://target.com',
          targetClientId: 'tgt-client',
          targetClientSecret: 'tgt-secret',
          targetAuthority: 'https://auth-tgt.com',
          transferId: 'transfer-guid',
          chunksetId: 'chunkset-guid',
          chunkIndex: 0
        })
      });

      const res = await transferChunkHandler(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.isMedia).toBe(true);

      // Verify that target PUT request used target Token
      expect(global.fetch).toHaveBeenNthCalledWith(
        4,
        'https://target.com/sitecore/api/content/transfer/v1/transfers/transfer-guid/chunksets/chunkset-guid/chunks/0?isMedia=true',
        expect.objectContaining({
          method: 'PUT',
          headers: {
            'Authorization': 'Bearer tgt-access-token',
            'Content-Type': 'application/octet-stream'
          }
        })
      );
    });
  });

  describe('POST /api/migrate/complete', () => {
    it('submits completion signal to target using dynamic tokens', async () => {
      global.fetch = vi.fn()
        // Auth call
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'tgt-access-token' })
        })
        // Complete call
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ContentTransferFileName: 'assembled.raif' })
        });

      const req = new Request('http://localhost/api/migrate/complete', {
        method: 'POST',
        body: JSON.stringify({
          targetHost: 'https://target.com',
          targetClientId: 'tgt-client',
          targetClientSecret: 'tgt-secret',
          targetAuthority: 'https://auth-tgt.com',
          transferId: 'transfer-guid',
          chunksetId: 'chunkset-guid'
        })
      });

      const res = await completeHandler(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ContentTransferFileName).toBe('assembled.raif');
    });
  });

  describe('POST /api/migrate/consume', () => {
    it('submits Item Transfer API consume request to target using dynamic tokens', async () => {
      global.fetch = vi.fn()
        // Auth call
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'tgt-access-token' })
        })
        // Consume call
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'location': 'https://target.com/shell/api/v3/ItemsTransfer/transfers/databases/master/sources/consumed-123' }),
          text: () => Promise.resolve('')
        });

      const req = new Request('http://localhost/api/migrate/consume', {
        method: 'POST',
        body: JSON.stringify({
          targetHost: 'https://target.com',
          targetClientId: 'tgt-client',
          targetClientSecret: 'tgt-secret',
          targetAuthority: 'https://auth-tgt.com',
          transferId: 'transfer-guid',
          chunksetId: 'chunkset-guid',
          database: 'master'
        })
      });

      const res = await consumeHandler(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
    });
  });

  describe('POST /api/migrate/verify', () => {
    it('verifies target environment blob state using dynamic tokens', async () => {
      global.fetch = vi.fn()
        // Auth call
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'tgt-access-token' })
        })
        // Verify call
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ BlobState: 'Transferred', Error: null })
        });

      const req = new Request('http://localhost/api/migrate/verify', {
        method: 'POST',
        body: JSON.stringify({
          targetHost: 'https://target.com',
          targetClientId: 'tgt-client',
          targetClientSecret: 'tgt-secret',
          targetAuthority: 'https://auth-tgt.com',
          transferId: 'transfer-guid',
          chunksetId: 'chunkset-guid'
        })
      });

      const res = await verifyHandler(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.BlobState).toBe('Transferred');
    });
  });

  describe('POST /api/migrate/children', () => {
    it('returns children by querying Sitecore Authoring GraphQL API', async () => {
      const mockGraphQLResponse = {
        data: {
          item: {
            itemId: 'root-id',
            name: 'sitecore',
            path: '/sitecore',
            children: {
              nodes: [
                {
                  itemId: 'content-id',
                  name: 'content',
                  path: '/sitecore/content',
                  children: {
                    nodes: [
                      { itemId: 'sub-id' }
                    ]
                  }
                }
              ]
            }
          }
        }
      };

      global.fetch = vi.fn()
        // Auth call
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'src-access-token' })
        })
        // GraphQL query call
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockGraphQLResponse)
        });

      const req = new Request('http://localhost/api/migrate/children', {
        method: 'POST',
        body: JSON.stringify({
          sourceHost: 'https://source.com',
          sourceClientId: 'src-client',
          sourceClientSecret: 'src-secret',
          sourceAuthority: 'https://auth-src.com',
          parentId: '/sitecore'
        })
      });

      const res = await childrenHandler(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe('content-id');
      expect(data[0].name).toBe('content');
      expect(data[0].path).toBe('/sitecore/content');
      expect(data[0].hasChildren).toBe(true);

      // Verify that GraphQL call was made with POST and Bearer token
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        'https://source.com/sitecore/api/authoring/graphql/v1/',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Authorization': 'Bearer src-access-token',
            'Content-Type': 'application/json'
          }
        })
      );
    });
  });

  describe('POST /api/migrate/download', () => {
    it('downloads, stitches and returns chunk data as RAIF binary file', async () => {
      const chunk0 = new TextEncoder().encode('chunk0-data');
      const chunk1 = new TextEncoder().encode('chunk1-data');

      global.fetch = vi.fn()
        // Auth call
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'src-token-123' })
        })
        // Fetch chunk 0
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(chunk0.buffer)
        })
        // Fetch chunk 1
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(chunk1.buffer)
        });

      const req = new Request('http://localhost/api/migrate/download', {
        method: 'POST',
        body: JSON.stringify({
          sourceHost: 'https://source.com',
          sourceClientId: 'src-client',
          sourceClientSecret: 'src-secret',
          sourceAuthority: 'https://auth-src.com',
          transferId: 'transfer-id-123',
          chunksetId: 'chunkset-id-456',
          chunkCount: 2
        })
      });

      const res = await downloadHandler(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/zip');
      expect(res.headers.get('Content-Disposition')).toContain('contentTransfer-transfer-id-123.zip');

      const arrayBuf = await res.arrayBuffer();
      const zip = await JSZip.loadAsync(arrayBuf);
      const binaryFile = zip.file("package.raif");
      expect(binaryFile).toBeDefined();
      const stitchedString = await binaryFile!.async("string");
      expect(stitchedString).toBe('chunk0-datachunk1-data');

      // Verify chunk URLs queried
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        'https://source.com/sitecore/api/content/transfer/v1/transfers/transfer-id-123/chunksets/chunkset-id-456/chunks/0',
        expect.objectContaining({ method: 'GET' })
      );
      expect(global.fetch).toHaveBeenNthCalledWith(
        3,
        'https://source.com/sitecore/api/content/transfer/v1/transfers/transfer-id-123/chunksets/chunkset-id-456/chunks/1',
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  describe('POST /api/migrate/upload', () => {
    it('uploads array buffer chunk to target host with correct headers', async () => {
      global.fetch = vi.fn()
        // Auth call
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'tgt-token-123' })
        })
        // PUT call
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true })
        });

      const bufferData = new TextEncoder().encode('my-upload-data');
      const req = new Request('http://localhost/api/migrate/upload', {
        method: 'POST',
        headers: {
          'x-target-host': 'https://target.com',
          'x-target-client-id': 'tgt-client',
          'x-target-client-secret': 'tgt-secret',
          'x-target-authority': 'https://auth-tgt.com',
          'x-transfer-id': 'transfer-id-123',
          'x-chunk-id': 'chunk-id-456'
        },
        body: bufferData
      });

      const res = await uploadHandler(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);

      // Verify PUT call properties
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        'https://target.com/sitecore/api/content/transfer/v1/transfers/transfer-id-123/chunksets/chunk-id-456/chunks/0?isMedia=false',
        expect.objectContaining({
          method: 'PUT',
          headers: {
            'Authorization': 'Bearer tgt-token-123',
            'Content-Type': 'application/octet-stream'
          }
        })
      );
    });
  });
});
