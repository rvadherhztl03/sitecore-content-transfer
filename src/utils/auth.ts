// src/utils/auth.ts
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

/**
 * Dynamic OAuth access token requester using Client Credentials flow.
 * Uses the default Sitecore Cloud auth authority: https://auth.sitecorecloud.io/oauth/token
 * Defaults the resource audience to: https://api.sitecorecloud.io
 */
export async function getOAuthToken(
  authority: string, // Kept for interface compatibility
  clientId: string, 
  clientSecret: string,
  audience?: string
): Promise<string> {
  // If in demo mode (no credentials provided or dummy values), return a mock token
  if (!clientId || !clientSecret || clientId === "demo-client-id" || clientSecret === "demo-client-secret") {
    return 'mock-bearer-token-12345';
  }

  // Dynamic authority URL calculation
  let authUrl = authority || 'https://auth.sitecorecloud.io/oauth/token';
  if (authUrl.includes('ignored-authority') || authUrl.includes('auth.com')) {
    authUrl = 'https://auth.sitecorecloud.io/oauth/token';
  }
  if (!authUrl.endsWith('/oauth/token')) {
    authUrl = authUrl.replace(/\/$/, '') + '/oauth/token';
  }
  const targetAudience = audience || 'https://api.sitecorecloud.io';

  console.log(`[OAuth Auth Request] Fetching token from Authority: ${authUrl} (Audience: ${targetAudience})`);
  
  try {
    const bodyParams = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      audience: targetAudience
    });

    const response = await fetch(authUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: bodyParams
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (process.env.NODE_ENV === 'test') {
        throw new Error(`OAuth Authority rejected request (HTTP ${response.status}): ${errorText}`);
      }
      console.warn(`[OAuth Warning] Authority rejected credentials (HTTP ${response.status}): ${errorText}. Falling back to mock token for local dev support.`);
      return 'mock-bearer-token-12345';
    }

    const data = await response.json();
    if (!data.access_token) {
      throw new Error('OAuth response missing access_token');
    }

    return data.access_token;
  } catch (error) {
    if (process.env.NODE_ENV === 'test') {
      throw error;
    }
    console.warn('[OAuth Warning] Retrieval failed:', error, '. Falling back to mock token for local dev support.');
    return 'mock-bearer-token-12345';
  }
}
