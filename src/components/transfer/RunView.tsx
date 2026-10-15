import { ActionBar } from '@/components/transfer/Layout';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { Icon } from '@/lib/icon';
import type { Env } from '@/lib/sdk';
import type { LogType, StepStatus } from '@/lib/transfer';
import { cn } from '@/lib/utils';
import { mdiAlertCircle, mdiCheck, mdiChevronDown } from '@mdi/js';
import { useEffect, useRef, useState, type ElementType } from 'react';

export type LogLine = { text: string; type: LogType; time: string };
export type RunKind = 'transfer' | 'export' | 'install';
/** What the package holds; leave out `itemCount` when it isn't known (a bare .raif has no item list). */
export type RunInfo = { chunkCount: number; itemCount?: number };

type Props = {
  kind: RunKind;
  /** Single column with inline actions and no sticky footer, for the Pages panel. */
  compact?: boolean;
  source?: Env;
  target?: Env;
  steps: { label: string; status: StepStatus; ms?: number }[];
  progress: number;
  logs: LogLine[];
  running: boolean;
  result: 'success' | 'fail' | null;
  tookMs?: number;
  info?: RunInfo;
  /** Leave out to hide Cancel, e.g. once the target is importing and can't be stopped. */
  onCancel?(): void;
  onAgain(): void;
  onHome(): void;
  onDownload?(): void;
  /** Set when the run backed up the target first: offers the backup again, with how to restore it. */
  onDownloadBackup?(): void;
};

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return m ? `${h} h ${m} min` : `${h} h`;
  if (m) return s ? `${m} min ${s} s` : `${m} min`;
  return `${s} s`;
}

type Words = {
  label: string;
  noun: string;
  running(source: string, target: string): string;
  summary(source: string, target: string): string;
  done: string;
  failed: string;
  cancel: string;
  again: string;
};

const WORDS: Record<RunKind, Words> = {
  transfer: {
    label: 'Transfer',
    noun: 'transfer',
    running: (_s, t) => `Copying content to ${t}`,
    summary: (s, t) => `Content from ${s} is now in ${t}.`,
    done: 'Transfer complete',
    failed: 'Transfer failed',
    cancel: 'Cancel transfer',
    again: 'Start another transfer',
  },
  export: {
    label: 'Export',
    noun: 'export',
    running: (s) => `Packaging content from ${s}`,
    summary: () => 'Your package is ready to download.',
    done: 'Package ready',
    failed: 'Export failed',
    cancel: 'Cancel export',
    again: 'Start another export',
  },
  install: {
    label: 'Install',
    noun: 'install',
    running: (_s, t) => `Installing package into ${t}`,
    summary: (_s, t) => `The package is now in ${t}.`,
    done: 'Package installed',
    failed: 'Install failed',
    cancel: 'Cancel install',
    again: 'Install another package',
  },
};

const STEP_WORD: Record<StepStatus, string> = { pending: 'Not started', running: 'Running', done: 'Done', fail: 'Failed' };
const STEP_TONE: Record<StepStatus, string> = {
  pending: 'text-muted-foreground',
  running: 'text-primary-600',
  done: 'text-neutral-fg',
  fail: 'text-danger-600',
};
const COPY_TEXT = { idle: 'Copy log', copied: 'Copied', failed: 'Copy failed' };
// The engine logs "<Verb> chunk N / M"; the latest such line is the live counter.
const CHUNK = /(\w+) chunk (\d+) \/ (\d+)/i;
const CANT_CANCEL = "The import can't be cancelled once it starts.";

const LOG_DARK: Record<LogType, string> = {
  info: 'text-[#E7E7EE]',
  success: 'text-success-200',
  warning: 'text-warning-200',
  error: 'text-danger-300',
};
const LOG_LIGHT: Record<LogType, string> = {
  info: 'text-neutral-fg',
  success: 'text-success-600',
  warning: 'text-warning-600',
  error: 'text-danger-600',
};

const CARD = 'rounded-xl border bg-white';
const BTN = 'h-11 rounded-[10px] px-5';
const DOT = 'grid size-7 shrink-0 place-items-center rounded-full';

function StepDot({ status }: { status: StepStatus }) {
  if (status === 'done')
    return (
      <span className={cn(DOT, 'bg-success-500 text-inverse-text')}>
        <Icon path={mdiCheck} className="size-4" aria-hidden="true" />
      </span>
    );
  if (status === 'running')
    return (
      <span className={cn(DOT, 'border-primary bg-primary-50 border-2')}>
        <Spinner aria-hidden="true" className="text-primary size-4" />
      </span>
    );
  if (status === 'fail') return <Icon path={mdiAlertCircle} className="text-danger-500 size-7 shrink-0" aria-hidden="true" />;
  return <span className={cn(DOT, 'border-blackAlpha-300 border-[1.5px]')} />;
}

function Lines({ logs, dark }: { logs: LogLine[]; dark?: boolean }) {
  return logs.map((l, i) => (
    <div key={i} className="flex gap-3 text-xs leading-relaxed">
      <span className={cn('shrink-0', dark ? 'text-[#8D8D99]' : 'text-muted-foreground')}>{l.time}</span>
      <span className={cn('min-w-0 break-words', (dark ? LOG_DARK : LOG_LIGHT)[l.type])}>{l.text}</span>
    </div>
  ));
}

export function RunView({
  kind,
  compact,
  source,
  target,
  steps,
  progress,
  logs,
  running,
  result,
  tookMs,
  info,
  onCancel,
  onAgain,
  onHome,
  onDownload,
  onDownloadBackup,
}: Props) {
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo?.({ top: logRef.current.scrollHeight });
  }, [logs.length]);

  const [copy, setCopy] = useState<keyof typeof COPY_TEXT>('idle');
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  const copyLog = async () => {
    let next: 'copied' | 'failed' = 'copied';
    try {
      // Throws a TypeError when there is no clipboard (common in the XM Cloud iframe), so it lands in the catch.
      await navigator.clipboard.writeText(logs.map((l) => `${l.time} ${l.text}`).join('\n'));
    } catch {
      next = 'failed';
    }
    setCopy(next);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopy('idle'), 2000);
  };

  const w = WORDS[kind];
  const from = source?.name ?? 'the source';
  const to = target?.name ?? 'the target';
  const percent = Math.min(100, Math.max(0, Math.round(progress)));
  // The latest "<Verb> chunk N / M" line, found from the end.
  let chunk: RegExpExecArray | null = null;
  if (running) for (let i = logs.length - 1; i >= 0 && !chunk; i--) chunk = CHUNK.exec(logs[i].text);
  const H: ElementType = compact ? 'h2' : 'h1';
  // The full page's body is the page's <main>; the footer below sits outside it so it stays a contentinfo landmark.
  // Compact lives inside the panel's own <main>.
  const Body: ElementType = compact ? 'div' : 'main';

  const copyButton = (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-9 rounded-[10px] px-3 text-[13px] pointer-coarse:h-11"
        disabled={logs.length === 0}
        onClick={copyLog}
      >
        {COPY_TEXT[copy]}
      </Button>
      <span role="status" className="sr-only">
        {copy === 'idle' ? '' : COPY_TEXT[copy]}
      </span>
    </>
  );
  const homeButton = (
    <Button type="button" variant="outline" className={BTN} onClick={onHome}>
      Back to home
    </Button>
  );

  const steplist = (
    <div className={cn(CARD, 'min-w-0 px-5 py-2', !compact && 'flex-[1_1_360px]')}>
      <h2 className="mt-3 mb-1 text-base font-semibold">Steps</h2>
      <ol role="list" aria-label="Steps" className="m-0 list-none p-0">
        {steps.map((s, i) => (
          <li key={i} aria-current={s.status === 'running' ? 'step' : undefined} className="flex items-start gap-3.5 py-3">
            <StepDot status={s.status} />
            <span className="flex min-w-0 flex-1 justify-between gap-2">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span
                  className={cn(
                    'text-sm break-words',
                    s.status === 'pending' ? 'text-muted-foreground font-medium' : s.status === 'running' ? 'font-semibold' : 'font-medium',
                  )}
                >
                  {s.label}
                </span>
                <span className={cn('text-xs', STEP_TONE[s.status], s.status === 'pending' && 'sr-only')}>{STEP_WORD[s.status]}</span>
              </span>
              {s.ms !== undefined && (s.status === 'done' || s.status === 'fail') && (
                <span className="text-muted-foreground shrink-0 font-mono text-xs">{formatDuration(s.ms)}</span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );

  const activity = (
    <div className={cn(CARD, 'flex min-w-0 flex-col overflow-hidden', !compact && 'flex-[1.3_1_420px]')}>
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3.5">
        <h2 className="text-base font-semibold">Activity</h2>
        {copyButton}
      </div>
      <div
        ref={logRef}
        role="region"
        aria-label="Activity log"
        tabIndex={0}
        className={cn(
          'flex flex-col gap-0.5 overflow-y-auto bg-[#14141A] px-4 py-3.5 font-mono',
          compact ? 'max-h-72 min-h-40' : 'max-h-[420px] min-h-[300px]',
        )}
      >
        <Lines logs={logs} dark />
      </div>
    </div>
  );

  const backupButton = onDownloadBackup && (
    <Button type="button" variant="outline" className={BTN} onClick={onDownloadBackup}>
      Download backup
    </Button>
  );
  const backupNote = (when: string) =>
    onDownloadBackup && (
      <p className="text-neutral-fg max-w-[520px] text-sm leading-normal break-words">
        {`A backup of ${to} from before this transfer was downloaded. Install it into ${to} ${when}.`}
      </p>
    );

  if (result === 'success') {
    const stats = [
      info?.itemCount !== undefined && (['Items', info.itemCount] as const),
      info && (['Chunks', info.chunkCount] as const),
      tookMs !== undefined && (['Took', formatDuration(tookMs)] as const),
    ].filter((x) => !!x);
    return (
      <Body className={cn('mx-auto flex w-full flex-col gap-6', compact ? 'gap-4' : 'max-w-[760px] flex-1 px-4 py-12 sm:px-8')}>
        <section className={cn(CARD, 'flex flex-col items-center gap-3.5 text-center', compact ? 'p-4' : 'p-8 sm:rounded-2xl')}>
          <span className="bg-success-50 text-success-500 grid size-16 place-items-center rounded-full">
            <Icon path={mdiCheck} className="size-8" aria-hidden="true" />
          </span>
          <H className="text-[26px] leading-tight font-semibold break-words">{w.done}</H>
          <p className="text-neutral-fg max-w-[520px] text-[15px] leading-normal break-words">{w.summary(from, to)}</p>
          {backupNote('to undo the transfer')}
          {stats.length > 0 && (
            <dl className="mt-2 flex w-full flex-wrap gap-3 text-left">
              {stats.map(([label, value]) => (
                <div key={label} className="bg-muted flex min-w-0 flex-[1_1_160px] flex-col gap-1 rounded-xl p-4">
                  <dt className="text-neutral-fg text-xs font-semibold tracking-wider uppercase">{label}</dt>
                  <dd className="text-[22px] font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="mt-2 flex flex-wrap justify-center gap-2.5">
            {kind === 'export' && onDownload && (
              <Button type="button" className={BTN} onClick={onDownload}>
                Download package
              </Button>
            )}
            <Button type="button" variant={kind === 'export' && onDownload ? 'outline' : 'default'} className={BTN} onClick={onAgain}>
              {w.again}
            </Button>
            {backupButton}
            {homeButton}
          </div>
        </section>
        <details className={cn(CARD, 'group px-4')}>
          <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-3 text-[15px] font-semibold">
            Activity log
            <Icon path={mdiChevronDown} className="text-muted-foreground size-5 transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="flex flex-col gap-3 pt-1 pb-4">
            <div className="flex flex-col gap-0.5 font-mono">
              <Lines logs={logs} />
            </div>
            <div className="flex justify-end">{copyButton}</div>
          </div>
        </details>
      </Body>
    );
  }

  const failed = result === 'fail';
  const cancel = running && !failed && onCancel && (
    <Button type="button" variant="outline" colorScheme="danger" className={cn(BTN, 'border-danger-200')} onClick={onCancel}>
      {w.cancel}
    </Button>
  );
  // An export has no import phase, so the note only applies to transfer and install.
  const note = running && !failed && !onCancel && kind !== 'export' ? CANT_CANCEL : null;

  return (
    <div className={cn('flex flex-col', compact ? 'gap-4' : 'flex-1')}>
      <Body className={cn('flex w-full flex-col gap-5', !compact && 'mx-auto max-w-[1120px] flex-1 px-4 py-7 sm:px-8')}>
        <section className={cn(CARD, 'flex flex-col gap-4', compact ? 'p-4' : 'p-5 sm:p-6')}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3.5">
              {failed && (
                <span className="bg-danger-50 text-danger-500 grid size-11 shrink-0 place-items-center rounded-full">
                  <Icon path={mdiAlertCircle} className="size-6" aria-hidden="true" />
                </span>
              )}
              <div className="flex min-w-0 flex-col gap-1">
                {!failed && (
                  <span className="text-primary-600 inline-flex items-center gap-2 text-[13px] font-semibold">
                    <span aria-hidden="true" className="bg-primary size-2 rounded-full" />
                    In progress
                  </span>
                )}
                <H className={cn('leading-tight font-semibold break-words', compact ? 'text-lg' : 'text-2xl')}>
                  {failed ? w.failed : w.running(from, to)}
                </H>
                {failed && <p className="text-neutral-fg text-sm">See the activity log for details.</p>}
                {failed && backupNote('to put it back as it was')}
              </div>
            </div>
            {!failed && (
              <span aria-hidden="true" className={cn('leading-none font-semibold tracking-tight', compact ? 'text-2xl' : 'text-[36px]')}>
                {`${percent}%`}
              </span>
            )}
          </div>
          {!failed && (
            <>
              <Progress value={percent} aria-label={`${w.label} progress`} className="bg-primary-100 h-2.5" />
              <p aria-live="polite" className="text-neutral-fg text-sm">
                {chunk && (
                  <>
                    {chunk[1]} chunk <strong className="font-semibold">{chunk[2]} of {chunk[3]}</strong>
                  </>
                )}
              </p>
            </>
          )}
          {failed && (
            <div className="flex flex-wrap gap-2.5">
              <Button type="button" className={BTN} onClick={onAgain}>
                Try again
              </Button>
              {backupButton}
              {homeButton}
            </div>
          )}
          {compact && (cancel || note) && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-neutral-fg text-sm">{note}</span>
              {cancel}
            </div>
          )}
        </section>
        <div className={cn('flex gap-5', compact ? 'flex-col' : 'flex-wrap items-start')}>
          {steplist}
          {activity}
        </div>
      </Body>
      {!compact && (cancel || note) && <ActionBar summary={note ?? `Keep this tab open until the ${w.noun} finishes.`}>{cancel}</ActionBar>}
    </div>
  );
}
