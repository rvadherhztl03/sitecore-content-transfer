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

/**
 * Runs the pre-flight check, the related-content scan and the template and rendering check for the route and list,
 * again whenever either changes; a failed scan or template check doesn't fail the check. Without a source, target or
 * items it doesn't run and returns undefined; a result for an older route or list is never returned.
 */
export function usePreflight(client: SdkClient | null, source: Env | undefined, target: Env | undefined, trees: DataTree[]): Preflight | undefined {
  const key = client && source && target && trees.length ? JSON.stringify([source.id, target.id, trees]) : null;
  const [result, setResult] = useState<{ key: string; value: Preflight }>();

  useEffect(() => {
    if (!key) return;
    let live = true;
    const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
    const scan = scanRelated(client!, source!, target!, trees).then(
      (related) => ({ related }),
      (e) => ({ relatedError: message(e) }),
    );
    const defs = scanDefinitions(client!, source!, target!, trees).then(
      (definitions) => ({ definitions }),
      (e) => ({ definitionsError: message(e) }),
    );
    Promise.all([runPreflight(client!, source!, target!, trees), scan, defs]).then(
      ([checks, found, missing]) => live && setResult({ key, value: { status: 'done', checks, ...found, ...missing } }),
      (e) => live && setResult({ key, value: { status: 'failed', error: message(e) } }),
    );
    return () => {
      live = false;
    };
    // The key stands for the source, target and list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!key) return undefined;
  return result?.key === key ? result.value : { status: 'checking' };
}
