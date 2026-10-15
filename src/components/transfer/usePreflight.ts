import { runPreflight, type ItemCheck } from '@/lib/preflight';
import { scanRelated, type RelatedItem } from '@/lib/related';
import type { Env, SdkClient } from '@/lib/sdk';
import type { DataTree } from '@/lib/transfer';
import { useEffect, useState } from 'react';

export type Preflight =
  | { status: 'checking' }
  /** `related` is left out when the related-content scan failed; `relatedError` then says why. */
  | { status: 'done'; checks: Map<string, ItemCheck>; related?: RelatedItem[]; relatedError?: string }
  | { status: 'failed'; error: string };

/**
 * Runs the pre-flight check and the related-content scan for the route and list, again whenever either changes; a failed
 * scan doesn't fail the check. Without a source, target or items it doesn't run and returns undefined; a result for an
 * older route or list is never returned.
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
    Promise.all([runPreflight(client!, source!, target!, trees), scan]).then(
      ([checks, found]) => live && setResult({ key, value: { status: 'done', checks, ...found } }),
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
