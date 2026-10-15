import { ContentTree } from '@/components/transfer/ContentTree';
import { EnvironmentBar, type Mode } from '@/components/transfer/EnvironmentBar';
import { ImportPanel, type LoadedPackage } from '@/components/transfer/ImportPanel';
import { RunPanel, type LogLine } from '@/components/transfer/RunPanel';
import { SelectionQueue } from '@/components/transfer/SelectionQueue';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MERGES, mergeTrees, newTree } from '@/lib/queue';
import type { Env, SdkClient } from '@/lib/sdk';
import {
  EXPORT_STEPS,
  IMPORT_STEPS,
  TRANSFER_STEPS,
  runExport,
  runImport,
  runTransfer,
  type DataTree,
  type RunCallbacks,
  type StepStatus,
} from '@/lib/transfer';
import { useEnvironments } from '@/utils/hooks/useEnvironments';
import { useEffect, useRef, useState } from 'react';

const ONE_ENV = 'Grant this app access to another environment in Cloud Portal to transfer between environments.';

const MODES: Record<Mode, { tab: string; action: string; steps: string[] }> = {
  transfer: { tab: 'Transfer', action: 'Start transfer', steps: TRANSFER_STEPS },
  export: { tab: 'Export', action: 'Export package', steps: EXPORT_STEPS },
  import: { tab: 'Import', action: 'Import package', steps: IMPORT_STEPS },
};

/** Why `mode` can't start yet, or null when it can. */
export function blockReason(
  mode: Mode,
  s: { envs: Env[]; source?: Env; target?: Env; trees: DataTree[]; hasPackage: boolean },
): string | null {
  if (mode === 'transfer' && s.envs.length < 2) return ONE_ENV;
  if ((mode !== 'import' && !s.source) || (mode !== 'export' && !s.target)) return 'Choose an environment.';
  if (mode === 'transfer' && s.source!.id === s.target!.id) return 'Source and target must be different environments.';
  if (mode !== 'import' && s.trees.length === 0) return 'Add at least one item to the queue.';
  if (mode === 'import' && !s.hasPackage) return 'Choose a package to import.';
  return null;
}

type Run = {
  steps: { label: string; status: StepStatus }[];
  progress: number;
  logs: LogLine[];
  running: boolean;
  result: 'success' | 'fail' | null;
};

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const localDate = (d = new Date()) =>
  [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, '0')).join('-');

type Props = { client: SdkClient | null; compact?: boolean; initialItemPath?: string };

export function Workspace({ client, compact, initialItemPath }: Props) {
  const { envs, loading, error, retry } = useEnvironments(client);
  const [mode, setMode] = useState<Mode>('transfer');
  const [sourceId, setSourceId] = useState<string>();
  const [targetId, setTargetId] = useState<string>();
  const [database, setDatabase] = useState('master');
  const [trees, setTrees] = useState<DataTree[]>([]);
  const [pkg, setPkg] = useState<LoadedPackage | null>(null);
  const [confirming, setConfirming] = useState(false);
  // Null until a run starts; keeps the result until the panel is closed.
  const [run, setRun] = useState<Run | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => setTrees(initialItemPath ? [newTree(initialItemPath)] : []), [initialItemPath]);
  // Leaving the page stops the run (the engine still cleans up).
  useEffect(() => () => abort.current?.abort(), []);

  const source = envs.find((e) => e.id === sourceId) ?? envs[0];
  const target = envs.find((e) => e.id === targetId) ?? envs[1];
  const running = !!run?.running;
  const settled = !loading && !error;
  const reason = blockReason(mode, { envs, source, target, trees, hasPackage: !!pkg });
  const prod = mode !== 'export' && !!target && /prod/i.test(target.name);
  const { tab, action, steps } = MODES[mode];

  const count = `${trees.length} item ${trees.length === 1 ? 'tree' : 'trees'}`;
  const merges = [...new Set(trees.map((t) => MERGES.find((m) => m.value === t.mergeStrategy)?.label ?? t.mergeStrategy))];
  const summary = {
    transfer: `Copy ${count} from ${source?.name} → ${target?.name} (${database}). Merge: ${merges.join(', ')}.`,
    export: `Export ${count} from ${source?.name}.`,
    import: `Import ${pkg?.fileName} into ${target?.name} (${database}).`,
  }[mode];

  const toggle = (path: string, checked: boolean) =>
    setTrees((t) => (checked ? mergeTrees(t, [newTree(path)]) : t.filter((x) => x.itemPath !== path)));

  const start = async () => {
    if (!client || reason || running) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setRun({ steps: steps.map((label) => ({ label, status: 'pending' })), progress: 0, logs: [], running: true, result: null });
    const update = (patch: (r: Run) => Partial<Run>) => setRun((r) => r && { ...r, ...patch(r) });
    const cb: RunCallbacks = {
      onLog: (text, type) => update((r) => ({ logs: [...r.logs, { text, type, time: new Date().toLocaleTimeString() }] })),
      onProgress: (progress) => update(() => ({ progress })),
      onStepChange: (i, status) => update((r) => ({ steps: r.steps.map((s, j) => (j === i ? { ...s, status } : s)) })),
    };
    // blockReason guarantees the environments (and the package) this mode needs.
    let ok = false;
    try {
      if (mode === 'transfer') {
        ok = await runTransfer(client, { source: source!, target: target!, database, dataTrees: trees }, cb, ctrl.signal);
      } else if (mode === 'export') {
        const zip = await runExport(client, { source: source!, dataTrees: trees }, cb, ctrl.signal);
        if (zip) download(zip, `contentTransfer-${source!.name}-${localDate()}.zip`);
        ok = !!zip;
      } else {
        ok = await runImport(client, { target: target!, database, parts: pkg!.parts }, cb, ctrl.signal);
      }
    } catch (e) {
      cb.onLog(e instanceof Error ? e.message : String(e), 'error');
    }
    update(() => ({ running: false, result: ok ? 'success' : 'fail' }));
  };

  const queue = <SelectionQueue trees={trees} onChange={setTrees} disabled={running} />;

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">Content Transfer</h1>
        {!compact && (
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList aria-label="Mode">
              {(Object.keys(MODES) as Mode[]).map((m) => (
                <TabsTrigger key={m} value={m}>
                  {MODES[m].tab}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
      </header>

      {loading ? (
        <div role="status" aria-label="Loading environments" className="flex flex-wrap gap-3">
          <Skeleton className="h-15 w-56" />
          <Skeleton className="h-15 w-56" />
        </div>
      ) : error ? (
        <Alert variant="danger">
          <AlertTitle>Couldn&apos;t load environments</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-x-2">
            <span className="min-w-0 break-words">{error}</span>
            <Button type="button" variant="link" size="xs" onClick={retry}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <EnvironmentBar
          mode={mode}
          envs={envs}
          sourceId={source?.id}
          targetId={target?.id}
          database={database}
          disabled={running}
          onSourceChange={setSourceId}
          onTargetChange={setTargetId}
          onDatabaseChange={setDatabase}
          onSwap={() => {
            setSourceId(target?.id);
            setTargetId(source?.id);
          }}
        />
      )}

      {settled && (envs.length === 0 || reason === ONE_ENV) && (
        <Alert>
          <AlertDescription>{ONE_ENV}</AlertDescription>
        </Alert>
      )}

      {compact ? (
        queue
      ) : (
        <>
          {/* Both bodies stay mounted so switching tabs keeps the tree's expansion and the chosen package. */}
          <div hidden={mode === 'import'} className="grid gap-6 lg:grid-cols-2">
            <div>
              {client && source && (
                <ContentTree
                  client={client}
                  env={source}
                  selectedPaths={trees.map((t) => t.itemPath)}
                  onToggle={toggle}
                />
              )}
            </div>
            {queue}
          </div>
          <div hidden={mode !== 'import'}>
            <ImportPanel disabled={running} onPackage={setPkg} />
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        {settled && reason && reason !== ONE_ENV && <p className="text-muted-foreground mr-auto text-sm">{reason}</p>}
        <Button type="button" disabled={!!reason || running} onClick={() => setConfirming(true)}>
          {compact ? `Send to ${target?.name ?? 'target'}` : action}
        </Button>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{`${action}?`}</AlertDialogTitle>
            <AlertDialogDescription>{summary}</AlertDialogDescription>
          </AlertDialogHeader>
          {prod && (
            <Alert variant="danger">
              <AlertDescription>{`${target!.name} looks like a production environment. Double-check before continuing.`}</AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction colorScheme={prod ? 'danger' : 'primary'} onClick={() => void start()}>
              Start
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {run && (
        <RunPanel
          open
          compact={compact}
          title={tab}
          steps={run.steps}
          progress={run.progress}
          logs={run.logs}
          running={run.running}
          result={run.result}
          onCancel={() => abort.current?.abort()}
          onClose={() => setRun(null)}
          onRunAgain={() => {
            setRun(null);
            setConfirming(true);
          }}
        />
      )}
    </div>
  );
}
