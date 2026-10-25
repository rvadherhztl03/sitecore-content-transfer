import { EnvironmentCards } from '@/components/transfer/EnvironmentCards';
import { ImportPanel, type LoadedPackage } from '@/components/transfer/ImportPanel';
import { ActionBar, AppHeader, BTN, MAIN, PageHeading } from '@/components/transfer/Layout';
import { ProdConfirm, needsProdConfirm } from '@/components/transfer/ReviewStep';
import { RunView } from '@/components/transfer/RunView';
import { useRun } from '@/components/transfer/useRun';
import { Button } from '@/components/ui/button';
import { Icon } from '@/lib/icon';
import type { Env, SdkClient } from '@/lib/sdk';
import { DATABASE, IMPORT_STEP, runImport } from '@/lib/transfer';
import { mdiArrowRight } from '@mdi/js';
import { useState } from 'react';

type Props = { client: SdkClient; envs: Env[]; onHome(): void };

/** Install a .zip or .raif package into a chosen environment: one screen, then the run. Owns the package, the target and the run. */
export function InstallFlow({ client, envs, onHome }: Props) {
  const [pkg, setPkg] = useState<LoadedPackage | null>(null);
  // Bumped to give ImportPanel a fresh, empty state; it owns what its file card shows.
  const [fresh, setFresh] = useState(0);
  const [targetId, setTargetId] = useState<string>();
  // The target id the production box was ticked for, cleared whenever the target changes.
  const [prodFor, setProdFor] = useState<string | null>(null);
  // `run` is null until Install package is clicked.
  const runner = useRun();
  const { run, running } = runner;

  // An id that is no longer in `envs` counts as unselected.
  const target = envs.find((e) => e.id === targetId);
  const prodChecked = !!target && prodFor === target.id;
  const canStart = !!pkg && !!target && !(needsProdConfirm(target) && !prodChecked);

  const pickTarget = (id: string) => {
    setTargetId(id);
    setProdFor(null);
  };

  const start = () => {
    if (!canStart) return;
    const tgt = target!;
    const { parts, items } = pkg!;
    void runner.start(
      {
        labels: ['Upload package', `Assemble package on ${tgt.name}`, `Import into ${DATABASE}`, 'Verify'],
        targets: [tgt],
        // A bare .raif has no item list, so there is no count to show.
        info: { chunkCount: parts.reduce((n, p) => n + p.chunks.length, 0), itemCount: items.length || undefined },
      },
      (cb, signal) => runImport(client, { target: tgt, database: DATABASE, parts }, cb, signal),
    );
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
    runner.reset();
  };

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
          </div>
        </div>
      </main>
      {run ? (
        <div ref={runner.headingRef} className="flex flex-1 flex-col [&_h1]:outline-none">
          <RunView
            kind="install"
            targets={run.targets}
            steps={run.steps}
            progress={run.progress}
            logs={run.logs}
            running={run.running}
            result={run.result}
            tookMs={run.tookMs}
            info={run.info}
            // Cancel is offered until the target starts importing; after that it finishes on its own.
            onCancel={runner.canCancelUntil(IMPORT_STEP.import) ? runner.cancel : undefined}
            onAgain={again}
            onHome={onHome}
          />
        </div>
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
                  <span className="text-muted-foreground">{`· ${DATABASE}`}</span>
                </>
              )}
            </>
          }
        >
          <Button type="button" variant="outline" className={BTN} onClick={onHome}>
            Back
          </Button>
          <Button type="button" className={BTN} disabled={!canStart} onClick={start}>
            Install package
          </Button>
        </ActionBar>
      )}
    </div>
  );
}
