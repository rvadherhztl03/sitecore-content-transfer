import { describe, expect, it } from 'vitest';
import { inParallel } from '@/lib/parallel';

const tick = () => new Promise((r) => setTimeout(r));

describe('inParallel', () => {
  it('runs every item, never more than `limit` at once, starting them in order', async () => {
    let running = 0;
    let most = 0;
    const started: number[] = [];
    await inParallel([0, 1, 2, 3, 4, 5, 6], async (n) => {
      started.push(n);
      most = Math.max(most, ++running);
      await tick();
      running--;
    }, undefined, 3);
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(most).toBe(3);
  });

  it('stops starting new items after a failure, waits for those running, then throws the first failure', async () => {
    const finished: number[] = [];
    const run = inParallel([0, 1, 2, 3, 4], async (n) => {
      await tick();
      if (n === 1) throw new Error('one failed');
      finished.push(n);
    }, undefined, 2);
    await expect(run).rejects.toThrow('one failed');
    // 0 and 1 ran together; 1 failed, so 2 started only if 0 freed its slot first. 3 and 4 never started.
    expect(finished).not.toContain(3);
    expect(finished).not.toContain(4);
    expect(finished).toContain(0);
  });

  it('starts nothing once aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const started: number[] = [];
    await expect(inParallel([0, 1], async (n) => void started.push(n), controller.signal)).rejects.toThrow();
    expect(started).toEqual([]);
  });

  it('does nothing for no items', async () => {
    await expect(inParallel([], async () => {})).resolves.toBeUndefined();
  });
});
