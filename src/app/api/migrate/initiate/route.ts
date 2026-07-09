// src/app/api/migrate/initiate/route.ts
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
      transferId, 
      database, 
      dataTrees 
    } = await request.json();

    if (!sourceHost || !sourceClientId || !sourceClientSecret || !sourceAuthority || !transferId) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // Dynamic Server-Side Token Generation
    const sourceToken = await getOAuthToken(sourceAuthority, sourceClientId, sourceClientSecret, sourceAudience);

    const url = `${sourceHost}/sitecore/api/content/transfer/v1/transfers`;
    const payload = {
      Configuration: {
        DataTrees: dataTrees || [],
        Database: database || 'master'
      },
      TransferId: transferId
    };

    console.log(`[API Initiate] Proxying request to ${url}`);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sourceToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({ error: `Source environment error: ${errorText}` }, { status: response.status });
    }

    let responseData = {};
    const text = await response.text();
    if (text) {
      try {
        responseData = JSON.parse(text);
      } catch (e) {
        responseData = { message: text };
      }
    }

    return NextResponse.json(responseData);
  } catch (error) {
    console.error('[API Initiate Error]', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
