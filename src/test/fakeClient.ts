/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SdkClient } from '@/lib/sdk';

export type FakeReply = { data?: unknown; status?: number; headers?: Record<string, string>; error?: unknown };
type Handler = (params: any) => FakeReply | Promise<FakeReply>;

export function fakeClient(handlers: Record<string, Handler>) {
  const calls: { kind: 'query' | 'mutate'; key: string; params: any }[] = [];
  const run = async (kind: 'query' | 'mutate', key: string, opts?: { params?: unknown }) => {
    calls.push({ kind, key, params: opts?.params });
    const handler = handlers[key];
    if (!handler) throw new Error(`unexpected call ${key}`);
    let reply: FakeReply;
    try { reply = await handler(opts?.params); }
    catch (error) { if (kind === 'query') return { data: undefined, error }; throw error; }
    if (!key.startsWith('xmc.')) return { data: reply.data };
    const status = reply.status ?? 200;
    const result = {
      data: status < 400 ? (reply.data ?? {}) : undefined, // real client returns {} for 204/empty bodies
      error: status >= 400 ? (reply.error ?? {}) : undefined, // real client: error = body || {}
      response: new Response(null, { status, headers: reply.headers }),
    };
    return kind === 'query' ? { data: result } : result;
  };
  const client: SdkClient = { query: (k, o) => run('query', k, o), mutate: (k, o) => run('mutate', k, o) };
  return { client, calls };
}

type Found = { id: string; children?: { id: string; name: string }[] };

/**
 * Answers the pre-flight GraphQL query (src/lib/preflight.ts): `find(contextId, path)` gives the item at that path in that
 * environment, or nothing. `p…` aliases get the item's ID, `c…` aliases its children; each alias is named like its variable.
 */
export const preflightReply = (find: (contextId: string, path: string) => Found | undefined) => (p: any): FakeReply => {
  const data: Record<string, unknown> = {};
  for (const [k, path] of Object.entries(p.body.variables as Record<string, string>)) {
    const it = find(p.query.sitecoreContextId, path);
    data[k] = !it ? null : k.startsWith('c') ? { children: { nodes: (it.children ?? []).map((c) => ({ itemId: c.id, name: c.name })) } } : { itemId: it.id };
  }
  return { data: { data } };
};

/** Whether a GraphQL call is the pre-flight query. */
export const isPreflight = (p: any) => typeof p?.body?.query === 'string' && p.body.query.startsWith('query Preflight');
