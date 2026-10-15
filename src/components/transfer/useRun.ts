import type { LogLine, RunInfo } from '@/components/transfer/RunView';
import type { Env } from '@/lib/sdk';
import type { RunCallbacks, StepStatus } from '@/lib/transfer';
import { useEffect, useRef, useState } from 'react';

export type Run = {
  // The route as started: what the run writes and what RunView names, even if `envs` changes meanwhile.
  source?: Env;
  target?: Env;
  steps: { label: string; status: StepStatus; ms?: number }[];
  progress: number;
  logs: LogLine[];
  running: boolean;
  result: 'success' | 'fail' | null;
  tookMs?: number;
  info?: RunInfo;
};

type Init = { labels: string[]; source?: Env; target?: Env; info?: RunInfo };
type Exec = (cb: RunCallbacks, signal: AbortSignal) => Promise<boolean>;

/**
 * The state of one transfer, export or install run, shared by the flows.
 * - `run` is null until `start`, and always starts as running, so RunView never sees running=false with no result.
 * - A second `start` while a run is in progress is ignored; leaving (unmount) aborts it.
 * - `exec` does the work and returns whether it succeeded; a throw counts as a failure and is logged.
 * - Put `headingRef` on the element that holds RunView: its h1 is focused when the result arrives.
 */
export function useRun() {
  const [run, setRun] = useState<Run | null>(null);
  // Non-null while a run is in progress.
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  // Announce completion or failure: move focus to the run heading.
  const headingRef = useRef<HTMLElement>(null);
  const result = run?.result;
  useEffect(() => {
    const h = result && headingRef.current?.querySelector('h1');
    if (!h) return;
    h.tabIndex = -1;
    h.focus();
  }, [result]);

  const start = async ({ labels, source, target, info }: Init, exec: Exec) => {
    if (abort.current) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    const began = Date.now();
    const stepStart: number[] = [];
    setRun({
      source,
      target,
      steps: labels.map((label) => ({ label, status: 'pending' })),
      progress: 0,
      logs: [],
      running: true,
      result: null,
      info,
    });
    const update = (patch: (r: Run) => Partial<Run>) => setRun((r) => r && { ...r, ...patch(r) });
    const cb: RunCallbacks = {
      onLog: (text, type) => update((r) => ({ logs: [...r.logs, { text, type, time: new Date().toLocaleTimeString() }] })),
      onProgress: (progress) => update(() => ({ progress })),
      onStepChange: (i, status) => {
        const now = Date.now();
        if (status === 'running') stepStart[i] = now;
        const ms = status === 'running' ? undefined : now - (stepStart[i] ?? now);
        update((r) => ({ steps: r.steps.map((s, j) => (j === i ? { ...s, status, ms } : s)) }));
      },
      onInfo: (next) => update(() => ({ info: next })),
    };
    let ok = false;
    try {
      ok = await exec(cb, ctrl.signal);
    } catch (e) {
      cb.onLog(e instanceof Error ? e.message : String(e), 'error');
    }
    abort.current = null;
    update(() => ({ running: false, result: ok ? 'success' : 'fail', tookMs: Date.now() - began }));
  };

  return {
    run,
    running: !!run?.running,
    headingRef,
    start,
    cancel: () => abort.current?.abort(),
    reset: () => setRun(null),
    /**
     * True while step `i` has not started. Cancel is only safe to offer then: from the import step on (even once it
     * has failed and cleanup is running) the target may already be importing and finishes on its own.
     */
    canCancelUntil: (i: number) => (run?.steps[i]?.status ?? 'pending') === 'pending',
  };
}
