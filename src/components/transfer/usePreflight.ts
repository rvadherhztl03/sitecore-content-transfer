import { runPreflight, type ItemCheck } from '@/lib/preflight';
import type { Env, SdkClient } from '@/lib/sdk';
import type { DataTree } from '@/lib/transfer';
import { useEffect, useState } from 'react';

export type Preflight =
  | { status: 'checking' }
  | { status: 'done'; checks: Map<string, ItemCheck> }
  | { status: 'failed'; error: string };

/**
 * Runs the pre-flight check for the route and list, again whenever either changes. Without a source,
 * target or items it doesn't run and returns undefined; a result for an older route or list is never returned.
 */
export function usePreflight(client: SdkClient | null, source: Env | undefined, target: Env | undefined, trees: DataTree[]): Preflight | undefined {
  const key = client && source && target && trees.length ? JSON.stringify([source.id, target.id, trees]) : null;
  const [result, setResult] = useState<{ key: string; value: Preflight }>();

  useEffect(() => {
    if (!key) return;
    let live = true;
    runPreflight(client!, source!, target!, trees).then(
      (checks) => live && setResult({ key, value: { status: 'done', checks } }),
      (e) => live && setResult({ key, value: { status: 'failed', error: e instanceof Error ? e.message : String(e) } }),
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
