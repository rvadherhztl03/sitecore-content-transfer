// src/app/api/migrate/transfer-chunk/route.ts
import { NextResponse } from 'next/server';
import { getOAuthToken } from '@/src/utils/auth';

export async function POST(request: Request) {
  try {
    const {
      sourceHost,
      sourceClientId,
      sourceClientSecret,
      sourceAuthority,
      sourceAudience,
      targetHost,
      targetClientId,
      targetClientSecret,
      targetAuthority,
      targetAudience,
      transferId,
      chunksetId,
      chunkIndex
    } = await request.json();

    if (
      !sourceHost || !sourceClientId || !sourceClientSecret || !sourceAuthority ||
      !targetHost || !targetClientId || !targetClientSecret || !targetAuthority ||
      !transferId || !chunksetId || chunkIndex === undefined
    ) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // Dynamic Server-Side Token Generation for BOTH Source and Target
    const sourceToken = await getOAuthToken(sourceAuthority, sourceClientId, sourceClientSecret, sourceAudience);
    const targetToken = await getOAuthToken(targetAuthority, targetClientId, targetClientSecret, targetAudience);

    // Step 1: Download chunk from source
    const downloadUrl = `${sourceHost}/sitecore/api/content/transfer/v1/transfers/${transferId}/chunksets/${chunksetId}/chunks/${chunkIndex}`;
    console.log(`[API Transfer Chunk] Proxying download from ${downloadUrl}`);

    const downloadRes = await fetch(downloadUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${sourceToken}`
      }
    });

    if (!downloadRes.ok) {
      const errText = await downloadRes.text();
      return NextResponse.json({ error: `Source chunk download failed: ${errText}` }, { status: downloadRes.status });
    }

    const contentDisposition = downloadRes.headers.get('content-disposition') || '';
    let isMedia = false;
    const match = /IsMedia\s*=\s*(true|false)/i.exec(contentDisposition);
    if (match) {
      isMedia = match[1].toLowerCase() === 'true';
    }

    const arrayBuffer = await downloadRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Step 2: Upload chunk to target
    const uploadUrl = `${targetHost}/sitecore/api/content/transfer/v1/transfers/${transferId}/chunksets/${chunksetId}/chunks/${chunkIndex}?isMedia=${isMedia}`;
    console.log(`[API Transfer Chunk] Proxying upload to ${uploadUrl} (Size: ${buffer.length} bytes)`);

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
      return NextResponse.json({ error: `Target chunk upload failed: ${errText}` }, { status: uploadRes.status });
    }

    return NextResponse.json({ success: true, isMedia });
  } catch (error) {
    console.error('[API Transfer Chunk Error]', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
