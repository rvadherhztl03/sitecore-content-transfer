import { runPreflight, type ItemCheck } from '@/lib/preflight';
import { scanDefinitions, scanRelated, type Definition, type RelatedItem } from '@/lib/related';
import type { Env, SdkClient } from '@/lib/sdk';
import type { DataTree } from '@/lib/transfer';
import { useEffect, useState } from 'react';

export type Preflight =
  | { status: 'checking' }
  /**
   * `related` is left out when the related-content scan failed, `definitions` when the template and rendering check
   * failed; `relatedError` and `definitionsError` then say why.
   */
  | {
      status: 'done';
      checks: Map<string, ItemCheck>;
      related?: RelatedItem[];
      relatedError?: string;
      definitions?: Definition[];
      definitionsError?: string;
    }
  | { status: 'failed'; error: string };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// One target's check: the pre-flight check itself, with the related-content scan and the template and rendering check
// alongside, whose failures are reported rather than failing it.
async function check(client: SdkClient, source: Env, target: Env, trees: DataTree[]): Promise<Preflight> {
  const scan = scanRelated(client, source, target, trees).then(
    (related) => ({ related }),
    (e) => ({ relatedError: message(e) }),
  );
  const defs = scanDefinitions(client, source, target, trees).then(
    (definitions) => ({ definitions }),
    (e) => ({ definitionsError: message(e) }),
  );
  try {
    const [checks, found, missing] = await Promise.all([runPreflight(client, source, target, trees), scan, defs]);
    return { status: 'done', checks, ...found, ...missing };
  } catch (e) {
    return { status: 'failed', error: message(e) };
  }
}

/**
 * Checks each target for the route and list, in parallel, again whenever any of them changes; each target's result
 * shows as soon as it's ready (keyed by target id). Without a source, targets or items it doesn't run and returns
 * undefined; a result for an older route or list is never returned.
 */
export function usePreflights(client: SdkClient | null, source: Env | undefined, targets: Env[], trees: DataTree[]): Record<string, Preflight> | undefined {
  const key = client && source && targets.length && trees.length ? JSON.stringify([source.id, targets.map((t) => t.id), trees]) : null;
  const [result, setResult] = useState<{ key: string; values: Record<string, Preflight> }>();

  useEffect(() => {
    if (!key) return;
    let live = true;
    for (const target of targets) {
      void check(client!, source!, target, trees).then(
        (value) => live && setResult((r) => ({ key, values: { ...(r?.key === key ? r.values : {}), [target.id]: value } })),
      );
    }
    return () => {
      live = false;
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
