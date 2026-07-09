// src/app/api/migrate/children/route.ts
import { NextResponse } from 'next/server';
import { getOAuthToken } from '@/src/utils/auth';

export async function POST(request: Request) {
  const { 
    sourceHost, 
    sourceClientId, 
    sourceClientSecret, 
    sourceAuthority, 
    sourceAudience,
    parentId 
  } = await request.json();

  if (!sourceHost || !sourceClientId || !sourceClientSecret || !sourceAuthority) {
    return NextResponse.json({ error: 'Missing connection parameters' }, { status: 400 });
  }

  const parent = parentId || '/sitecore';
  const isDemo = sourceClientId === 'demo-client-id';

  // Dynamic Server-Side Token Generation
  let sourceToken = '';
  console.log(`[API Get Children] Entering children query handler. parentId: ${parentId}, resolved parent: ${parent}, isDemo: ${isDemo}`);
  try {
    console.log(`[API Get Children] Calling getOAuthToken for Client ID: ${sourceClientId}`);
    sourceToken = await getOAuthToken(sourceAuthority, sourceClientId, sourceClientSecret, sourceAudience);
    console.log(`[API Get Children] Token successfully retrieved. Length: ${sourceToken?.length || 0}`);
  } catch (err) {
    console.error(`[API Get Children] Token retrieval failed:`, err);
    if (!isDemo) {
      return NextResponse.json({ error: `Authentication failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 401 });
    }
  }

  // If not demo mode, perform the live Sitecore API call
  if (!isDemo) {
    const host = sourceHost.replace(/\/$/, '');
    
    // Querying the XM Cloud GraphQL Authoring API
    const graphqlUrl1 = `${host}/sitecore/api/authoring/graphql/v1/`;
    const graphqlUrl2 = `${host}/sitecore/api/authoring/graphql/v1`;
    
    const graphqlQuery = {
      query: `
        query GetItemChildren($path: String!) {
          item(where: { path: $path, database: "master" }) {
            itemId
            name
            path
            children {
              nodes {
                itemId
                name
                path
                children(first: 1) {
                  nodes {
                    itemId
                  }
                }
              }
            }
          }
        }
      `,
      variables: {
        path: parent
      }
    };

    console.log(`[API Get Children] GraphQL Query Details:
      Endpoint Primary: ${graphqlUrl1}
      Endpoint Secondary: ${graphqlUrl2}
      Variables: ${JSON.stringify(graphqlQuery.variables)}
    `);

    try {
      console.log(`[API Get Children] Fetching from primary URL...`);
      let response = await fetch(graphqlUrl1, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${sourceToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(graphqlQuery)
      });

      console.log(`[API Get Children] Primary URL response status: ${response.status}`);

      // Try alternate path without trailing slash if primary path returns 404
      if (response.status === 404) {
        console.log(`[API Get Children] Primary path returned 404. Trying alternate without trailing slash: ${graphqlUrl2}`);
        response = await fetch(graphqlUrl2, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${sourceToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(graphqlQuery)
        });
        console.log(`[API Get Children] Alternate URL response status: ${response.status}`);
      }

      if (response.ok) {
        const result = await response.json();
        console.log(`[API Get Children] GraphQL Response payload: ${JSON.stringify(result)}`);
        
        if (result.errors && result.errors.length > 0) {
          console.error(`[API Get Children] GraphQL errors:`, result.errors);
          return NextResponse.json(
            { error: `GraphQL query returned error: ${result.errors[0].message}` }, 
            { status: 400 }
          );
        }
        
        const item = result.data?.item;
        if (!item) {
          console.log(`[API Get Children] Item query returned null (not found/permission error) for path: ${parent}`);
          return NextResponse.json([]);
        }

        const nodes = item.children?.nodes || [];
        console.log(`[API Get Children] Found ${nodes.length} children nodes.`);
        const formattedChildren = nodes.map((child: any) => ({
          id: child.itemId,
          name: child.name,
          path: child.path,
          hasChildren: (child.children?.nodes || []).length > 0
        }));

        return NextResponse.json(formattedChildren);
      } else {
        const errorText = await response.text();
        console.error(`[API Get Children] GraphQL request returned non-ok status: ${response.status}. Body: ${errorText}`);
        return NextResponse.json(
          { error: `Sitecore Authoring GraphQL API returned HTTP ${response.status}: ${errorText || response.statusText}` }, 
          { status: response.status }
        );
      }
    } catch (e) {
      console.error(`[API Get Children] Live GraphQL call failed:`, e);
      return NextResponse.json(
        { error: `Network connection failed to ${sourceHost}: ${e instanceof Error ? e.message : String(e)}` }, 
        { status: 502 }
      );
    }
  }

  // Dynamic Mock Fallback Database (Only for Demo Mode)
  const mockDb: Record<string, { id: string; name: string; path: string; hasChildren: boolean }[]> = {
    '/sitecore': [
      { id: 'content', name: 'content', path: '/sitecore/content', hasChildren: true },
      { id: 'media', name: 'media library', path: '/sitecore/media library', hasChildren: true },
      { id: 'templates', name: 'templates', path: '/sitecore/templates', hasChildren: true }
    ],
    '/sitecore/content': [
      { id: 'hztl', name: 'HztlFoundation', path: '/sitecore/content/HztlFoundation', hasChildren: true }
    ],
    '/sitecore/content/HztlFoundation': [
      { id: 'brandx', name: 'BrandX', path: '/sitecore/content/HztlFoundation/BrandX', hasChildren: true }
    ],
    '/sitecore/content/HztlFoundation/BrandX': [
      { id: 'home', name: 'Home', path: '/sitecore/content/HztlFoundation/BrandX/Home', hasChildren: true }
    ],
    '/sitecore/content/HztlFoundation/BrandX/Home': [
      { id: 'demo1', name: 'CKDemoPage 1', path: '/sitecore/content/HztlFoundation/BrandX/Home/CKDemoPage 1', hasChildren: false },
      { id: 'demo2', name: 'CKDemoPage 2', path: '/sitecore/content/HztlFoundation/BrandX/Home/CKDemoPage 2', hasChildren: false },
      { id: 'products', name: 'Products', path: '/sitecore/content/HztlFoundation/BrandX/Home/Products', hasChildren: true },
      { id: 'about', name: 'About Us', path: '/sitecore/content/HztlFoundation/BrandX/Home/About Us', hasChildren: false }
    ],
    '/sitecore/content/HztlFoundation/BrandX/Home/Products': [
      { id: 'prod-a', name: 'Product A', path: '/sitecore/content/HztlFoundation/BrandX/Home/Products/Product A', hasChildren: false },
      { id: 'prod-b', name: 'Product B', path: '/sitecore/content/HztlFoundation/BrandX/Home/Products/Product B', hasChildren: false }
    ],
    '/sitecore/media library': [
      { id: 'images', name: 'Images', path: '/sitecore/media library/Images', hasChildren: true }
    ],
    '/sitecore/media library/Images': [
      { id: 'hero', name: 'Hero Banner', path: '/sitecore/media library/Images/Hero Banner', hasChildren: false },
      { id: 'logo-img', name: 'Logo', path: '/sitecore/media library/Images/Logo', hasChildren: false }
    ],
    '/sitecore/templates': [
      { id: 'project-tpl', name: 'Project', path: '/sitecore/templates/Project', hasChildren: true }
    ],
    '/sitecore/templates/Project': [
      { id: 'page-tpl', name: 'Page', path: '/sitecore/templates/Project/Page', hasChildren: false }
    ]
  };

  const key = parent.replace(/\/+$/, '');
  const children = mockDb[key] || [];
  return NextResponse.json(children);
}
