import { ONE_ENV, cancelNote, treeWarning } from '@/components/transfer/copy';
import { EnvBadge } from '@/components/transfer/EnvironmentCards';
import { ChangesToggle, FieldDiff } from '@/components/transfer/FieldDiff';
import { Logo } from '@/components/transfer/Logo';
import { PreflightNotes, PreflightStatus } from '@/components/transfer/Preflight';
import { backupName, download } from '@/components/transfer/download';
import { BackupChoice, ProdConfirm, PublishChoice, needsProdConfirm } from '@/components/transfer/ReviewStep';
import { RunView } from '@/components/transfer/RunView';
import { usePreflight } from '@/components/transfer/usePreflight';
import { useRun } from '@/components/transfer/useRun';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Icon } from '@/lib/icon';
import { readPackage } from '@/lib/package';
import { addMissingParents } from '@/lib/preflight';
import { addRelated } from '@/lib/related';
import { MERGES, labelOf, mergesFor, nameOf, withScope } from '@/lib/queue';
import type { Env, SdkClient } from '@/lib/sdk';
import { DATABASE, IMPORT_STEP, IMPORT_STEPS, TRANSFER_STEPS, backupTreesFor, runImport, runTransfer, type DataTree, type MergeStrategy, type Scope } from '@/lib/transfer';
import { cn } from '@/lib/utils';
import { useEnvironments } from '@/utils/hooks/useEnvironments';
import { mdiArrowRight } from '@mdi/js';
import { useState, type ReactNode } from 'react';

const NO_PAGE = 'Open a page in the Pages editor to send it.';
// The Pages panel is about one page, so "item" becomes "page" here.
const PANEL_MERGES = MERGES.map((m) => (m.value === 'OverrideExistingItem' ? { ...m, label: 'Replace this page only', long: 'Replace this page only' } : m));
const PANEL_SCOPES: { value: Scope; label: string }[] = [
  { value: 'SingleItem', label: 'This page only' },
  { value: 'ItemAndChildren', label: 'This page + child pages' },
  { value: 'ItemAndDescendants', label: 'This page + all subpages' },
];

const BTN = 'h-[46px] rounded-[10px] px-5';
const EYEBROW = 'text-muted-foreground text-xs font-semibold tracking-wider uppercase';
// Blok forces the select value to display:flex, which cancels the ellipsis: a long label would hard-clip in 380px.
const TRIGGER =
  'w-full rounded-[10px] data-[size=default]:h-11 *:data-[slot=select-value]:block *:data-[slot=select-value]:truncate';

type Page = { name?: string; path: string };
type Option = { value: string; label: string };

function Field({
  id,
  label,
  value,
  options,
  onChange,
  children,
}: {
  id: string;
  label: string;
  value?: string;
  options: Option[];
  onChange(value: string): void;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-[13px] leading-snug font-semibold">
        {label}
      </Label>
      <Select value={value ?? ''} onValueChange={onChange}>
        <SelectTrigger id={id} className={TRIGGER} title={options.find((o) => o.value === value)?.label}>
          <SelectValue placeholder="Choose an environment" />
        </SelectTrigger>
        <SelectContent className="max-w-(--radix-select-content-available-width)">
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} title={o.label}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {children}
    </div>
  );
}

function PageCard({ page }: { page?: Page }) {
  return (
    <Card style="flat" padding="sm" className="bg-muted gap-1 rounded-xl p-3.5">
      <span className={EYEBROW}>Current page</span>
      {page ? (
        <>
          <span className="text-base font-semibold break-words">{page.name ?? nameOf(page.path)}</span>
          <span className="text-muted-foreground font-mono text-xs [overflow-wrap:anywhere]" title={page.path}>
            {page.path}
          </span>
        </>
      ) : (
        <span className="text-neutral-fg text-sm">{NO_PAGE}</span>
      )}
    </Card>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-4 py-3">
      <dt className={EYEBROW}>{label}</dt>
      <dd className="m-0 flex min-w-0 flex-col gap-0.5 text-sm font-medium break-words">{children}</dd>
    </div>
  );
}

function EnvRow({ label, env, detail }: { label: string; env: Env; detail?: string }) {
  return (
    <Row label={label}>
      <span className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 [overflow-wrap:anywhere]" title={env.name}>
          {env.name}
        </span>
        <EnvBadge env={env} />
      </span>
      {detail && <span className="text-muted-foreground font-mono text-xs font-normal">{detail}</span>}
    </Row>
  );
}

type Props = { client: SdkClient | null; pageName?: string; pagePath?: string };

/**
 * The compact "Send this page" flow for the Pages editor panel: form, then an inline review, then the run.
 * The page is held from Send until the review or run is closed, so a page change in the editor can't
 * change what was confirmed; the latest page applies once it is closed.
 */
export function PanelFlow({ client, pageName, pagePath }: Props) {
  const { envs, loading, error, retry } = useEnvironments(client);
  const [sourceId, setSourceId] = useState<string>();
  const [targetId, setTargetId] = useState<string>();
  const [scope, setScope] = useState<Scope>('ItemAndDescendants');
  const [merge, setMerge] = useState<MergeStrategy>('OverrideExistingTree');
  // Set while reviewing or running: the page as it was when Send was pressed.
  const [held, setHeld] = useState<Page>();
  // Items the review's pre-flight notes added (missing parents, related content), sent along with the page.
  const [extra, setExtra] = useState<DataTree[]>([]);
  // The target id the production box was ticked for: another target, or a fresh review, needs it ticked again.
  const [prodFor, setProdFor] = useState<string | null>(null);
  // "Back up <target> first" (on by default), the backup the current run made, and whether that run has a backup step.
  const [backupOn, setBackupOn] = useState(true);
  const [backupZip, setBackupZip] = useState<{ blob: Blob; name: string }>();
  const [withBackup, setWithBackup] = useState(false);
  // Whether the current run is a restore of that backup rather than the send itself.
  const [restoring, setRestoring] = useState(false);
  // "Publish to Experience Edge when done" (off by default), and whether the current send publishes: a restore then
  // publishes too, so the live site goes back as well.
  const [publishOn, setPublishOn] = useState(false);
  const [withPublish, setWithPublish] = useState(false);
  // Whether the review shows how the page differs on the target.
  const [diffOpen, setDiffOpen] = useState(false);
  const runner = useRun();
  const { run } = runner;

  // Nothing is preselected. The same environment on both sides counts as no target.
  const source = envs.find((e) => e.id === sourceId);
  const picked = envs.find((e) => e.id === targetId);
  const same = !!source && picked?.id === source.id;
  const target = same ? undefined : picked;
  const routeOk = !!source && !!target;
  const page = held ?? (pagePath ? { name: pageName, path: pagePath } : undefined);
  const prodChecked = !!target && prodFor === target.id;
  const merges = mergesFor(scope, PANEL_MERGES, 'Replace it and its child pages');
  const canStart = !!held && routeOk && !(needsProdConfirm(target) && !prodChecked);
  const dataTrees: DataTree[] = held ? [...extra, { itemPath: held.path, scope, mergeStrategy: merge }] : [];
  const preflight = usePreflight(client, held && !run ? source : undefined, target, dataTrees);
  // Without a finished check (still checking, or it failed), the page is backed up whenever it can be overwritten.
  const backupTrees = backupTreesFor(dataTrees, preflight?.status === 'done' ? preflight.checks : undefined);
  // An environment vanished during the review (e.g. after a Retry): back to the form. Render-phase reset.
  if (held && !run && !routeOk) setHeld(undefined);

  const review = () => {
    if (!routeOk || !pagePath) return;
    setProdFor(null);
    setExtra([]);
    setDiffOpen(false);
    setHeld({ name: pageName, path: pagePath });
  };
  const close = () => {
    runner.reset();
    setRestoring(false);
    setHeld(undefined);
  };
  const changeScope = (value: Scope) => {
    const next = withScope({ scope, mergeStrategy: merge }, value);
    setScope(next.scope);
    setMerge(next.mergeStrategy);
  };
  const start = () => {
    if (!client || !source || !target || !held || !canStart) return;
    const backup = backupOn ? backupTrees : [];
    setBackupZip(undefined);
    setWithBackup(backup.length > 0);
    setRestoring(false);
    setWithPublish(publishOn);
    const onBackup = (blob: Blob) => {
      const pkg = { blob, name: backupName(target.name) };
      setBackupZip(pkg);
      download(pkg.blob, pkg.name);
    };
    const labels = [...(backup.length ? ['Back up target'] : []), ...TRANSFER_STEPS, ...(publishOn ? ['Publish to Experience Edge'] : [])];
    void runner.start({ labels, source, targets: [target] }, (cb, signal) =>
      runTransfer(client, { source, targets: [{ env: target, backup }], database: DATABASE, dataTrees, publish: publishOn }, { ...cb, onBackup }, signal),
    );
  };

  let body: ReactNode;
  let footer: ReactNode;
  if (run) {
    // From this step on the target may be importing: Cancel goes, and a failed run may have changed the target.
    const importStep = restoring ? IMPORT_STEP.import : IMPORT_STEP.transfer + (withBackup ? 1 : 0);
    const changed = run.result === 'success' || (run.result === 'fail' && !runner.canCancelUntil(importStep));
    // Installs the backup into the target the send wrote to, as a fresh run.
    const restore = () => {
      const pkg = backupZip!;
      const tgt = run.targets![0];
      runner.reset();
      setRestoring(true);
      const labels = [...IMPORT_STEPS, ...(withPublish ? ['Publish to Experience Edge'] : [])];
      void runner.start({ labels, targets: [tgt] }, async (cb, signal) => {
        const { parts, items } = await readPackage(new File([pkg.blob], pkg.name));
        // The send was published: publish what the backup puts back, so the live site goes back too.
        const publish = withPublish
          ? items.map((i): DataTree => ({ itemPath: i.path, scope: i.scope as Scope, mergeStrategy: i.mergeStrategy as MergeStrategy }))
          : undefined;
        return runImport(client!, { target: tgt, database: DATABASE, parts, publish }, cb, signal);
      });
    };
    body = (
      <section ref={runner.headingRef} className="[&_h2]:outline-none">
        <RunView
          compact
          kind={restoring ? 'restore' : 'transfer'}
          source={run.source}
          targets={run.targets}
          steps={run.steps}
          progress={run.progress}
          logs={run.logs}
          running={run.running}
          result={run.result}
          tookMs={run.tookMs}
          info={run.info}
          // Cancel is only safe until the target starts importing.
          onCancel={runner.canCancelUntil(importStep) ? runner.cancel : undefined}
          onAgain={() => {
            if (restoring && run.result === 'fail') restore();
            else if (run.result === 'fail') {
              // Back to a fresh review of the same page.
              runner.reset();
              setProdFor(null);
            } else close();
          }}
          onHome={close}
          backups={
            backupZip
              ? [{ target: run.targets![0], onDownload: () => download(backupZip.blob, backupZip.name), onRestore: !restoring && changed ? restore : undefined }]
              : undefined
          }
        />
      </section>
    );
  } else if (held && target) {
    const replacing = merge === 'OverrideExistingTree';
    // The same page on the target, about to be overwritten: its fields can be compared.
    const diffable = !!client && preflight?.status === 'done' && preflight.checks.get(held.path)?.onTarget === 'same' && merge !== 'KeepExistingItem';
    body = (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Ready to transfer</h2>
          <p className="text-muted-foreground text-sm">Nothing has been written yet. Check the route and items, then start.</p>
        </div>
        <section aria-label="Review" className="rounded-xl border bg-white">
          <dl className="m-0 divide-y">
            <EnvRow label="From" env={source!} detail={`reads from ${DATABASE}`} />
            <EnvRow label="To" env={target} detail={`writes to ${DATABASE}`} />
            <Row label="Page">
              <span className="break-words">{held.name ?? nameOf(held.path)}</span>
              <span className="text-muted-foreground font-mono text-xs font-normal [overflow-wrap:anywhere]" title={held.path}>
                {held.path}
              </span>
            </Row>
            <Row label={`On ${target.name}`}>
              <span>
                <PreflightStatus preflight={preflight} itemPath={held.path} source={source!} />
              </span>
              {diffable && <ChangesToggle open={diffOpen} itemPath={held.path} onClick={() => setDiffOpen(!diffOpen)} />}
              {diffable && diffOpen && (
                <div className="mt-1.5">
                  <FieldDiff client={client!} source={source!} target={target} itemPath={held.path} />
                </div>
              )}
            </Row>
            {extra.length > 0 && (
              <Row label="Also sends">
                {extra.map((t) => (
                  <span key={t.itemPath} className="text-muted-foreground font-mono text-xs font-normal [overflow-wrap:anywhere]">
                    {t.itemPath}
                  </span>
                ))}
              </Row>
            )}
            <Row label="Includes">{labelOf(PANEL_SCOPES, scope)}</Row>
            <Row label={`If it exists on ${target.name}`}>{labelOf(merges, merge, true)}</Row>
          </dl>
        </section>
        {replacing && (
          <Alert variant="warning" role="note" className="border-warning-200 bg-warning-50 text-warning-700 items-start rounded-xl border px-4 py-3.5">
            <AlertDescription>
              <strong className="font-semibold break-words">{treeWarning(1, target.name)}</strong>
            </AlertDescription>
          </Alert>
        )}
        <PreflightNotes
          preflight={preflight}
          source={source!}
          target={target}
          onAddParents={
            preflight?.status === 'done'
              ? () => setExtra(addMissingParents(dataTrees, preflight.checks).filter((t) => t.itemPath !== held.path))
              : undefined
          }
          onAddRelated={
            preflight?.status === 'done' && preflight.related
              ? () => setExtra(addRelated(dataTrees, preflight.related!).filter((t) => t.itemPath !== held.path))
              : undefined
          }
        />
        <BackupChoice targets={[target]} available={backupTrees.length > 0} checked={backupOn} onChange={setBackupOn} />
        <PublishChoice targets={[target]} checked={publishOn} onChange={setPublishOn} />
        {needsProdConfirm(target) && <ProdConfirm target={target} checked={prodChecked} onChange={(v) => setProdFor(v ? target.id : null)} />}
        <p className="text-muted-foreground text-[13px] leading-normal">
          {cancelNote(target.name)}
        </p>
      </div>
    );
    footer = (
      <footer className="sticky bottom-0 flex gap-2.5 border-t bg-white p-[18px]">
        <Button type="button" variant="outline" className={cn(BTN, 'flex-1')} onClick={() => setHeld(undefined)}>
          Back
        </Button>
        <Button type="button" className={cn(BTN, 'flex-1')} disabled={!canStart} onClick={start}>
          <Icon path={mdiArrowRight} aria-hidden="true" />
          Start
        </Button>
      </footer>
    );
  } else {
    const options = envs.map((e) => ({ value: e.id, label: e.name }));
    body = (
      <>
        <PageCard page={page} />
        {loading ? (
          <div role="status" aria-label="Loading environments" className="flex flex-col gap-3.5">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : error ? (
          <Alert variant="danger">
            <AlertTitle>Couldn&apos;t load environments</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-x-2">
              <span className="min-w-0 break-words">{error}</span>
              <Button type="button" variant="link" size="xs" className="pointer-coarse:h-11" onClick={retry}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : envs.length < 2 ? (
          <Alert>
            <AlertDescription>{ONE_ENV}</AlertDescription>
          </Alert>
        ) : (
          <>
            <Field id="panel-from" label="From" value={source?.id} options={options} onChange={setSourceId} />
            <Field id="panel-to" label="To" value={picked?.id} options={options} onChange={setTargetId}>
              {same && <p className="text-danger-600 text-xs">From and To must be different environments.</p>}
            </Field>
            <Field id="panel-scope" label="Include" value={scope} options={PANEL_SCOPES} onChange={(v) => changeScope(v as Scope)} />
            <Field
              id="panel-merge"
              label={`If it already exists on ${picked?.name ?? 'the target'}`}
              value={merge}
              options={merges}
              onChange={(v) => setMerge(v as MergeStrategy)}
            />
          </>
        )}
      </>
    );
    footer = (
      <footer className="sticky bottom-0 flex flex-col gap-2 border-t bg-white p-[18px]">
        {/* The target's name is the point of this button: let a long one wrap instead of clipping or overflowing. */}
        <Button
          type="button"
          className={cn(BTN, 'h-auto min-h-[46px] min-w-0 py-2.5 text-center leading-snug whitespace-normal [overflow-wrap:anywhere]')}
          disabled={!routeOk || !pagePath}
          onClick={review}
        >
          {`Send to ${picked?.name ?? 'target'}`}
        </Button>
        <p className="text-muted-foreground text-center text-xs">You&apos;ll confirm before anything is written.</p>
      </footer>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="flex items-center gap-2.5 border-b px-[18px] py-4">
        <Logo className="size-[30px] shrink-0" />
        <h1 className="text-[15px] font-semibold">Send this page</h1>
      </header>
      <main className="flex flex-1 flex-col gap-[18px] p-[18px]">{body}</main>
      {footer}
    </div>
  );
}
