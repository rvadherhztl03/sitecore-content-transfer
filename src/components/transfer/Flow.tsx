import { CompareView } from '@/components/transfer/CompareView';
import { ContentTree } from '@/components/transfer/ContentTree';
import { listOf } from '@/components/transfer/copy';
import { backupName, download, localDate } from '@/components/transfer/download';
import { EnvironmentCards } from '@/components/transfer/EnvironmentCards';
import { ActionBar, AppHeader, BTN, MAIN, PageHeading } from '@/components/transfer/Layout';
import { ReviewStep, needsProdConfirm } from '@/components/transfer/ReviewStep';
import { RunView } from '@/components/transfer/RunView';
import { Segmented } from '@/components/transfer/Segmented';
import { SelectionQueue } from '@/components/transfer/SelectionQueue';
import { Stepper } from '@/components/transfer/Stepper';
import { usePreflights } from '@/components/transfer/usePreflight';
import { useRun } from '@/components/transfer/useRun';
import { Button } from '@/components/ui/button';
import { Icon } from '@/lib/icon';
import { mergeTrees, newTree } from '@/lib/queue';
import type { Env, SdkClient } from '@/lib/sdk';
import { readPackage } from '@/lib/package';
import {
  DATABASE,
  IMPORT_STEP,
  backupTreesFor,
  runExport,
  runImport,
  runTransfer,
  transferSteps,
  type DataTree,
  type MergeStrategy,
  type Scope,
  type TransferTarget,
} from '@/lib/transfer';
import { mdiArrowRight, mdiSwapHorizontal } from '@mdi/js';
import { useEffect, useRef, useState, type ReactNode } from 'react';

type Mode = 'transfer' | 'export';
type Props = { client: SdkClient; mode: Mode; envs: Env[]; onHome(): void };

const PUBLISH_STEP = 'Publish to Experience Edge';

const exportSteps = (source: Env) => [`Create job on ${source.name}`, 'Package content', 'Download & zip'];

/** The transfer and export flow: Route ▸ Content ▸ Review ▸ Run. Owns the route, the queue and the run. */
export function Flow({ client, mode, envs, onHome }: Props) {
  const transfer = mode === 'transfer';
  const [step, setStep] = useState(0);
  const [sourceId, setSourceId] = useState<string | undefined>(envs[0]?.id);
  // The targets, in the order picked: a transfer writes to each in turn.
  const [targetIds, setTargetIds] = useState<string[]>(envs[1] ? [envs[1].id] : []);
  const [trees, setTrees] = useState<DataTree[]>([]);
  // The Content step's left panel (transfer only): the tree (`browse`), or a comparison with one target (its id), each
  // opened on first use and kept while switching.
  const [view, setView] = useState('browse');
  const [compared, setCompared] = useState<string[]>([]);
  // The production targets whose box is ticked: a fresh visit to Review needs them ticked again.
  const [prodFor, setProdFor] = useState<string[]>([]);
  // `run` is null unless on the run step.
  const runner = useRun();
  const { run, running } = runner;
  // The export's package, kept for Download package.
  const [zip, setZip] = useState<{ blob: Blob; name: string }>();
  // "Back up <targets> first" (on by default), the backups the current transfer made (in target order) and where its
  // steps sit (see transferSteps).
  const [backupOn, setBackupOn] = useState(true);
  const [backupZips, setBackupZips] = useState<{ target: Env; blob: Blob; name: string }[]>([]);
  const [layout, setLayout] = useState<{ firstImport: number; targetAt: number[] }>();
  // The target the current run restores, when it is a restore rather than the transfer, and the targets whose backups
  // can still be restored from there (the ones the transfer wrote to, less those restored since).
  const [restoringId, setRestoringId] = useState<string>();
  const [restorable, setRestorable] = useState<string[]>([]);
  // "Publish to Experience Edge when done" (off by default), and whether the current transfer publishes: a restore then
  // publishes too, so the live site goes back as well.
  const [publishOn, setPublishOn] = useState(false);
  const [withPublish, setWithPublish] = useState(false);

  // An id that is no longer in `envs` (e.g. after a Retry) counts as unselected, and so does a target that is the source.
  const source = envs.find((e) => e.id === sourceId);
  // In the order picked, but production last: a run that stops partway never leaves it ahead of the others.
  const targets = transfer
    ? targetIds.flatMap((id) => envs.filter((e) => e.id === id && e.id !== sourceId)).sort((a, b) => +needsProdConfirm(a) - +needsProdConfirm(b))
    : [];
  const routeOk = !!source && (!transfer || targets.length > 0);
  const prodOk = targets.every((t) => !needsProdConfirm(t) || prodFor.includes(t.id));
  const names = listOf(targets.map((t) => t.name));
  // A comparison with a target that's no longer picked falls back to the tree.
  const viewing = targets.some((t) => t.id === view) ? view : 'browse';
  // Lost the route on a later step (an environment vanished): back to Route, so re-picking a card doesn't
  // jump ahead to the remembered step. Render-phase reset; this pass still shows Route.
  if (!run && !routeOk && step) setStep(0);
  const current = run ? 3 : routeOk ? step : 0;
  // Checks every target while on Review (transfer only); changing the list there re-checks them.
  const preflights = usePreflights(client, transfer && current === 2 ? source : undefined, targets, trees);
  // What to back up on a target. Without its finished check (still checking, or it failed), every row that can overwrite.
  const backupTrees = (t: Env) => {
    const p = preflights?.[t.id];
    return backupTreesFor(trees, p?.status === 'done' ? p.checks : undefined);
  };
  const toBackUp = targets.filter((t) => backupTrees(t).length > 0);

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
    setRestoringId(undefined);
    setProdFor([]);
    setStep(i);
  };
  const changeSource = (id?: string) => {
    if (id === sourceId) return;
    setSourceId(id);
    // The queued paths may not exist on another source.
    setTrees([]);
  };
  // Only offered with one target.
  const swap = () => {
    changeSource(targets[0].id);
    setTargetIds(sourceId ? [sourceId] : []);
  };
  const toggle = (path: string, checked: boolean) =>
    setTrees((t) => (checked ? mergeTrees(t, [newTree(path)]) : t.filter((x) => x.itemPath !== path)));

  const canStart = routeOk && trees.length > 0 && prodOk;

  const start = () => {
    if (!canStart) return;
    const src = source!;
    setZip(undefined);
    setBackupZips([]);
    setRestoringId(undefined);
    setRestorable([]);
    if (!transfer) {
      void runner.start({ labels: exportSteps(src), source: src }, async (cb, signal) => {
        const blob = await runExport(client, { source: src, dataTrees: trees }, cb, signal);
        if (!blob) return false;
        const pkg = { blob, name: `contentTransfer-${src.name}-${localDate()}.zip` };
        setZip(pkg);
        download(pkg.blob, pkg.name);
        return true;
      });
      return;
    }
    const plan: TransferTarget[] = targets.map((env) => ({ env, backup: backupOn ? backupTrees(env) : [] }));
    const publish = publishOn;
    const steps = transferSteps(src, plan, publish);
    setLayout(steps);
    setWithPublish(publish);
    const onBackup = (blob: Blob, env: Env) => {
      const pkg = { target: env, blob, name: backupName(env.name) };
      setBackupZips((zips) => [...zips, pkg]);
      download(pkg.blob, pkg.name);
    };
    void runner.start({ labels: steps.labels, source: src, targets }, (cb, signal) =>
      runTransfer(client, { source: src, targets: plan, database: DATABASE, dataTrees: trees, publish }, { ...cb, onBackup }, signal),
    );
  };

  const count = `${trees.length} ${trees.length === 1 ? 'item' : 'items'}`;
  const pair = transfer ? `${source?.name} → ${names}` : (source?.name ?? '');
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
    const restoring = restoringId !== undefined;
    // Export has no import phase; a transfer can be cancelled until the first target starts importing.
    const importStep = restoring ? IMPORT_STEP.import : (layout?.firstImport ?? IMPORT_STEP.transfer);
    const cancellable = !transfer || runner.canCancelUntil(importStep);
    // Per target of the transfer: written to once its import started (a failed run may have changed it), finished once verified.
    const ran = restoring ? [] : (run.targets ?? []);
    const status = (k: number, offset: number) => run.steps[(layout?.targetAt[k] ?? 0) + offset]?.status ?? 'pending';
    const written = ran.filter((_, k) => status(k, 2) !== 'pending').map((t) => t.id);
    const finished = ran.filter((_, k) => status(k, 3) === 'done');
    // Installs a target's backup back into it, as a fresh run. The targets the transfer wrote to stay restorable from
    // there until their restore succeeds.
    const restore = (tgt: Env) => {
      const pkg = backupZips.find((b) => b.target.id === tgt.id)!;
      if (!restoring) setRestorable(written);
      runner.reset();
      setRestoringId(tgt.id);
      const labels = [`Upload backup to ${tgt.name}`, `Assemble package on ${tgt.name}`, `Import into ${DATABASE}`, 'Verify', ...(withPublish ? [PUBLISH_STEP] : [])];
      void runner.start({ labels, targets: [tgt] }, async (cb, signal) => {
        const { parts, items } = await readPackage(new File([pkg.blob], pkg.name));
        // The transfer was published: publish what the backup puts back, so the live site goes back too.
        const publish = withPublish
          ? items.map((i): DataTree => ({ itemPath: i.path, scope: i.scope as Scope, mergeStrategy: i.mergeStrategy as MergeStrategy }))
          : undefined;
        const ok = await runImport(client, { target: tgt, database: DATABASE, parts, publish }, cb, signal);
        if (ok) setRestorable((ids) => ids.filter((id) => id !== tgt.id));
        return ok;
      });
    };
    body = (
      <div ref={runner.headingRef} className="flex flex-1 flex-col [&_h1]:outline-none">
        <RunView
          kind={restoring ? 'restore' : mode}
          source={run.source}
          targets={run.targets}
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
            if (restoring && failed) return restore(run.targets![0]);
            if (!failed) setTrees([]);
            // The targets that got the content before the failure aren't sent it again (nor backed up over their backup).
            else if (finished.length) setTargetIds((ids) => ids.filter((id) => !finished.some((t) => t.id === id)));
            go(failed ? 2 : 0);
          }}
          onHome={onHome}
          onDownload={zip ? () => download(zip.blob, zip.name) : undefined}
          backups={backupZips.map((b) => ({
            target: b.target,
            onDownload: () => download(b.blob, b.name),
            // The target being restored has Try again instead.
            onRestore: (restoring ? restorable.filter((id) => id !== restoringId) : written).includes(b.target.id) ? () => restore(b.target) : undefined,
          }))}
          finished={ran.length > 1 ? finished : undefined}
        />
      </div>
    );
  } else if (current === 0) {
    body = (
      <main className={MAIN}>
        {transfer ? (
          <PageHeading title="Where is the content going?" sub="Pick the environment to copy from and one or more to copy into." />
        ) : (
          <PageHeading title="Where is the content coming from?" sub="Pick the environment to package content from." />
        )}
        <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr]">
          <EnvironmentCards
            legend="From"
            name="source"
            envs={envs}
            value={source?.id}
            disabledIds={targets.map((t) => t.id)}
            disabledReason={targets.length > 1 ? 'Already a target' : 'Already the target'}
            onChange={changeSource}
          />
          {transfer && (
            <>
              <div className="flex items-center justify-center">
                {targets.length === 1 ? (
                  <button
                    type="button"
                    aria-label="Swap source and target"
                    onClick={swap}
                    className="focus-visible:ring-primary/50 hover:bg-neutral-bg grid size-12 cursor-pointer place-items-center rounded-full border bg-white shadow-[0_2px_8px_rgba(20,20,40,0.06)] outline-none focus-visible:ring-[3px]"
                  >
                    <Icon path={mdiSwapHorizontal} className="text-primary-600 size-[22px] rotate-90 md:rotate-0" aria-hidden="true" />
                  </button>
                ) : (
                  <Icon path={mdiArrowRight} className="text-primary size-[22px] rotate-90 md:rotate-0" aria-hidden="true" />
                )}
              </div>
              <EnvironmentCards
                multiple
                legend="To"
                name="target"
                envs={envs}
                value={targets.map((t) => t.id)}
                disabledIds={source ? [source.id] : []}
                disabledReason="Already the source"
                onChange={setTargetIds}
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
            {targets.length > 0 && (
              <>
                <Icon path={mdiArrowRight} className="text-primary size-[18px] shrink-0" aria-hidden="true" />
                <span className="sr-only">to</span>
                <strong className="text-foreground font-semibold break-words">{names}</strong>
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
                  value={viewing}
                  options={[{ value: 'browse', label: 'Browse' }, ...targets.map((t) => ({ value: t.id, label: `Compare with ${t.name}` }))]}
                  onChange={(v) => {
                    setView(v);
                    if (v !== 'browse') setCompared((ids) => (ids.includes(v) ? ids : [...ids, v]));
                  }}
                />
              )}
              <div hidden={viewing !== 'browse'} className={viewing === 'browse' ? 'flex flex-col' : undefined}>
                <ContentTree
                  client={client}
                  env={source!}
                  title={`Browse ${source!.name}`}
                  selectedPaths={trees.map((t) => t.itemPath)}
                  onToggle={toggle}
                />
              </div>
              {targets
                .filter((t) => compared.includes(t.id))
                .map((t) => (
                  <div key={t.id} hidden={viewing !== t.id} className={viewing === t.id ? 'flex flex-col' : undefined}>
                    <CompareView
                      // Another source is another comparison.
                      key={source!.id}
                      client={client}
                      source={source!}
                      target={t}
                      initialPath={trees[0]?.itemPath}
                      onAdd={(rows) => setTrees((tr) => mergeTrees(tr, rows))}
                    />
                  </div>
                ))}
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
            targets={targets}
            database={DATABASE}
            trees={trees}
            prodChecked={prodFor}
            onProdChecked={(t, v) => setProdFor((ids) => (v ? [...ids, t.id] : ids.filter((id) => id !== t.id)))}
            onEdit={() => go(1)}
            preflights={preflights}
            onTreesChange={setTrees}
            backup={
              transfer
                ? { targets: toBackUp.length ? toBackUp : targets, available: toBackUp.length > 0, checked: backupOn, onChange: setBackupOn }
                : undefined
            }
            publish={transfer ? { checked: publishOn, onChange: setPublishOn } : undefined}
            client={client}
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
