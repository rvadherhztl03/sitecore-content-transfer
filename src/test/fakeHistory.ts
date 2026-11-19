/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FakeReply } from '@/test/fakeClient';

/** Items by path, per environment (keyed by context ID); `value` is an entry's `__Long description`. */
export type HistoryStore = Record<string, Record<string, { id: string; name: string; value?: string }>>;

/** A store where each listed context ID has /sitecore/system/Modules, as every Sitecore instance does. */
export const historyStore = (...contextIds: string[]): HistoryStore =>
  Object.fromEntries(contextIds.map((c) => [c, { '/sitecore/system/Modules': { id: `${c}-modules`, name: 'Modules' } }]));

/** Whether a GraphQL call is one of the run history's queries or its createItem mutation (src/lib/history.ts). */
export const isHistory = (p: any) => typeof p?.body?.query === 'string' && /^(query History|mutation CreateHistoryItem)/.test(p.body.query);

const literal = (query: string, key: string) => JSON.parse(query.match(new RegExp(`${key}: ("(?:[^"\\\\]|\\\\.)*")`))![1]);

/**
 * Answers the run history from `store`: the folder lookup by path, createItem (which adds the item under its parent,
 * by ID) and the History folder's children, in insertion order.
 */
export const historyReply = (store: HistoryStore) => (p: any): FakeReply => {
  const items = (store[p.query.sitecoreContextId] ??= {});
  const query: string = p.body.query;
  if (query.startsWith('mutation')) {
    const parent = Object.keys(items).find((k) => items[k].id === literal(query, 'parent'));
    if (!parent) return { data: { errors: [{ message: 'Parent not found' }] } };
    const name = literal(query, 'name');
    const id = `${p.query.sitecoreContextId}-${Object.keys(items).length}`;
    items[`${parent}/${name}`] = { id, name, value: query.includes('fields:') ? literal(query, 'value') : undefined };
    return { data: { data: { createItem: { item: { itemId: id } } } } };
  }
  const vars = p.body.variables as Record<string, string>;
  if (query.startsWith('query HistoryFolder')) {
    return { data: { data: Object.fromEntries(Object.entries(vars).map(([k, path]) => [k, items[path] ? { itemId: items[path].id } : null])) } };
  }
  const kids = Object.keys(items).filter((k) => k.startsWith(`${vars.path}/`) && !k.slice(vars.path.length + 1).includes('/'));
  const node = (k: string) => ({ d: items[k].value === undefined ? null : { value: items[k].value } });
  return { data: { data: { item: items[vars.path] ? { children: { nodes: kids.map(node) } } : null } } };
};

/** The entries recorded on one environment, oldest first. */
export const entriesIn = (store: HistoryStore, contextId: string) =>
  Object.entries(store[contextId] ?? {})
    .filter(([path, it]) => path.startsWith('/sitecore/system/Modules/Content Transfer/History/') && it.value !== undefined)
    .map(([, it]) => JSON.parse(it.value!));
