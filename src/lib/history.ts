import { graphql, type Env, type SdkClient } from '@/lib/sdk';
import type { DataTree, RunCallbacks, StepStatus } from '@/lib/transfer';

/** One run as recorded on a target. `source` is left out for an install, `by` when the host doesn't say who ran it. */
export type HistoryEntry = {
  id: string;
  kind: 'transfer' | 'install';
  /** When the run started, as an ISO date. */
  at: string;
  by?: string;
  source?: string;
  target: string;
  items: DataTree[];
  result: 'success' | 'fail';
  tookMs?: number;
  itemCount?: number;
};

const MODULES = '/sitecore/system/Modules';
const APP = `${MODULES}/Content Transfer`;
/** Where each target keeps its history: one item per run, the entry as JSON in its `__Long description`. */
export const HISTORY_PATH = `${APP}/History`;
// Sitecore's built-in Folder template (/sitecore/templates/Common/Folder), for the folders and the entries alike.
const FOLDER = '{A87A00B1-E6DB-45AB-8B54-636FEC3B5523}';
const FIELD = '__Long description';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The entry's item name, in local time: "2026-11-19 1432 a1b2c3". Digits, spaces and hyphens only, which Sitecore's
 * default item name rules allow (ItemNameValidation; none of the InvalidItemNameChars).
 */
export const historyName = (d: Date, id: string) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())} ${id.slice(0, 6)}`;

const FOLDERS_QUERY = `query HistoryFolder($m: String!, $c: String!, $h: String!) {
  m: item(where: { path: $m, database: "master" }) { itemId }
  c: item(where: { path: $c, database: "master" }) { itemId }
  h: item(where: { path: $h, database: "master" }) { itemId }
}`;

const LIST_QUERY = `query History($path: String!) {
  item(where: { path: $path, database: "master" }) {
    children(first: 1000) { nodes { d: field(name: "${FIELD}") { value } } }
  }
}`;

// createItem writes to master. Its input goes in as literals, like the lookups in related.ts: `parent` is an ID.
async function createFolder(client: SdkClient, env: Env, name: string, parent: string, value?: string, sortorder?: number): Promise<string> {
  const s = JSON.stringify;
  const list = [
    ...(value === undefined ? [] : [`{ name: ${s(FIELD)}, value: ${s(value)} }`]),
    ...(sortorder === undefined ? [] : [`{ name: "__Sortorder", value: ${s(String(sortorder))} }`]),
  ];
  const fields = list.length ? `, fields: [${list.join(', ')}]` : '';
  const data = await graphql(
    client,
    env,
    `mutation CreateHistoryItem {
  createItem(input: { name: ${s(name)}, templateId: ${s(FOLDER)}, parent: ${s(parent)}, language: "en"${fields} }) { item { itemId } }
}`,
    {},
  );
  const id: string | undefined = data?.createItem?.item?.itemId;
  if (!id) throw new Error(`${name} wasn't created.`);
  return id;
}

/** Adds `entry` to `env`'s history, creating the Content Transfer and History folders the first time. */
export async function addEntry(client: SdkClient, env: Env, entry: HistoryEntry): Promise<void> {
  const found = (await graphql(client, env, FOLDERS_QUERY, { m: MODULES, c: APP, h: HISTORY_PATH })) ?? {};
  let folder: string | undefined = found.h?.itemId;
  if (!folder) {
    if (!found.m?.itemId) throw new Error(`${MODULES} wasn't found.`);
    const app = found.c?.itemId ?? (await createFolder(client, env, 'Content Transfer', found.m.itemId));
    folder = await createFolder(client, env, 'History', app);
  }
  // Children sort by __Sortorder first: a count down in minutes puts the newest run first, so the 1,000 that
  // loadHistory reads are the latest.
  const sortorder = -Math.floor(new Date(entry.at).getTime() / 60_000);
  await createFolder(client, env, historyName(new Date(entry.at), entry.id), folder, JSON.stringify(entry), sortorder);
}

/** `env`'s history, newest first. Entries that aren't readable are skipped; no History folder yet is no runs. */
export async function loadHistory(client: SdkClient, env: Env): Promise<HistoryEntry[]> {
  const data = await graphql(client, env, LIST_QUERY, { path: HISTORY_PATH });
  // ponytail: the first 1,000 children only, newest first by __Sortorder (see addEntry); page with `after` past that.
  const nodes: { d?: { value?: string } | null }[] = data?.item?.children?.nodes ?? [];
  const entries = nodes.flatMap((n): HistoryEntry[] => {
    try {
      const e = JSON.parse(n.d?.value ?? '');
      return typeof e?.at === 'string' && typeof e.target === 'string' && Array.isArray(e.items) ? [e] : [];
    } catch {
      return [];
    }
  });
  return entries.sort((a, b) => b.at.localeCompare(a.at));
}

// The signed-in user's name, or email, from the host; nothing when it doesn't say.
async function currentUser(client: SdkClient): Promise<string | undefined> {
  try {
    const res = await client.query('host.user');
    return res?.data?.name || res?.data?.email || undefined;
  } catch {
    return undefined;
  }
}

type Exec = (cb: RunCallbacks, signal: AbortSignal) => Promise<boolean>;

/** What withHistory records of a run. `importAt[k]` is the index of `targets[k]`'s import step. */
export type RunRecord = {
  kind: HistoryEntry['kind'];
  source?: Env;
  targets: Env[];
  importAt: number[];
  items: DataTree[];
  /** Known up front for an install; a transfer takes the package's count when it's ready. */
  itemCount?: number;
};

/**
 * Wraps a run's `exec` so that, once it ends, the run is recorded on each target whose import step started (before
 * that, nothing was written there). A target counts as a success when the run succeeded or its Verify step, right after
 * its import, finished: in a run that stopped on a later target it got the content. Recording runs in the background,
 * so it never delays or fails the run; a target it can't record on gets one warning in the run's log.
 */
export function withHistory(client: SdkClient, record: RunRecord, exec: Exec): Exec {
  return async (cb, signal) => {
    const at = new Date();
    const status = new Map<number, StepStatus>();
    let itemCount = record.itemCount;
    let ok = false;
    try {
      ok = await exec(
        {
          ...cb,
          onStepChange: (i, s) => {
            status.set(i, s);
            cb.onStepChange(i, s);
          },
          onInfo: (info) => {
            itemCount = info.itemCount || undefined;
            cb.onInfo?.(info);
          },
        },
        signal,
      );
      return ok;
    } finally {
      const reached = record.targets.flatMap((env, k) => (status.has(record.importAt[k]) ? [{ env, importAt: record.importAt[k] }] : []));
      const entry = {
        id: crypto.randomUUID().replace(/-/g, ''),
        kind: record.kind,
        at: at.toISOString(),
        source: record.source?.name,
        items: record.items,
        tookMs: Date.now() - at.getTime(),
        itemCount,
      } as const;
      if (reached.length) {
        void currentUser(client).then((by) =>
          Promise.all(
            reached.map(({ env, importAt }) =>
              addEntry(client, env, { ...entry, by, target: env.name, result: ok || status.get(importAt + 1) === 'done' ? 'success' : 'fail' }).catch((e) =>
                cb.onLog(`Couldn't record this run in ${env.name}'s history: ${message(e)}`, 'warning'),
              ),
            ),
          ),
        );
      }
    }
  };
}
