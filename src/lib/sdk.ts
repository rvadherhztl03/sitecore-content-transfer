/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ApplicationContext } from '@sitecore-marketplace-sdk/client';

export type Env = { id: string; name: string; contextId: string; tenantName?: string };

export interface SdkClient {
  query(key: string, options?: { params?: unknown }): Promise<any>;
  mutate(key: string, options?: { params?: unknown }): Promise<any>;
}

export class SdkError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'SdkError';
    this.status = status;
  }
}

export const CONTEXT_KIND: 'preview' | 'live' = 'preview';

// The SDK's published .d.ts re-exports from a missing ../src, so ApplicationContext resolves to `any`; type the entries here.
type Resource = {
  resourceId: string;
  tenantId?: string;
  tenantName?: string;
  tenantDisplayName?: string;
  context?: { live?: string; preview?: string };
};

export function toEnvs(ctx: ApplicationContext | undefined): Env[] {
  const entries: Resource[] = ctx?.resourceAccess ?? ctx?.resources ?? [];
  const envs = entries.flatMap((r) => {
    const contextId = r.context?.[CONTEXT_KIND];
    // In XM Cloud every entry shares the product's resourceId, so the tenant identifies the environment.
    const name = r.tenantDisplayName ?? r.tenantName ?? r.resourceId;
    return contextId ? [{ id: r.tenantId ?? contextId, name, contextId, tenantName: r.tenantName, r }] : [];
  });
  // Same display name twice: add the tenant name, tenant id or resource id so the pickers can tell them apart.
  return envs.map(({ r, ...env }) =>
    envs.filter((e) => e.name === env.name).length > 1 ? { ...env, name: `${env.name} (${r.tenantName ?? r.tenantId ?? r.resourceId})` } : env,
  );
}

export type EnvKind = 'prod' | 'test' | 'dev';

const KINDS: [EnvKind, RegExp][] = [
  ['prod', /prod|prd|live/i],
  ['test', /qa|test|uat|stag/i],
  ['dev', /dev|local/i],
];

/** Guesses the environment's role from its name and tenant name; prod beats test beats dev across both, `null` when neither says. */
export function envKind(env: Env): EnvKind | null {
  const texts = [env.name, env.tenantName].filter((t): t is string => !!t);
  return KINDS.find(([, re]) => texts.some((t) => re.test(t)))?.[0] ?? null;
}

// Returns '' when there is nothing useful to say (undefined, empty string or `{}`).
const errorText = (e: any): string => {
  const t = typeof e === 'string' ? e : (e?.message ?? e?.Message ?? e?.title ?? JSON.stringify(e));
  return typeof t === 'string' && t !== '{}' ? t : '';
};

export async function call<T = any>(
  client: SdkClient,
  env: Env,
  kind: 'query' | 'mutate',
  key: string,
  params: { path?: Record<string, unknown>; query?: Record<string, unknown>; body?: unknown } = {},
): Promise<{ data: T; response?: Response }> {
  const options = { params: { ...params, query: { ...params.query, sitecoreContextId: env.contextId } } };
  let res: any;
  try {
    res = await client[kind](key, options);
  } catch (e) {
    throw new SdkError(errorText(e) || 'SDK call failed');
  }
  // query() catches thrown errors into `error` and wraps the hey-api result in `data`.
  if (kind === 'query' && res?.error !== undefined) throw new SdkError(errorText(res.error) || 'SDK call failed');
  const { data, error, response } = (kind === 'query' ? res?.data : res) ?? {};
  if ((response && !response.ok) || error !== undefined) {
    const status: number | undefined = response?.status;
    if (status === 401 || status === 403) {
      throw new SdkError(`The app can't access ${env.name}. Grant it in Cloud Portal → app → environment access.`, status);
    }
    const text = errorText(error) || response?.statusText;
    throw new SdkError(`HTTP ${status}${text ? `: ${text}` : ''}`, status);
  }
  return { data, response };
}

export type TreeNode = { id: string; name: string; path: string; hasChildren: boolean };

async function graphql(client: SdkClient, env: Env, query: string, path: string): Promise<any> {
  const { data } = await call(client, env, 'mutate', 'xmc.authoring.graphql', {
    body: { query, variables: { path } },
  });
  if (data?.errors?.length) throw new SdkError(data.errors[0].message);
  return data?.data;
}

const CHILDREN_QUERY = `query GetItemChildren($path: String!) {
  item(where: { path: $path, database: "master" }) {
    itemId
    name
    path
    children(first: 1000) {
      nodes { itemId name path children(first: 1) { nodes { itemId } } }
    }
  }
}`;

const ITEM_ID_QUERY = `query GetItemId($path: String!) {
  item(where: { path: $path, database: "master" }) { itemId }
}`;

export async function fetchChildren(client: SdkClient, env: Env, path: string): Promise<TreeNode[]> {
  const data = await graphql(client, env, CHILDREN_QUERY, path);
  const nodes: any[] = data?.item?.children?.nodes ?? [];
  return nodes.map((n) => ({
    id: n.itemId,
    name: n.name,
    path: n.path,
    hasChildren: (n.children?.nodes?.length ?? 0) > 0,
  }));
}

export async function fetchItemId(client: SdkClient, env: Env, path: string): Promise<string | null> {
  const data = await graphql(client, env, ITEM_ID_QUERY, path);
  return data?.item?.itemId ?? null;
}
