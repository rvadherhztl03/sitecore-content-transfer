// src/app/api/migrate/download/route.ts
import { NextResponse } from 'next/server';
import { getOAuthToken } from '@/src/utils/auth';
import JSZip from 'jszip';

async function fetchItemId(host: string, token: string, path: string): Promise<string | null> {
  const graphqlUrl1 = `${host.replace(/\/$/, '')}/sitecore/api/authoring/graphql/v1/`;
  const graphqlUrl2 = `${host.replace(/\/$/, '')}/sitecore/api/authoring/graphql/v1`;

  const graphqlQuery = {
    query: `
      query GetItemGuid($path: String!) {
        item(where: { path: $path, database: "master" }) {
          itemId
        }
      }
    `,
    variables: { path }
  };

  try {
    let res = await fetch(graphqlUrl1, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(graphqlQuery)
    });

    if (res.status === 404) {
      res = await fetch(graphqlUrl2, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(graphqlQuery)
      });
    }

    if (res.ok) {
      const payload = await res.json();
      return payload.data?.item?.itemId || null;
    }
  } catch (err) {
    console.error(`Failed to fetch GUID for path ${path}:`, err);
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    console.log('[API Download] Received payload:', JSON.stringify({ ...body, sourceClientSecret: body.sourceClientSecret ? '***' : null }));

    const { 
      sourceHost, 
      sourceClientId, 
      sourceClientSecret, 
      sourceAuthority, 
      sourceAudience,
      transferId,
      chunksetId,
      chunkCount,
      dataTrees
    } = body;

    if (!sourceHost || !sourceClientId || !sourceClientSecret || !sourceAuthority || !transferId || !chunksetId || chunkCount === undefined) {
      return NextResponse.json({ error: 'Missing download parameters' }, { status: 400 });
    }

    const isDemo = sourceClientId === 'demo-client-id';

    // Dynamic Server-Side Token Generation
    let sourceToken = '';
    try {
      sourceToken = await getOAuthToken(sourceAuthority, sourceClientId, sourceClientSecret, sourceAudience);
    } catch (err) {
      if (!isDemo) {
        return NextResponse.json({ error: `Authentication failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 401 });
      }
    }

    // Resolve Item IDs for package metadata
    const resolvedDataTrees = await Promise.all((dataTrees || []).map(async (tree: any) => {
      let itemId = tree.ItemId;
      if (!itemId && !isDemo && sourceToken) {
        itemId = await fetchItemId(sourceHost, sourceToken, tree.ItemPath);
      }
      if (!itemId) {
        // Generate a stable hash GUID based on path if it is not resolved from Sitecore
        let hash = 0;
        const path = tree.ItemPath;
        for (let i = 0; i < path.length; i++) {
          hash = (hash << 5) - hash + path.charCodeAt(i);
          hash |= 0;
        }
        const hex = Math.abs(hash).toString(16).padStart(8, '0').toUpperCase();
        itemId = `{${hex}A90F-4BCE-42E0-AB22-${hex}DE00D8C8}`;
      }

      return {
        ItemPath: tree.ItemPath,
        ItemId: itemId,
        Scope: tree.Scope || "ItemAndDescendants",
        MergeStrategy: tree.MergeStrategy || "OverrideExistingTree"
      };
    }));

    console.log(`[API Download] Initiating package download & stitching. transferId: ${transferId}, chunksetId: ${chunksetId}, chunkCount: ${chunkCount}, isDemo: ${isDemo}`);

    let stitchedBuffer: Buffer;

    if (isDemo) {
      const encoder = new TextEncoder();
      const mockContent = `Mock stitched Sitecore RAIF package content\nTransfer ID: ${transferId}\nChunkSet ID: ${chunksetId}\nChunks count: ${chunkCount}\nGenerated successfully at: ${new Date().toISOString()}`;
      stitchedBuffer = Buffer.from(encoder.encode(mockContent));
    } else {
      const host = sourceHost.replace(/\/$/, '');

      // Concurrent download of all chunk buffers
      const downloadPromises = Array.from({ length: chunkCount }, (_, i) => {
        const url = `${host}/sitecore/api/content/transfer/v1/transfers/${transferId}/chunksets/${chunksetId}/chunks/${i}`;
        return fetch(url, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${sourceToken}`,
            'Accept': 'application/octet-stream'
          }
        }).then(async (res) => {
          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Failed to download chunk ${i}: ${errText || res.statusText}`);
          }
          const arrayBuf = await res.arrayBuffer();
          return Buffer.from(arrayBuf);
        });
      });

      const chunkBuffers = await Promise.all(downloadPromises);
      stitchedBuffer = Buffer.concat(chunkBuffers);
      console.log(`[API Download] Success stitching ${chunkCount} chunks. Total package size: ${stitchedBuffer.length} bytes.`);
    }

    // Wrap metadata and stitched binary inside a standard ZIP container
    const zip = new JSZip();
    zip.file("package-metadata.json", JSON.stringify(resolvedDataTrees, null, 2));
    zip.file("package.raif", stitchedBuffer);

    const zipBuffer = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });

    return new NextResponse(zipBuffer.buffer as any, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="contentTransfer-${transferId}.zip"`
      }
    });

  } catch (error) {
    console.error('[API Download] Stitched package download failed:', error);
    return NextResponse.json(
      { error: `Package stitching failed: ${error instanceof Error ? error.message : String(error)}` }, 
      { status: 502 }
    );
  }
}
