// ponytail: tern's measured setting for SitecoreAI (github.com/markgibbons25/tern, docs/settings.md): four was too few,
// more than eight changed nothing.
export const PARALLEL = 8;

/**
 * Runs `fn` on every item, at most `limit` at a time, starting them in order. The first failure (or an abort) stops
 * new ones from starting and is thrown once those already running have settled, so nothing is left running behind it.
 */
export async function inParallel<T>(items: readonly T[], fn: (item: T, index: number) => Promise<void>, signal?: AbortSignal, limit = PARALLEL): Promise<void> {
  let next = 0;
  let failed: { error: unknown } | undefined;
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        signal?.throwIfAborted();
        await fn(items[i], i);
      } catch (error) {
        failed ??= { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failed) throw failed.error;
}
