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
import { POST as detailsHandler } from './transfer-details/route';

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

  describe('POST /api/migrate/transfer-chunk: skipped items', () => {
    const post = async (contentDisposition: string | null) => {
      const headers = new Headers();
      if (contentDisposition !== null) headers.set('content-disposition', contentDisposition);
      global.fetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ access_token: 'src-access-token' }) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ access_token: 'tgt-access-token' }) })
        .mockResolvedValueOnce({ ok: true, headers, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) })
        .mockResolvedValueOnce({ ok: true });
      const res = await transferChunkHandler(new Request('http://localhost/api/migrate/transfer-chunk', {
        method: 'POST',
        body: JSON.stringify({
          sourceHost: 'https://source.com', sourceClientId: 'src-client', sourceClientSecret: 'src-secret', sourceAuthority: 'https://auth-src.com',
          targetHost: 'https://target.com', targetClientId: 'tgt-client', targetClientSecret: 'tgt-secret', targetAuthority: 'https://auth-tgt.com',
          transferId: 'transfer-guid', chunksetId: 'chunkset-guid', chunkIndex: 0
        })
      }));
      return res.json();
    };

    it('returns the processed and skipped item counts from the Content-Disposition header', async () => {
      const data = await post('attachment; filename="chunk.bin"; IsMedia=false; ItemsProcessed=19950; ItemsSkipped=50');

      expect(data).toMatchObject({ success: true, isMedia: false, itemsProcessed: 19950, itemsSkipped: 50 });
    });

    it('reads quoted values and any order', async () => {
      const data = await post('attachment; ItemsSkipped="7"; IsMedia=true; ItemsProcessed = "3"');

      expect(data).toMatchObject({ isMedia: true, itemsProcessed: 3, itemsSkipped: 7 });
    });

    it('returns 0 for both when the header lacks them', async () => {
      expect(await post('attachment; filename="chunk.bin"; IsMedia=true')).toMatchObject({ itemsProcessed: 0, itemsSkipped: 0 });
      expect(await post(null)).toMatchObject({ isMedia: false, itemsProcessed: 0, itemsSkipped: 0 });
    });
  });

  describe('POST /api/migrate/transfer-details', () => {
    const API = 'https://target.com/sitecore/shell/api/v3/ItemsTransfer';
    const body = {
      targetHost: 'https://target.com',
      targetClientId: 'tgt-client',
      targetClientSecret: 'tgt-secret',
      targetAuthority: 'https://auth-tgt.com',
      transferId: 'transfer-guid',
      chunksetId: 'chunkset-guid',
      location: `${API}/transfers/import-42`
    };
    const json = (data: unknown) => ({ ok: true, json: () => Promise.resolve(data) });
    const notOk = (status: number, text = 'nope') => ({ ok: false, status, text: () => Promise.resolve(text) });
    const call = (overrides: Record<string, unknown> = {}) => detailsHandler(new Request('http://localhost/api/migrate/transfer-details', {
      method: 'POST',
      body: JSON.stringify({ ...body, ...overrides })
    }));
    const urls = () => vi.mocked(global.fetch).mock.calls.map(([u]) => String(u));
    const auth = json({ access_token: 'tgt-access-token' });

    it('returns 400 when parameters are missing', async () => {
      const res = await call({ targetHost: '' });

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('Missing required parameters');
    });

    it('gets the details of the transfer named by the last segment of Location, with the target token', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce(auth)
        .mockResolvedValueOnce(json({ TransferState: 'Finished', ValidationErrors: ['Bad field on /a', 'No template for /b'] }));

      const res = await call();

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ validationErrors: ['Bad field on /a', 'No template for /b'] });
      expect(global.fetch).toHaveBeenNthCalledWith(2, `${API}/transfers/import-42`, {
        method: 'GET',
        headers: { Authorization: 'Bearer tgt-access-token' }
      });
    });

    it('returns an empty list when ValidationErrors is null', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(auth).mockResolvedValueOnce(json({ ValidationErrors: null }));

      expect(await (await call()).json()).toEqual({ validationErrors: [] });
    });

    it('never calls a host named in Location: only the id is used, on the configured target host', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(auth).mockResolvedValueOnce(json({ ValidationErrors: ['x'] }));

      await call({ location: 'https://evil.example.com/steal/transfers/import-42?x=1#y' });

      expect(urls().slice(1)).toEqual([`${API}/transfers/import-42`]);
    });

    it('keeps an id with spaces or slashes inside its own path segment', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(auth).mockResolvedValueOnce(json({ ValidationErrors: [] }));

      await call({ location: `${API}/transfers/consumed.20260707%20073702.abc%2F..%2Fdef/` });

      expect(urls()[1]).toBe(`${API}/transfers/consumed.20260707%20073702.abc%2F..%2Fdef`);
    });

    it('ignores a Location whose last segment is . or .. and looks the transfer up by name', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce(auth)
        .mockResolvedValueOnce(json({ Transfers: [], TotalCount: 0 }));

      const res = await call({ location: `${API}/transfers/..` });

      expect(res.status).toBe(404);
      expect(urls().slice(1)).toEqual([`${API}/transfers?page=1&pageSize=100`]);
    });

    it('finds the transfer by its blob name when Location does not end in a known id', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce(auth)
        .mockResolvedValueOnce(notOk(404))
        .mockResolvedValueOnce(json({
          TotalCount: 2,
          Transfers: [
            { Id: 'other', SourceName: 'contentTransfer-x-y.raif' },
            { Id: 'consumed.2026.guid', SourceName: 'contentTransfer-transfer-guid-chunkset-guid.raif' }
          ]
        }))
        .mockResolvedValueOnce(json({ ValidationErrors: ['Bad field'] }));

      const res = await call({ location: `${API}/sources/blobs/contentTransfer-transfer-guid-chunkset-guid.raif` });

      expect(await res.json()).toEqual({ validationErrors: ['Bad field'] });
      expect(urls().slice(1)).toEqual([
        `${API}/transfers/contentTransfer-transfer-guid-chunkset-guid.raif`,
        `${API}/transfers?page=1&pageSize=100`,
        `${API}/transfers/consumed.2026.guid`
      ]);
    });

    it('looks the transfer up by blob name when consume gave no Location', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce(auth)
        .mockResolvedValueOnce(json({ TotalCount: 1, Transfers: [{ Id: 'found-id', SourceName: 'contentTransfer-transfer-guid-chunkset-guid.raif' }] }))
        .mockResolvedValueOnce(json({ ValidationErrors: ['Bad field'] }));

      const res = await call({ location: undefined });

      expect(await res.json()).toEqual({ validationErrors: ['Bad field'] });
    });

    it('reads on to the next page of transfers when the first lacks it', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce(auth)
        .mockResolvedValueOnce(json({ TotalCount: 150, Transfers: [{ Id: 'other', SourceName: 'a.raif' }] }))
        .mockResolvedValueOnce(json({ TotalCount: 150, Transfers: [{ Id: 'found-id', SourceName: 'contentTransfer-transfer-guid-chunkset-guid.raif' }] }))
        .mockResolvedValueOnce(json({ ValidationErrors: [] }));

      await call({ location: '' });

      expect(urls().slice(1)).toEqual([
        `${API}/transfers?page=1&pageSize=100`,
        `${API}/transfers?page=2&pageSize=100`,
        `${API}/transfers/found-id`
      ]);
    });

    it('returns the 404 of the id lookup when the name lookup finds no transfer either', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce(auth)
        .mockResolvedValueOnce(notOk(404, 'unknown id'))
        .mockResolvedValueOnce(json({ TotalCount: 1, Transfers: [{ Id: 'other', SourceName: 'a.raif' }] }));

      const res = await call();

      expect(res.status).toBe(404);
      expect((await res.json()).error).toContain('unknown id');
    });

    it('says no import was found when there was no id to try and no transfer matches', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce(auth)
        .mockResolvedValueOnce(json({ TotalCount: 1, Transfers: [{ Id: 'other', SourceName: 'a.raif' }] }));

      const res = await call({ location: undefined });

      expect(res.status).toBe(404);
      expect((await res.json()).error).toContain('No import found');
    });

    it('passes the Sitecore status on when the details call fails', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce(auth)
        .mockResolvedValueOnce(notOk(503, 'busy'))
        .mockResolvedValueOnce(notOk(503, 'busy'));

      const res = await call();

      expect(res.status).toBe(503);
      expect((await res.json()).error).toContain('busy');
    });
  });
});
