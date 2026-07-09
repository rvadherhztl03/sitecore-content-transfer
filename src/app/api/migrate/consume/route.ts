// src/app/api/migrate/consume/route.ts
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
      chunksetId, 
      database 
    } = await request.json();

    if (!targetHost || !targetClientId || !targetClientSecret || !targetAuthority || !transferId || !chunksetId) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // Dynamic Server-Side Token Generation for Target
    const targetToken = await getOAuthToken(targetAuthority, targetClientId, targetClientSecret, targetAudience);

    const db = database || 'master';
    const blobName = `contentTransfer-${transferId}-${chunksetId}.raif`;
    const url = `${targetHost}/sitecore/shell/api/v3/ItemsTransfer/transfers/databases/${db}/sources?blobName=${blobName}`;
    
    console.log(`[API Consume] Proxying package consumption at ${url}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${targetToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({ error: `Target consumption error: ${errorText}` }, { status: response.status });
    }

    const location = response.headers.get('location') || '';
    let responseData = { success: true, location };
    const text = await response.text();
    if (text) {
      try {
        responseData = { ...responseData, ...JSON.parse(text) };
      } catch (e) {
        // Not JSON
      }
    }

    return NextResponse.json(responseData);
  } catch (error) {
    console.error('[API Consume Error]', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
