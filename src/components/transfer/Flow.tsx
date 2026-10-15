import { CompareView } from '@/components/transfer/CompareView';
import { ContentTree } from '@/components/transfer/ContentTree';
import { backupName, download, localDate } from '@/components/transfer/download';
import { EnvironmentCards } from '@/components/transfer/EnvironmentCards';
import { ActionBar, AppHeader, BTN, MAIN, PageHeading } from '@/components/transfer/Layout';
import { ReviewStep, needsProdConfirm } from '@/components/transfer/ReviewStep';
import { RunView } from '@/components/transfer/RunView';
import { Segmented } from '@/components/transfer/Segmented';
import { SelectionQueue } from '@/components/transfer/SelectionQueue';
import { Stepper } from '@/components/transfer/Stepper';
import { usePreflight } from '@/components/transfer/usePreflight';
import { useRun } from '@/components/transfer/useRun';
import { Button } from '@/components/ui/button';
import { Icon } from '@/lib/icon';
import { mergeTrees, newTree } from '@/lib/queue';
import type { Env, SdkClient } from '@/lib/sdk';
import { readPackage } from '@/lib/package';
import { DATABASE, IMPORT_STEP, backupTreesFor, runExport, runImport, runTransfer, type DataTree, type MergeStrategy, type Scope } from '@/lib/transfer';
import { mdiArrowRight, mdiSwapHorizontal } from '@mdi/js';
import { useEffect, useRef, useState, type ReactNode } from 'react';

type Mode = 'transfer' | 'export';
type Props = { client: SdkClient; mode: Mode; envs: Env[]; onHome(): void };

const PUBLISH_STEP = 'Publish to Experience Edge';

const stepLabels = (mode: Mode, source: Env, target: Env | undefined, backup = false, publish = false) =>
  mode === 'transfer'
    ? [
        ...(backup ? [`Back up ${target!.name}`] : []),
        `Create job on ${source.name}`,
        'Package content',
        `Copy chunks to ${target!.name}`,
        `Assemble package on ${target!.name}`,
        `Import into ${DATABASE}`,
        'Verify',
        ...(publish ? [PUBLISH_STEP] : []),
      ]
    : [`Create job on ${source.name}`, 'Package content', 'Download & zip'];

/** The transfer and export flow: Route ▸ Content ▸ Review ▸ Run. Owns the route, the queue and the run. */
export function Flow({ client, mode, envs, onHome }: Props) {
  const transfer = mode === 'transfer';
  const [step, setStep] = useState(0);
  const [sourceId, setSourceId] = useState<string | undefined>(envs[0]?.id);
  const [targetId, setTargetId] = useState<string | undefined>(envs[1]?.id);
  const [trees, setTrees] = useState<DataTree[]>([]);
  // The Content step's left panel (transfer only): the tree, or a comparison with the target, opened on first use and
  // kept while switching.
  const [view, setView] = useState<'browse' | 'compare'>('browse');
  const [compared, setCompared] = useState(false);
  // The target id the production box was ticked for: another target, or a fresh visit to Review, needs it ticked again.
  const [prodFor, setProdFor] = useState<string | null>(null);
  // `run` is null unless on the run step.
  const runner = useRun();
  const { run, running } = runner;
  // The export's package, kept for Download package.
  const [zip, setZip] = useState<{ blob: Blob; name: string }>();
  // "Back up <target> first" (on by default), the backup the current run made, and whether that run has a backup step.
  const [backupOn, setBackupOn] = useState(true);
  const [backupZip, setBackupZip] = useState<{ blob: Blob; name: string }>();
  const [withBackup, setWithBackup] = useState(false);
  // Whether the current run is a restore of that backup rather than the transfer itself.
  const [restoring, setRestoring] = useState(false);
  // "Publish to Experience Edge when done" (off by default), and whether the current transfer publishes: a restore then
  // publishes too, so the live site goes back as well.
  const [publishOn, setPublishOn] = useState(false);
  const [withPublish, setWithPublish] = useState(false);

  // An id that is no longer in `envs` (e.g. after a Retry) counts as unselected.
  const source = envs.find((e) => e.id === sourceId);
  const target = transfer ? envs.find((e) => e.id === targetId && e.id !== sourceId) : undefined;
  const routeOk = !!source && (!transfer || !!target);
  const prodChecked = !!target && prodFor === target.id;
  // Lost the route on a later step (an environment vanished): back to Route, so re-picking a card doesn't
  // jump ahead to the remembered step. Render-phase reset; this pass still shows Route.
  if (!run && !routeOk && step) setStep(0);
  const current = run ? 3 : routeOk ? step : 0;
  // Checks the target while on Review (transfer only); changing the list there re-checks it.
  const preflight = usePreflight(client, transfer && current === 2 ? source : undefined, target, trees);
  // Without a finished check (still checking, or it failed), every row that can overwrite is backed up.
  const backupTrees = transfer ? backupTreesFor(trees, preflight?.status === 'done' ? preflight.checks : undefined) : [];

  // Moving to another step puts focus on its heading. Not on first mount, and not into the run: useRun focuses its own.
  const page = useRef<HTMLDivElement>(null);
  const shown = useRef(current);
  useEffect(() => {
    if (shown.current === current) return;
    shown.current = current;
    if (!run) page.current?.querySelector<HTMLElement>('main h1')?.focus();
  }, [current, run]);

  const go = (i: number) => {
    runner.reset();
    setRestoring(false);
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

  const start = () => {
    if (!canStart) return;
    const src = source!;
    const backup = transfer && backupOn ? backupTrees : [];
    setZip(undefined);
    setBackupZip(undefined);
    setWithBackup(backup.length > 0);
    setRestoring(false);
    const publish = transfer && publishOn;
    setWithPublish(publish);
    void runner.start({ labels: stepLabels(mode, src, target, backup.length > 0, publish), source: src, target }, async (cb, signal) => {
      if (transfer) {
        const onBackup = (blob: Blob) => {
          const pkg = { blob, name: backupName(target!.name) };
          setBackupZip(pkg);
          download(pkg.blob, pkg.name);
        };
        return runTransfer(client, { source: src, target: target!, database: DATABASE, dataTrees: trees, backup, publish }, { ...cb, onBackup }, signal);
      }
      const blob = await runExport(client, { source: src, dataTrees: trees }, cb, signal);
      if (!blob) return false;
      const pkg = { blob, name: `contentTransfer-${src.name}-${localDate()}.zip` };
      setZip(pkg);
      download(pkg.blob, pkg.name);
      return true;
    });
  };

  const count = `${trees.length} ${trees.length === 1 ? 'item' : 'items'}`;
  const pair = transfer ? `${source?.name} → ${target?.name}` : (source?.name ?? '');
  const routeText = transfer ? `${pair} · ${DATABASE}` : pair;
  const steps = [
    { label: 'Route', hint: routeOk ? routeText : transfer ? 'Source and target' : 'Source' },
    { label: 'Content', hint: count },
    { label: 'Review', hint: "Confirm what's written" },
    { label: transfer ? 'Transfer' : 'Export', hint: 'Live progress' },
  ];

  let body: ReactNode;
  let footer: ReactNode = null;
  if (run) {
    // Export has no import phase; a transfer can be cancelled until the target starts importing.
    // From this step on the target may be importing: Cancel goes, and a failed run may have changed the target.
    const importStep = restoring ? IMPORT_STEP.import : IMPORT_STEP.transfer + (withBackup ? 1 : 0);
    const cancellable = !transfer || runner.canCancelUntil(importStep);
    const changed = run.result === 'success' || (run.result === 'fail' && !runner.canCancelUntil(importStep));
    // Installs the backup into the target the transfer wrote to, as a fresh run.
    const restore = () => {
      const pkg = backupZip!;
      const tgt = run.target!;
      runner.reset();
      setRestoring(true);
      const labels = [`Upload backup to ${tgt.name}`, `Assemble package on ${tgt.name}`, `Import into ${DATABASE}`, 'Verify', ...(withPublish ? [PUBLISH_STEP] : [])];
      void runner.start({ labels, target: tgt }, async (cb, signal) => {
        const { parts, items } = await readPackage(new File([pkg.blob], pkg.name));
        // The transfer was published: publish what the backup puts back, so the live site goes back too.
        const publish = withPublish
          ? items.map((i): DataTree => ({ itemPath: i.path, scope: i.scope as Scope, mergeStrategy: i.mergeStrategy as MergeStrategy }))
          : undefined;
        return runImport(client, { target: tgt, database: DATABASE, parts, publish }, cb, signal);
      });
    };
    body = (
      <div ref={runner.headingRef} className="flex flex-1 flex-col [&_h1]:outline-none">
        <RunView
          kind={restoring ? 'restore' : mode}
          source={run.source}
          target={run.target}
          steps={run.steps}
          progress={run.progress}
          logs={run.logs}
          running={run.running}
          result={run.result}
          tookMs={run.tookMs}
          info={run.info}
          onCancel={cancellable ? runner.cancel : undefined}
          onAgain={() => {
            const failed = run.result === 'fail';
            if (restoring && failed) return restore();
            if (!failed) setTrees([]);
            go(failed ? 2 : 0);
          }}
          onHome={onHome}
          onDownload={zip ? () => download(zip.blob, zip.name) : undefined}
          onDownloadBackup={backupZip ? () => download(backupZip.blob, backupZip.name) : undefined}
          onRestore={backupZip && !restoring && changed ? restore : undefined}
        />
      </div>
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
                <span className="text-muted-foreground">{`· ${DATABASE}`}</span>
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
            <div className="flex min-w-0 flex-[1_1_400px] flex-col gap-3">
              {transfer && (
                <Segmented
                  label="Pick items by"
                  value={view}
                  options={[
                    { value: 'browse', label: 'Browse' },
                    { value: 'compare', label: `Compare with ${target!.name}` },
                  ]}
                  onChange={(v) => {
                    setView(v as 'browse' | 'compare');
                    if (v === 'compare') setCompared(true);
                  }}
                />
              )}
              <div hidden={view !== 'browse'} className={view === 'browse' ? 'flex flex-col' : undefined}>
                <ContentTree
                  client={client}
                  env={source!}
                  title={`Browse ${source!.name}`}
                  selectedPaths={trees.map((t) => t.itemPath)}
                  onToggle={toggle}
                />
              </div>
              {transfer && compared && (
                <div hidden={view !== 'compare'} className={view === 'compare' ? 'flex flex-col' : undefined}>
                  <CompareView
                    // Another route is another comparison.
                    key={`${source!.id}>${target!.id}`}
                    client={client}
                    source={source!}
                    target={target!}
                    initialPath={trees[0]?.itemPath}
                    onAdd={(rows) => setTrees((t) => mergeTrees(t, rows))}
                  />
                </div>
              )}
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
            database={DATABASE}
            trees={trees}
            prodChecked={prodChecked}
            onProdChecked={(v) => setProdFor(v ? target!.id : null)}
            onEdit={() => go(1)}
            preflight={preflight}
            onTreesChange={setTrees}
            backup={transfer ? { available: backupTrees.length > 0, checked: backupOn, onChange: setBackupOn } : undefined}
            publish={transfer ? { checked: publishOn, onChange: setPublishOn } : undefined}
          />
        </main>
      );
      footer = (
        <ActionBar summary={summary}>
          <Button type="button" variant="outline" className={BTN} onClick={() => go(1)}>
            Back
          </Button>
          <Button type="button" className={BTN} disabled={!canStart} onClick={start}>
            <Icon path={mdiArrowRight} aria-hidden="true" />
            {transfer ? 'Start transfer' : 'Create package'}
          </Button>
        </ActionBar>
      );
    }
  }

  return (
    <div ref={page} className="bg-muted flex min-h-screen flex-col">
      {/* No way out through the header while running (leaving would abort the run), and no Cancel or step links
          once a run exists: RunView's own buttons lead on. */}
      <AppHeader crumb={transfer ? 'New transfer' : 'New export'} onHome={running ? undefined : onHome} onCancel={run ? undefined : onHome} />
      <Stepper steps={steps} current={current} locked={!!run} onGo={go} />
      {body}
      {footer}
    </div>
  );
}
