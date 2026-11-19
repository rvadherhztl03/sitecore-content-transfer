import { scanLanguages, scanLocks, scanWorkflow, type LockedItem, type MissingLanguage, type UnapprovedItem } from '@/lib/checks';
import { runPreflight, type ItemCheck } from '@/lib/preflight';
import { scanDefinitions, scanRelated, type Definition, type RelatedItem } from '@/lib/related';
import type { Env, SdkClient } from '@/lib/sdk';
import type { DataTree } from '@/lib/transfer';
import { useEffect, useRef, useState } from 'react';

export type Preflight =
  | { status: 'checking' }
  /**
   * Each side scan's result is left out when it failed, and its `...Error` then says why: `related` (related-content
   * scan), `definitions` (template and rendering check), `languages` (languages the target lacks), `locked` (items
   * locked on the target) and `unapproved` (items not in a final workflow state on the source).
   */
  | {
      status: 'done';
      checks: Map<string, ItemCheck>;
      related?: RelatedItem[];
      relatedError?: string;
      definitions?: Definition[];
      definitionsError?: string;
      languages?: MissingLanguage[];
      languagesError?: string;
      locked?: LockedItem[];
      lockedError?: string;
      unapproved?: UnapprovedItem[];
      unapprovedError?: string;
      /** Checks this target again, keeping this result on show until the new one is ready; resolves then. */
      recheck?(): Promise<void>;
    }
  | { status: 'failed'; error: string };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// A side scan's result, or why it failed: its failure is reported rather than failing the check.
const settle = <T>(scan: Promise<T>): Promise<{ value?: T; error?: string }> => scan.then((value) => ({ value }), (e) => ({ error: message(e) }));

// One target's check: the pre-flight check itself, with the side scans alongside it.
async function check(client: SdkClient, source: Env, target: Env, trees: DataTree[]): Promise<Preflight> {
  try {
    const [checks, related, defs, languages, locked, workflow] = await Promise.all([
      runPreflight(client, source, target, trees),
      settle(scanRelated(client, source, target, trees)),
      settle(scanDefinitions(client, source, target, trees)),
      settle(scanLanguages(client, source, target)),
      settle(scanLocks(client, target, trees)),
      settle(scanWorkflow(client, source, trees)),
    ]);
    return {
      status: 'done',
      checks,
      related: related.value,
      relatedError: related.error,
      definitions: defs.value,
      definitionsError: defs.error,
      languages: languages.value,
      languagesError: languages.error,
      locked: locked.value,
      lockedError: locked.error,
      unapproved: workflow.value,
      unapprovedError: workflow.error,
    };
  } catch (e) {
    return { status: 'failed', error: message(e) };
  }
}

/**
 * Checks each target for the route and list, in parallel, again whenever any of them changes; each target's result
 * shows as soon as it's ready (keyed by target id). A finished check can be run again on its own (`recheck`). Without a
 * source, targets or items it doesn't run and returns undefined; a result for an older route or list is never returned.
 */
export function usePreflights(client: SdkClient | null, source: Env | undefined, targets: Env[], trees: DataTree[]): Record<string, Preflight> | undefined {
  const key = client && source && targets.length && trees.length ? JSON.stringify([source.id, targets.map((t) => t.id), trees]) : null;
  const [result, setResult] = useState<{ key: string; values: Record<string, Preflight> }>();
  // The key whose results are still wanted, so a check that finishes for an older route or list is dropped.
  const live = useRef<string | null>(null);

  const run = (target: Env): Promise<void> =>
    check(client!, source!, target, trees).then((value) => {
      if (live.current !== key) return;
      const next = value.status === 'done' ? { ...value, recheck: () => run(target) } : value;
      setResult((r) => ({ key: key!, values: { ...(r?.key === key ? r.values : {}), [target.id]: next } }));
    });

  useEffect(() => {
    if (!key) return;
    live.current = key;
    for (const target of targets) void run(target);
    return () => {
      live.current = null;
    };
    // The key stands for the source, targets and list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!key) return undefined;
  const values = result?.key === key ? result.values : {};
  return Object.fromEntries(targets.map((t) => [t.id, values[t.id] ?? { status: 'checking' }]));
}

/** usePreflights for one target. */
export function usePreflight(client: SdkClient | null, source: Env | undefined, target: Env | undefined, trees: DataTree[]): Preflight | undefined {
  return usePreflights(client, source, target ? [target] : [], trees)?.[target!.id];
}
