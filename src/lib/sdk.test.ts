// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { SdkError, call, envKind, envLabel, fetchChildren, fetchItemId, toEnvs } from '@/lib/sdk';
import { fakeClient } from '@/test/fakeClient';

const DEV = { id: 'r1', name: 'Dev', contextId: 'p1' };
const ENTRIES = [
  { resourceId: 'r1', tenantDisplayName: 'Dev', context: { preview: 'p1', live: 'l1' } },
  { resourceId: 'r2', tenantName: 'acme-qa', context: { preview: 'p2', live: 'l2' } },
];
const ENVS = [
  { id: 'p1', name: 'Dev', contextId: 'p1' },
  { id: 'p2', name: 'acme-qa', contextId: 'p2', tenantName: 'acme-qa' },
];

describe('toEnvs', () => {
  it('maps resourceAccess to envs', () => {
    expect(toEnvs({ resourceAccess: ENTRIES } as any)).toEqual(ENVS);
  });
  it('skips entries without a context id', () => {
    const ctx = { resourceAccess: [{ resourceId: 'r1', context: { preview: '', live: 'l1' } }] };
    expect(toEnvs(ctx as any)).toEqual([]);
  });
  it('falls back to deprecated resources', () => {
    expect(toEnvs({ resources: ENTRIES } as any)).toEqual(ENVS);
  });
  it('uses tenantId so environments sharing a resourceId stay distinct', () => {
    const ctx = {
      resourceAccess: [
        { resourceId: 'xmcloud', tenantId: 't1', tenantDisplayName: 'Acme / dev', tenantName: 'acme-dev', context: { preview: 'p1' } },
        { resourceId: 'xmcloud', tenantId: 't2', tenantDisplayName: 'Acme / qa', tenantName: 'acme-qa', context: { preview: 'p2' } },
      ],
    };
    const envs = toEnvs(ctx as any);
    expect(envs.map((e) => e.id)).toEqual(['t1', 't2']);
    expect(envs.map((e) => e.name)).toEqual(['Acme / dev', 'Acme / qa']);
    expect(envs.map((e) => e.tenantName)).toEqual(['acme-dev', 'acme-qa']);
  });
  it('falls back to the context id without a tenantId', () => {
    const ctx = { resourceAccess: [{ resourceId: 'xmcloud', context: { preview: 'p1' } }] };
    expect(toEnvs(ctx as any)[0].id).toBe('p1');
  });
  it('tells apart environments with the same display name', () => {
    const ctx = {
      resourceAccess: [
        { resourceId: 'r1', tenantName: 'acme-dev', tenantDisplayName: 'Acme', context: { preview: 'p1' } },
        { resourceId: 'r2', tenantDisplayName: 'Acme', context: { preview: 'p2' } },
        { resourceId: 'r3', tenantDisplayName: 'QA', context: { preview: 'p3' } },
      ],
    };
    expect(toEnvs(ctx as any).map((e) => e.name)).toEqual(['Acme (acme-dev)', 'Acme (r2)', 'QA']);
  });
  it('tells apart same-named environments by tenantId when there is no tenantName', () => {
    const ctx = {
      resourceAccess: [
        { resourceId: 'xmcloud', tenantId: 't1', tenantDisplayName: 'X', context: { preview: 'p1' } },
        { resourceId: 'xmcloud', tenantId: 't2', tenantDisplayName: 'X', context: { preview: 'p2' } },
      ],
    };
    expect(toEnvs(ctx as any).map((e) => e.name)).toEqual(['X (t1)', 'X (t2)']);
  });
});

describe('envKind', () => {
  const kind = (name: string, tenantName?: string) => envKind({ id: 'i', name, contextId: 'c', tenantName });
  it.each([
    ['Acme Production', 'prod'],
    ['acme-prd', 'prod'],
    ['Live site', 'prod'],
    ['QA', 'test'],
    ['uat', 'test'],
    ['Staging', 'test'],
    ['devpets', 'dev'],
    ['local', 'dev'],
    ['Content hub', null],
    ['dev-to-prod', 'prod'],
  ])('%s -> %s', (name, expected) => {
    expect(kind(name)).toBe(expected);
  });
  it('checks tenantName when name has no match', () => {
    expect(kind('Content hub', 'acme-prd')).toBe('prod');
  });
  it('lets a prod match in either text win over a weaker match in the other', () => {
    expect(kind('Latest Content', 'acme-prod')).toBe('prod');
    expect(kind('Develop Hub', 'acme-qa')).toBe('test');
  });
});

describe('envLabel', () => {
  const label = (name: string, tenantName?: string) => envLabel({ id: 'i', name, contextId: 'c', tenantName });
  it.each([
    ['petsuppliesplus / staging', 'Staging'],
    ['petsuppliesplus / qa', 'QA'],
    ['petsuppliesplus / dev', 'Dev'],
    ['Acme Production', 'Prod'],
    ['acme-prd', 'Prod'],
    ['Live site', 'Live'],
    ['uat', 'UAT'],
    ['Smoke test', 'Test'],
    ['local', 'Local'],
    ['dev-to-prod', 'Prod'],
    ['Content hub', null],
  ])('%s -> %s', (name, expected) => {
    expect(label(name)).toBe(expected);
  });
  it('checks tenantName when name has no match', () => {
    expect(label('Content hub', 'acme-staging')).toBe('Staging');
  });
  it('lets an earlier pattern match in either text win over a later one in the other', () => {
    expect(label('Latest Content', 'acme-prod')).toBe('Prod');
    expect(label('Develop Hub', 'acme-qa')).toBe('QA');
  });
});

describe('call', () => {
  const START = 'xmc.contentTransfer.completeChunkSetTransfer';

  it('adds sitecoreContextId and returns data and response', async () => {
    const { client, calls } = fakeClient({ [START]: () => ({ data: { ok: 1 } }) });
    const res = await call(client, DEV, 'mutate', START, { path: { transferId: 't', chunksetId: 'c' } });
    expect(calls[0].params).toEqual({
      path: { transferId: 't', chunksetId: 'c' },
      query: { sitecoreContextId: 'p1' },
    });
    expect(res.data).toEqual({ ok: 1 });
    expect(res.response?.status).toBe(200);
  });

  it('unwraps query results', async () => {
    const key = 'xmc.contentTransfer.getContentTransferStatus';
    const { client } = fakeClient({ [key]: () => ({ data: { status: 'Done' } }) });
    const res = await call(client, DEV, 'query', key, { path: { transferId: 't' } });
    expect(res.data).toEqual({ status: 'Done' });
  });

  it('maps 401 and 403 to the access message', async () => {
    for (const status of [401, 403]) {
      const { client } = fakeClient({ [START]: () => ({ status }) });
      const err = await call(client, DEV, 'mutate', START).catch((e) => e);
      expect(err).toBeInstanceOf(SdkError);
      expect(err.message).toBe("The app can't access Dev. Grant it in Cloud Portal → app → environment access.");
      expect(err.status).toBe(status);
    }
  });

  it('reports other API errors with status', async () => {
    const { client } = fakeClient({ [START]: () => ({ status: 500, error: { Message: 'boom' } }) });
    const err = await call(client, DEV, 'mutate', START).catch((e) => e);
    expect(err).toBeInstanceOf(SdkError);
    expect(err.message).toContain('boom');
    expect(err.status).toBe(500);
  });

  it('reports an API error without a body as just the status', async () => {
    const { client } = fakeClient({ [START]: () => ({ status: 500 }) });
    const err = await call(client, DEV, 'mutate', START).catch((e) => e);
    expect(err).toBeInstanceOf(SdkError);
    expect(err.status).toBe(500);
    expect(err.message).toBe('HTTP 500');
  });

  it('resolves a 204 with no data to {}', async () => {
    const { client } = fakeClient({ [START]: () => ({ status: 204 }) });
    const res = await call(client, DEV, 'mutate', START);
    expect(res.data).toEqual({});
    expect(res.response?.status).toBe(204);
  });

  it('wraps errors thrown inside query()', async () => {
    const key = 'xmc.contentTransfer.getContentTransferStatus';
    const { client } = fakeClient({ [key]: () => { throw new Error('bridge down'); } });
    const err = await call(client, DEV, 'query', key).catch((e) => e);
    expect(err).toBeInstanceOf(SdkError);
    expect(err.message).toBe('bridge down');
  });

  it('wraps thrown client errors', async () => {
    const { client } = fakeClient({ [START]: () => { throw new Error('bridge down'); } });
    const err = await call(client, DEV, 'mutate', START).catch((e) => e);
    expect(err).toBeInstanceOf(SdkError);
    expect(err.message).toBe('bridge down');
  });
});

const GQL = 'xmc.authoring.graphql';

describe('fetchChildren', () => {
  it('maps nodes', async () => {
    const { client } = fakeClient({
      [GQL]: () => ({
        data: {
          data: {
            item: {
              children: {
                nodes: [
                  { itemId: 'a', name: 'content', path: '/sitecore/content', children: { nodes: [{ itemId: 'x' }] } },
                  { itemId: 'b', name: 'leaf', path: '/sitecore/leaf', children: { nodes: [] } },
                ],
              },
            },
          },
        },
      }),
    });
    expect(await fetchChildren(client, DEV, '/sitecore')).toEqual([
      { id: 'a', name: 'content', path: '/sitecore/content', hasChildren: true },
      { id: 'b', name: 'leaf', path: '/sitecore/leaf', hasChildren: false },
    ]);
  });

  it('passes the path verbatim', async () => {
    const { client, calls } = fakeClient({ [GQL]: () => ({ data: { data: { item: null } } }) });
    await fetchChildren(client, DEV, '/sitecore/media library/Images');
    expect(calls[0].params.body.variables.path).toBe('/sitecore/media library/Images');
  });

  it('returns [] for a missing item', async () => {
    const { client } = fakeClient({ [GQL]: () => ({ data: { data: { item: null } } }) });
    expect(await fetchChildren(client, DEV, '/nope')).toEqual([]);
  });

  it('throws the first GraphQL error', async () => {
    const { client } = fakeClient({ [GQL]: () => ({ data: { errors: [{ message: 'bad' }] } }) });
    await expect(fetchChildren(client, DEV, '/x')).rejects.toThrow('bad');
  });
});

describe('fetchItemId', () => {
  it('returns the id or null', async () => {
    const hit = fakeClient({ [GQL]: () => ({ data: { data: { item: { itemId: 'abc' } } } }) });
    expect(await fetchItemId(hit.client, DEV, '/sitecore/content')).toBe('abc');
    const miss = fakeClient({ [GQL]: () => ({ data: { data: { item: null } } }) });
    expect(await fetchItemId(miss.client, DEV, '/nope')).toBeNull();
  });
});
