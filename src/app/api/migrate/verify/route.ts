// src/app/api/migrate/verify/route.ts
import { NextResponse } from 'next/server';
import { getOAuthToken } from '@/src/utils/auth';

export async function POST(request: Request) {
  try {
    const { 
      targetHost, 
      targetClientId, 
      targetClientSecret, 
      targetAuthority, 
      targetAudience,
      transferId, 
      chunksetId 
    } = await request.json();

    if (!targetHost || !targetClientId || !targetClientSecret || !targetAuthority || !transferId || !chunksetId) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // Dynamic Server-Side Token Generation for Target
    const targetToken = await getOAuthToken(targetAuthority, targetClientId, targetClientSecret, targetAudience);

    const blobName = `contentTransfer-${transferId}-${chunksetId}.raif`;
    const url = `${targetHost}/sitecore/shell/api/v3/ItemsTransfer/sources/blobs/${blobName}`;
    
    console.log(`[API Verify] Proxying blob verification at ${url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${targetToken}`
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({ error: `Target verification check error: ${errorText}` }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[API Verify Error]', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
