// src/app/api/migrate/complete/route.ts
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

    const url = `${targetHost}/sitecore/api/content/transfer/v1/transfers/${transferId}/chunksets/${chunksetId}/complete`;
    console.log(`[API Complete] Proxying stitch completion at ${url}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${targetToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({ error: `Target completion error: ${errorText}` }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[API Complete Error]', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
