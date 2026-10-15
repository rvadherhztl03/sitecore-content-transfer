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
