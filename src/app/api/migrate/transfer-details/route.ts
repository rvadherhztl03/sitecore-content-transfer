// src/app/api/migrate/transfer-details/route.ts
import { NextResponse } from 'next/server';
import { getOAuthToken } from '@/utils/auth';

// How many transfers the by-name lookup asks the Item Transfer API for at a time.
// The Item Transfer API lists at most 50 per page (tern, docs/content.md).
const PAGE_SIZE = 50;
// ponytail: the by-name lookup reads at most 10 pages (500 transfers); a target with more may not find its transfer.
const MAX_PAGES = 10;

// The last path segment of the Location header consume returned. Only that segment is used: the header's host is never
// called, the URL is always built from the configured target host.
function idFrom(location: unknown): string | undefined {
  if (typeof location !== 'string') return undefined;
  const segment = location.split(/[?#]/)[0].split('/').filter(Boolean).pop();
  if (!segment) return undefined;
  let id = segment;
  try {
    id = decodeURIComponent(segment);
  } catch {
    // Not valid percent-encoding: use it as is.
  }
  return id.length <= 200 && !/^\.+$/.test(id) ? id : undefined;
}

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
      location
    } = await request.json();

    if (!targetHost || !targetClientId || !targetClientSecret || !targetAuthority || !transferId || !chunksetId) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // Dynamic Server-Side Token Generation for Target
    const targetToken = await getOAuthToken(targetAuthority, targetClientId, targetClientSecret, targetAudience);

    const api = `${targetHost}/sitecore/shell/api/v3/ItemsTransfer`;
    const get = (path: string) => fetch(`${api}${path}`, { method: 'GET', headers: { 'Authorization': `Bearer ${targetToken}` } });
    const details = (id: string) => get(`/transfers/${encodeURIComponent(id)}`);

    console.log(`[API Transfer Details] Reading import details at ${api}/transfers`);

    // The docs disagree on whether Location ends in the transfer's id or the blob name, so when its last segment
    // isn't an id the target knows, find the transfer by the blob name consume was given.
    const id = idFrom(location);
    let response = id ? await details(id) : undefined;
    if (!response?.ok) {
      const blobName = `contentTransfer-${transferId}-${chunksetId}.raif`;
      let foundId: string | undefined;
      for (let page = 1; page <= MAX_PAGES && !foundId; page++) {
        const list = await get(`/transfers?page=${page}&pageSize=${PAGE_SIZE}`);
        if (!list.ok) break;
        const body = await list.json();
        const transfers: { Id?: string; SourceName?: string }[] = body?.Transfers ?? [];
        foundId = transfers.find(t => t.SourceName === blobName)?.Id;
        if (page * PAGE_SIZE >= (body?.TotalCount ?? 0)) break;
      }
      if (foundId) response = await details(foundId);
    }

    if (!response) {
      return NextResponse.json({ error: 'No import found on the target for this package.' }, { status: 404 });
    }
    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({ error: `Target transfer details error: ${errorText}` }, { status: response.status });
    }

    const data = await response.json();
    // ValidationErrors is null when there are none.
    const validationErrors = (Array.isArray(data?.ValidationErrors) ? data.ValidationErrors : [])
      .map((e: unknown) => (typeof e === 'string' ? e : JSON.stringify(e)));
    return NextResponse.json({ validationErrors });
  } catch (error) {
    console.error('[API Transfer Details Error]', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
