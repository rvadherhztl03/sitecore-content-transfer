// src/app/api/migrate/upload/route.ts
import { NextResponse } from 'next/server';
import { getOAuthToken } from '@/src/utils/auth';

export async function POST(request: Request) {
  try {
    const targetHost = request.headers.get('x-target-host');
    const targetClientId = request.headers.get('x-target-client-id');
    const targetClientSecret = request.headers.get('x-target-client-secret');
    const targetAuthority = request.headers.get('x-target-authority');
    const targetAudience = request.headers.get('x-target-audience') || undefined;
    const transferId = request.headers.get('x-transfer-id');
    const chunksetId = request.headers.get('x-chunk-id') || request.headers.get('x-chunkset-id');
    const chunkIndex = request.headers.get('x-chunk-index') || '0';

    if (!targetHost || !targetClientId || !targetClientSecret || !targetAuthority || !transferId || !chunksetId) {
      return NextResponse.json({ error: 'Missing target upload headers' }, { status: 400 });
    }

    const isDemo = targetClientId === 'demo-client-id';

    // Dynamic Server-Side Token Generation
    let targetToken = '';
    try {
      targetToken = await getOAuthToken(targetAuthority, targetClientId, targetClientSecret, targetAudience);
    } catch (err) {
      if (!isDemo) {
        return NextResponse.json({ error: `Authentication failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 401 });
      }
    }

    const arrayBuffer = await request.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    console.log(`[API Upload Chunk] Uploading binary chunk. Size: ${buffer.length} bytes, transferId: ${transferId}, chunksetId: ${chunksetId}, isDemo: ${isDemo}`);

    if (isDemo) {
      return NextResponse.json({ success: true });
    }

    const host = targetHost.replace(/\/$/, '');
    const uploadUrl = `${host}/sitecore/api/content/transfer/v1/transfers/${transferId}/chunksets/${chunksetId}/chunks/${chunkIndex}?isMedia=false`;

    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${targetToken}`,
        'Content-Type': 'application/octet-stream'
      },
      body: buffer
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      return NextResponse.json({ error: `Target chunk upload failed: ${errText || uploadRes.statusText}` }, { status: uploadRes.status });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API Upload Chunk Error]', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
