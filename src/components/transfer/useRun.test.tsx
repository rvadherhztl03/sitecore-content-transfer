import { useRun } from '@/components/transfer/useRun';
import type { RunCallbacks } from '@/lib/transfer';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const QA = { id: 'qa', name: 'Acme · QA', contextId: 'ctx-qa' };

// An exec that stays pending until `finish(ok)`, and hands over its callbacks and signal.
function pending() {
  let finish!: (ok: boolean) => void;
  let cb!: RunCallbacks;
  let signal!: AbortSignal;
  const exec = vi.fn((c: RunCallbacks, s: AbortSignal) => {
    cb = c;
    signal = s;
    return new Promise<boolean>((resolve) => (finish = resolve));
  });
  return { exec, finish: (ok: boolean) => act(async () => finish(ok)), cb: () => cb, signal: () => signal };
}

describe('useRun', () => {
  it('starts running with every step pending, keeps the route, and ends with the result and the time taken', async () => {
    const { result } = renderHook(() => useRun());
    expect(result.current.run).toBeNull();
    const job = pending();
    let started!: Promise<void>;
    act(() => {
      started = result.current.start({ labels: ['One', 'Two'], targets: [QA], info: { chunkCount: 4 } }, job.exec);
    });
    expect(result.current.running).toBe(true);
    expect(result.current.run).toMatchObject({
      targets: [QA],
      steps: [
        { label: 'One', status: 'pending' },
        { label: 'Two', status: 'pending' },
      ],
      progress: 0,
      logs: [],
      running: true,
      result: null,
      info: { chunkCount: 4 },
    });

    act(() => {
      job.cb().onStepChange(0, 'running');
      job.cb().onProgress(40);
      job.cb().onLog('Working', 'info');
      job.cb().onInfo?.({ chunkCount: 9, itemCount: 2 });
    });
    expect(result.current.run).toMatchObject({ progress: 40, info: { chunkCount: 9, itemCount: 2 } });
    expect(result.current.run!.steps[0].status).toBe('running');
    expect(result.current.run!.logs).toMatchObject([{ text: 'Working', type: 'info' }]);

    act(() => job.cb().onStepChange(0, 'done'));
    expect(result.current.run!.steps[0]).toMatchObject({ status: 'done', ms: expect.any(Number) });
    await job.finish(true);
    await started;
    expect(result.current.running).toBe(false);
    expect(result.current.run).toMatchObject({ running: false, result: 'success', tookMs: expect.any(Number) });
  });

  it('ignores a second start while a run is in progress', async () => {
    const { result } = renderHook(() => useRun());
    const first = pending();
    const second = pending();
    act(() => {
      void result.current.start({ labels: ['A'] }, first.exec);
      void result.current.start({ labels: ['B'] }, second.exec);
    });
    expect(first.exec).toHaveBeenCalledOnce();
    expect(second.exec).not.toHaveBeenCalled();
    expect(result.current.run!.steps[0].label).toBe('A');
    await first.finish(false);
    expect(result.current.run).toMatchObject({ running: false, result: 'fail' });

    // After the run, the next start goes through.
    const third = pending();
    act(() => {
      void result.current.start({ labels: ['C'] }, third.exec);
    });
    expect(third.exec).toHaveBeenCalledOnce();
    await third.finish(true);
  });

  it('a throwing exec ends as a failed run with the message logged', async () => {
    const { result } = renderHook(() => useRun());
    await act(() =>
      result.current.start({ labels: ['A'] }, async () => {
        throw new Error('boom');
      }),
    );
    expect(result.current.run).toMatchObject({ running: false, result: 'fail' });
    expect(result.current.run!.logs).toMatchObject([{ text: 'boom', type: 'error' }]);
  });

  it('cancel aborts the signal, and unmount aborts it too', async () => {
    const { result, unmount } = renderHook(() => useRun());
    const job = pending();
    act(() => {
      void result.current.start({ labels: ['A'] }, job.exec);
    });
    expect(job.signal().aborted).toBe(false);
    act(() => result.current.cancel());
    expect(job.signal().aborted).toBe(true);
    await job.finish(false);

    const other = pending();
    act(() => {
      void result.current.start({ labels: ['A'] }, other.exec);
    });
    unmount();
    expect(other.signal().aborted).toBe(true);
    // Let the run end, so it doesn't outlive the test.
    await other.finish(false);
  });

  it('canCancelUntil is true only while that step has not started', async () => {
    const { result } = renderHook(() => useRun());
    expect(result.current.canCancelUntil(1)).toBe(true);
    const job = pending();
    act(() => {
      void result.current.start({ labels: ['A', 'B', 'C'] }, job.exec);
    });
    expect(result.current.canCancelUntil(1)).toBe(true);
    act(() => job.cb().onStepChange(0, 'running'));
    expect(result.current.canCancelUntil(1)).toBe(true);
    // Running, failed (cleanup still in progress) and done all count as started.
    for (const status of ['running', 'fail', 'done'] as const) {
      act(() => job.cb().onStepChange(1, status));
      expect(result.current.canCancelUntil(1)).toBe(false);
    }
    expect(result.current.canCancelUntil(2)).toBe(true);
    await job.finish(true);
  });

  it('reset clears the run', async () => {
    const { result } = renderHook(() => useRun());
    await act(() => result.current.start({ labels: ['A'] }, async () => true));
    expect(result.current.run?.result).toBe('success');
    act(() => result.current.reset());
    expect(result.current.run).toBeNull();
    expect(result.current.running).toBe(false);
  });
});
