// src/app/api/migrate/status/route.ts
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
      transferId 
    } = await request.json();

    if (!sourceHost || !sourceClientId || !sourceClientSecret || !sourceAuthority || !transferId) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // Dynamic Server-Side Token Generation
    const sourceToken = await getOAuthToken(sourceAuthority, sourceClientId, sourceClientSecret, sourceAudience);

    const url = `${sourceHost}/sitecore/api/content/transfer/v1/transfers/${transferId}/status`;
    console.log(`[API Status] Proxying status check at ${url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${sourceToken}`
      }
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.warn(`[API Status] Status endpoint returned 404. Simulating "Processing" state to handle known issue CFW-9663.`);
        return NextResponse.json({ State: 'Processing', ChunkSetsMetadata: [] });
      }
      const errorText = await response.text();
      return NextResponse.json({ error: `Source status check error: ${errorText}` }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[API Status Error]', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
