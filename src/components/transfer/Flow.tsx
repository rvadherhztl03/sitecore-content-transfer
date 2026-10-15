import { ContentTree } from '@/components/transfer/ContentTree';
import { EnvironmentCards } from '@/components/transfer/EnvironmentCards';
import { ActionBar, AppHeader, PageHeading } from '@/components/transfer/Layout';
import { ReviewStep, needsProdConfirm } from '@/components/transfer/ReviewStep';
import { RunView, type LogLine } from '@/components/transfer/RunView';
import { Segmented } from '@/components/transfer/Segmented';
import { SelectionQueue } from '@/components/transfer/SelectionQueue';
import { Stepper } from '@/components/transfer/Stepper';
import { Button } from '@/components/ui/button';
import { Icon } from '@/lib/icon';
import { mergeTrees, newTree } from '@/lib/queue';
import type { Env, SdkClient } from '@/lib/sdk';
import { IMPORT_STEP, runExport, runTransfer, type DataTree, type RunCallbacks, type StepStatus } from '@/lib/transfer';
import { mdiArrowRight, mdiSwapHorizontal } from '@mdi/js';
import { useEffect, useRef, useState, type ReactNode } from 'react';

type Mode = 'transfer' | 'export';
type Props = { client: SdkClient; mode: Mode; envs: Env[]; onHome(): void };

type Run = {
  // The route as started: what the run writes and what RunView names, even if `envs` changes meanwhile.
  source: Env;
  target?: Env;
  steps: { label: string; status: StepStatus; ms?: number }[];
  progress: number;
  logs: LogLine[];
  running: boolean;
  result: 'success' | 'fail' | null;
  tookMs?: number;
  info?: { chunkCount: number; itemCount: number };
  zip?: { blob: Blob; name: string };
};

const DATABASES = [
  { value: 'master', label: 'master' },
  { value: 'web', label: 'web' },
];
const BTN = 'h-11 rounded-[10px] px-5';
const MAIN = 'mx-auto flex w-full max-w-[1120px] flex-1 flex-col gap-6 px-4 pt-7 pb-10 sm:px-8';

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking right after click() can drop the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const localDate = (d = new Date()) =>
  [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, '0')).join('-');

const stepLabels = (mode: Mode, source: Env, target: Env | undefined, database: string) =>
  mode === 'transfer'
    ? [`Create job on ${source.name}`, 'Package content', `Copy chunks to ${target!.name}`, `Assemble package on ${target!.name}`, `Import into ${database}`, 'Verify']
    : [`Create job on ${source.name}`, 'Package content', 'Download & zip'];

/** The transfer and export flow: Route ▸ Content ▸ Review ▸ Run. Owns the route, the queue and the run. */
export function Flow({ client, mode, envs, onHome }: Props) {
  const transfer = mode === 'transfer';
  const [step, setStep] = useState(0);
  const [sourceId, setSourceId] = useState<string | undefined>(envs[0]?.id);
  const [targetId, setTargetId] = useState<string | undefined>(envs[1]?.id);
  const [database, setDatabase] = useState('master');
  const [trees, setTrees] = useState<DataTree[]>([]);
  // The target id the production box was ticked for: another target, or a fresh visit to Review, needs it ticked again.
  const [prodFor, setProdFor] = useState<string | null>(null);
  // Null unless on the run step; a run starts as running, so RunView never sees running=false with no result.
  const [run, setRun] = useState<Run | null>(null);
  // Non-null while a run is in progress: blocks a second start, and leaving the flow aborts it.
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  // An id that is no longer in `envs` (e.g. after a Retry) counts as unselected.
  const source = envs.find((e) => e.id === sourceId);
  const target = transfer ? envs.find((e) => e.id === targetId && e.id !== sourceId) : undefined;
  const routeOk = !!source && (!transfer || !!target);
  const prodChecked = !!target && prodFor === target.id;
  const running = !!run?.running;
  // Lost the route on a later step (an environment vanished): show Route again.
  const current = run ? 3 : routeOk ? step : 0;

  // Announce completion or failure: move focus to the run heading.
  const runRef = useRef<HTMLElement>(null);
  const result = run?.result;
  useEffect(() => {
    const h = result && runRef.current?.querySelector('h1');
    if (!h) return;
    h.tabIndex = -1;
    h.focus();
  }, [result]);

  const go = (i: number) => {
    setRun(null);
    setProdFor(null);
    setStep(i);
  };
  const changeSource = (id?: string) => {
    if (id === sourceId) return;
    setSourceId(id);
    // The queued paths may not exist on another source.
    setTrees([]);
  };
  const swap = () => {
    changeSource(targetId);
    setTargetId(sourceId);
  };
  const toggle = (path: string, checked: boolean) =>
    setTrees((t) => (checked ? mergeTrees(t, [newTree(path)]) : t.filter((x) => x.itemPath !== path)));

  const canStart = routeOk && trees.length > 0 && !(transfer && needsProdConfirm(target) && !prodChecked);

  const start = async () => {
    if (abort.current || !canStart) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    const began = Date.now();
    const stepStart: number[] = [];
    const src = source!;
    setRun({
      source: src,
      target,
      steps: stepLabels(mode, src, target, database).map((label) => ({ label, status: 'pending' })),
      progress: 0,
      logs: [],
      running: true,
      result: null,
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
      onInfo: (info) => update(() => ({ info })),
    };
    let ok = false;
    let zip: Run['zip'];
    try {
      if (transfer) {
        ok = await runTransfer(client, { source: src, target: target!, database, dataTrees: trees }, cb, ctrl.signal);
      } else {
        const blob = await runExport(client, { source: src, dataTrees: trees }, cb, ctrl.signal);
        if (blob) {
          zip = { blob, name: `contentTransfer-${src.name}-${localDate()}.zip` };
          download(zip.blob, zip.name);
          ok = true;
        }
      }
    } catch (e) {
      cb.onLog(e instanceof Error ? e.message : String(e), 'error');
    }
    abort.current = null;
    update(() => ({ running: false, result: ok ? 'success' : 'fail', tookMs: Date.now() - began, zip }));
  };

  const count = `${trees.length} ${trees.length === 1 ? 'item' : 'items'}`;
  const pair = transfer ? `${source?.name} → ${target?.name}` : (source?.name ?? '');
  const routeText = transfer ? `${pair} · ${database}` : pair;
  const steps = [
    { label: 'Route', hint: routeOk ? routeText : transfer ? 'Source and target' : 'Source' },
    { label: 'Content', hint: count },
    { label: 'Review', hint: "Confirm what's written" },
    { label: transfer ? 'Transfer' : 'Export', hint: 'Live progress' },
  ];

  let body: ReactNode;
  let footer: ReactNode = null;
  if (run) {
    // Cancel is offered until the target starts importing; after that it finishes on its own.
    const importing = transfer && ['running', 'done'].includes(run.steps[IMPORT_STEP.transfer]?.status);
    body = (
      <main ref={runRef} className="flex flex-1 flex-col [&_h1]:outline-none">
        <RunView
          kind={mode}
          source={run.source}
          target={run.target}
          steps={run.steps}
          progress={run.progress}
          logs={run.logs}
          running={run.running}
          result={run.result}
          tookMs={run.tookMs}
          info={run.info}
          onCancel={importing ? undefined : () => abort.current?.abort()}
          onAgain={() => {
            const failed = run.result === 'fail';
            if (!failed) setTrees([]);
            go(failed ? 2 : 0);
          }}
          onHome={onHome}
          onDownload={run.zip ? () => download(run.zip!.blob, run.zip!.name) : undefined}
        />
      </main>
    );
  } else if (current === 0) {
    body = (
      <main className={MAIN}>
        {transfer ? (
          <PageHeading title="Where is the content going?" sub="Pick the environment to copy from and the one to copy into." />
        ) : (
          <PageHeading title="Where is the content coming from?" sub="Pick the environment to package content from." />
        )}
        <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr]">
          <EnvironmentCards
            legend="From"
            name="source"
            envs={envs}
            value={source?.id}
            disabledId={target?.id}
            disabledReason="Already the target"
            onChange={changeSource}
          />
          {transfer && (
            <>
              <div className="flex items-center justify-center">
                <button
                  type="button"
                  aria-label="Swap source and target"
                  onClick={swap}
                  className="focus-visible:ring-primary/50 hover:bg-neutral-bg grid size-12 cursor-pointer place-items-center rounded-full border bg-white shadow-[0_2px_8px_rgba(20,20,40,0.06)] outline-none focus-visible:ring-[3px]"
                >
                  <Icon path={mdiSwapHorizontal} className="text-primary-600 size-[22px] rotate-90 md:rotate-0" aria-hidden="true" />
                </button>
              </div>
              <EnvironmentCards
                legend="To"
                name="target"
                envs={envs}
                value={target?.id}
                disabledId={source?.id}
                disabledReason="Already the source"
                onChange={(id) => setTargetId(id)}
              />
            </>
          )}
        </div>
        {transfer && (
          <section className="flex flex-wrap items-center justify-between gap-4 rounded-[14px] border bg-white px-5 py-[18px]">
            <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-0.5">
              <h2 className="text-[15px] font-semibold">Write into database</h2>
              <p className="text-muted-foreground text-sm">Items are read from master on the source and written to this database on the target.</p>
            </div>
            <Segmented label="Write into database" value={database} options={DATABASES} onChange={setDatabase} />
          </section>
        )}
      </main>
    );
    footer = (
      <ActionBar
        summary={
          <>
            {source && <strong className="text-foreground font-semibold break-words">{source.name}</strong>}
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
        <Button type="button" className={BTN} disabled={!routeOk} onClick={() => go(1)}>
          Continue
        </Button>
      </ActionBar>
    );
  } else {
    const summary = (
      <span className="break-words">
        <strong className="text-foreground font-semibold">{count}</strong>
        {` · ${current === 2 ? routeText : pair}`}
      </span>
    );
    if (current === 1) {
      body = (
        <main className={MAIN}>
          <PageHeading title="What should be copied?" sub={`Tick items in ${source!.name}, or paste a path. Each item can bring everything under it.`} />
          <div className="flex flex-wrap items-start gap-5">
            <div className="flex min-w-0 flex-[1_1_400px] flex-col">
              <ContentTree
                client={client}
                env={source!}
                title={`Browse ${source!.name}`}
                selectedPaths={trees.map((t) => t.itemPath)}
                onToggle={toggle}
              />
            </div>
            <div className="flex min-w-0 flex-[1_1_440px] flex-col">
              <SelectionQueue trees={trees} onChange={setTrees} />
            </div>
          </div>
        </main>
      );
      footer = (
        <ActionBar summary={summary}>
          <Button type="button" variant="outline" className={BTN} onClick={() => go(0)}>
            Back
          </Button>
          <Button type="button" className={BTN} disabled={trees.length === 0} onClick={() => go(2)}>
            {transfer ? 'Review transfer' : 'Review export'}
          </Button>
        </ActionBar>
      );
    } else {
      body = (
        <main className={MAIN}>
          <ReviewStep
            mode={mode}
            source={source!}
            target={target}
            database={database}
            trees={trees}
            prodChecked={prodChecked}
            onProdChecked={(v) => setProdFor(v ? target!.id : null)}
            onEdit={() => go(1)}
          />
        </main>
      );
      footer = (
        <ActionBar summary={summary}>
          <Button type="button" variant="outline" className={BTN} onClick={() => go(1)}>
            Back
          </Button>
          <Button type="button" className={BTN} disabled={!canStart} onClick={() => void start()}>
            <Icon path={mdiArrowRight} aria-hidden="true" />
            {transfer ? 'Start transfer' : 'Create package'}
          </Button>
        </ActionBar>
      );
    }
  }

  return (
    <div className="bg-muted flex min-h-screen flex-col">
      <AppHeader crumb={transfer ? 'New transfer' : 'New export'} onHome={onHome} onCancel={running ? undefined : onHome} />
      <Stepper steps={steps} current={current} locked={running} onGo={go} />
      {body}
      {footer}
    </div>
  );
}
