// src/utils/auth.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getOAuthToken } from './auth';

describe('OAuth Authentication Utility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('returns mock token when client ID is missing or is demo credentials', async () => {
    const token = await getOAuthToken('http://authority.com', 'demo-client-id', 'demo-client-secret');
    expect(token).toBe('mock-bearer-token-12345');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('makes standard x-www-form-urlencoded POST request to hardcoded sitecorecloud authority defaulting audience', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ access_token: 'auth-token-987' })
    });

    const token = await getOAuthToken('ignored-authority.com', 'real-client-id', 'real-secret');
    expect(token).toBe('auth-token-987');
    
    expect(global.fetch).toHaveBeenCalledWith(
      'https://auth.sitecorecloud.io/oauth/token',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: 'real-client-id',
          client_secret: 'real-secret',
          audience: 'https://api.sitecorecloud.io' // asserts default audience value
        })
      })
    );
  });

  it('throws descriptive error when authority rejects request', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Invalid client credentials')
    });

    await expect(getOAuthToken('authority.com', 'bad-client-id', 'bad-secret'))
      .rejects.toThrow('OAuth Authority rejected request (HTTP 401): Invalid client credentials');
  });
});
