import { EnvironmentCards } from '@/components/transfer/EnvironmentCards';
import { ImportPanel, type LoadedPackage } from '@/components/transfer/ImportPanel';
import { ActionBar, AppHeader, PageHeading } from '@/components/transfer/Layout';
import { ProdConfirm, needsProdConfirm } from '@/components/transfer/ReviewStep';
import { RunView, type LogLine } from '@/components/transfer/RunView';
import { Segmented } from '@/components/transfer/Segmented';
import { Button } from '@/components/ui/button';
import { Icon } from '@/lib/icon';
import type { Env, SdkClient } from '@/lib/sdk';
import { IMPORT_STEP, IMPORT_STEPS, runImport, type RunCallbacks, type StepStatus } from '@/lib/transfer';
import { mdiArrowRight } from '@mdi/js';
import { useEffect, useRef, useState } from 'react';

type Props = { client: SdkClient; envs: Env[]; onHome(): void };

type Run = {
  // The target as started: what the run writes and what RunView names, even if `envs` changes meanwhile.
  target: Env;
  steps: { label: string; status: StepStatus; ms?: number }[];
  progress: number;
  logs: LogLine[];
  running: boolean;
  result: 'success' | 'fail' | null;
  tookMs?: number;
  info: { chunkCount: number; itemCount: number };
};

const DATABASES = [
  { value: 'master', label: 'master' },
  { value: 'web', label: 'web' },
];
const BTN = 'h-11 rounded-[10px] px-5';
const MAIN = 'mx-auto flex w-full max-w-[1120px] flex-1 flex-col gap-6 px-4 pt-7 pb-10 sm:px-8';

const stepLabels = (target: Env, database: string) =>
  IMPORT_STEPS.map((label, i) =>
    i === 1 ? `Assemble package on ${target.name}` : i === IMPORT_STEP.import ? `Import into ${database}` : label,
  );

/** Install a .zip or .raif package into a chosen environment: one screen, then the run. Owns the package, the target and the run. */
export function InstallFlow({ client, envs, onHome }: Props) {
  const [pkg, setPkg] = useState<LoadedPackage | null>(null);
  // Bumped to give ImportPanel a fresh, empty state; it owns what its file card shows.
  const [fresh, setFresh] = useState(0);
  const [targetId, setTargetId] = useState<string>();
  const [database, setDatabase] = useState('master');
  // The target id the production box was ticked for, cleared whenever the target changes.
  const [prodFor, setProdFor] = useState<string | null>(null);
  // Null unless a run exists; a run starts as running, so RunView never sees running=false with no result.
  const [run, setRun] = useState<Run | null>(null);
  // Non-null while a run is in progress: blocks a second start, and leaving the flow aborts it.
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  // An id that is no longer in `envs` counts as unselected.
  const target = envs.find((e) => e.id === targetId);
  const prodChecked = !!target && prodFor === target.id;
  const running = !!run?.running;
  const canStart = !!pkg && !!target && !(needsProdConfirm(target) && !prodChecked);

  // Announce completion or failure: move focus to the run heading.
  const runRef = useRef<HTMLElement>(null);
  const result = run?.result;
  useEffect(() => {
    const h = result && runRef.current?.querySelector('h1');
    if (!h) return;
    h.tabIndex = -1;
    h.focus();
  }, [result]);

  const pickTarget = (id: string) => {
    setTargetId(id);
    setProdFor(null);
  };

  const start = async () => {
    if (abort.current || !canStart) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    const began = Date.now();
    const stepStart: number[] = [];
    const tgt = target!;
    const { parts, items } = pkg!;
    setRun({
      target: tgt,
      steps: stepLabels(tgt, database).map((label) => ({ label, status: 'pending' })),
      progress: 0,
      logs: [],
      running: true,
      result: null,
      info: { chunkCount: parts.reduce((n, p) => n + p.chunks.length, 0), itemCount: items.length },
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
    };
    let ok = false;
    try {
      ok = await runImport(client, { target: tgt, database, parts }, cb, ctrl.signal);
    } catch (e) {
      cb.onLog(e instanceof Error ? e.message : String(e), 'error');
    }
    abort.current = null;
    update(() => ({ running: false, result: ok ? 'success' : 'fail', tookMs: Date.now() - began }));
  };

  const again = () => {
    // A failed run goes back to the screen as it was; a finished one starts over.
    if (run?.result !== 'fail') {
      setPkg(null);
      setFresh((n) => n + 1);
      setTargetId(undefined);
    }
    // Writing to production again needs a new confirmation either way.
    setProdFor(null);
    setRun(null);
  };

  // Cancel is offered until the target starts importing; after that it finishes on its own.
  const importing = ['running', 'done'].includes(run?.steps[IMPORT_STEP.import]?.status ?? '');
  // A bare .raif has no item list to count.
  const count = !pkg ? 'No package' : pkg.items.length === 1 ? '1 item' : pkg.items.length ? `${pkg.items.length} items` : 'No item list';

  return (
    <div className="bg-muted flex min-h-screen flex-col">
      {/* No way out through the header while running (leaving would abort the run), and no Cancel once a run
          exists: RunView's own buttons lead on. */}
      <AppHeader crumb="Install a package" onHome={running ? undefined : onHome} onCancel={run ? undefined : onHome} />
      {/* The screen stays mounted (hidden) during a run: ImportPanel keeps the loaded package for a retry. */}
      <main hidden={!!run} className={MAIN}>
        <PageHeading title="Install a package" sub="Choose a package, check what's inside, and pick where it goes." />
        <div className="flex flex-wrap items-start gap-5">
          <div className="flex min-w-0 flex-[1.2_1_420px] flex-col">
            <ImportPanel key={fresh} onPackage={setPkg} />
          </div>
          <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-4">
            {/* The cards' fieldset has a flex-basis meant for a row; a plain wrapper keeps it from setting a height here. */}
            <div>
              <EnvironmentCards legend="Install into" name="target" envs={envs} value={target?.id} onChange={pickTarget} />
            </div>
            {target && needsProdConfirm(target) && (
              <ProdConfirm target={target} checked={prodChecked} onChange={(v) => setProdFor(v ? target.id : null)} />
            )}
            <section className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border bg-white px-5 py-4">
              <h2 className="text-md font-medium">Database</h2>
              <Segmented label="Database" value={database} options={DATABASES} onChange={setDatabase} />
            </section>
          </div>
        </div>
      </main>
      {run ? (
        <main ref={runRef} className="flex flex-1 flex-col [&_h1]:outline-none">
          <RunView
            kind="install"
            target={run.target}
            steps={run.steps}
            progress={run.progress}
            logs={run.logs}
            running={run.running}
            result={run.result}
            tookMs={run.tookMs}
            info={run.info}
            onCancel={importing ? undefined : () => abort.current?.abort()}
            onAgain={again}
            onHome={onHome}
          />
        </main>
      ) : (
        <ActionBar
          summary={
            <>
              <strong className="text-foreground font-semibold break-words">{count}</strong>
              {target && (
                <>
                  <Icon path={mdiArrowRight} className="text-primary size-[18px] shrink-0" aria-hidden="true" />
                  <span className="sr-only">to</span>
                  <strong className="text-foreground font-semibold break-words">{target.name}</strong>
                  <span className="text-muted-foreground">{`· ${database}`}</span>
                </>
              )}
            </>
          }
        >
          <Button type="button" variant="outline" className={BTN} onClick={onHome}>
            Back
          </Button>
          <Button type="button" className={BTN} disabled={!canStart} onClick={() => void start()}>
            Install package
          </Button>
        </ActionBar>
      )}
    </div>
  );
}
