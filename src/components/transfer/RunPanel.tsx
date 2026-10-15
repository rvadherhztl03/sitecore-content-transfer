import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Progress } from '@/components/ui/progress';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { Icon } from '@/lib/icon';
import type { LogType, StepStatus } from '@/lib/transfer';
import { mdiAlertCircle, mdiCheckCircle, mdiCircleOutline, mdiContentCopy } from '@mdi/js';
import { useEffect, useRef, useState } from 'react';

export type LogLine = { text: string; type: LogType; time: string };

type Props = {
  open: boolean;
  compact?: boolean;
  title: string;
  steps: { label: string; status: StepStatus }[];
  progress: number;
  logs: LogLine[];
  running: boolean;
  result: 'success' | 'fail' | null;
  onCancel(): void;
  onClose(): void;
  onRunAgain(): void;
};

const STEP_TEXT: Record<StepStatus, string> = {
  pending: 'not started',
  running: 'in progress',
  done: 'finished',
  fail: 'failed',
};
const COPY_TEXT = { idle: 'Copy logs', copied: 'Copied', failed: 'Copy failed' };
const CHUNK = /chunk (\d+) \/ (\d+)/i;
const LOG_COLOR: Record<LogType, string> = {
  info: 'text-muted-foreground',
  success: 'text-success-500',
  warning: 'text-warning-500',
  error: 'text-danger-500',
};

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'running') return <Spinner />;
  if (status === 'done') return <Icon path={mdiCheckCircle} className="size-4 text-success-500" aria-hidden />;
  if (status === 'fail') return <Icon path={mdiAlertCircle} className="size-4 text-danger-500" aria-hidden />;
  return <Icon path={mdiCircleOutline} className="text-muted-foreground size-4" aria-hidden />;
}

export function RunPanel({
  open,
  compact,
  title,
  steps,
  progress,
  logs,
  running,
  result,
  onCancel,
  onClose,
  onRunAgain,
}: Props) {
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo?.({ top: logRef.current.scrollHeight });
  }, [logs.length]);

  const [copy, setCopy] = useState<keyof typeof COPY_TEXT>('idle');
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const percent = Math.round(progress);
  const current = steps.find((s) => s.status === 'running');
  const status =
    result === 'success' ? 'Completed' : result === 'fail' ? 'Failed' : running ? `${current?.label ?? 'Starting'} · ${percent}%` : '';
  // The engine logs "<verb> chunk N / M"; the latest such line is the live counter.
  const chunk = running ? [...logs].reverse().map((l) => CHUNK.exec(l.text)).find(Boolean) : null;
  const copyLogs = async () => {
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

  const body = (
    <>
      <div aria-live="polite" className="text-sm font-semibold">
        {status}
      </div>
      <div className="flex items-center gap-3">
        <Progress value={progress} />
        {chunk && <span className="text-muted-foreground shrink-0 text-xs">{`Chunk ${chunk[1]} / ${chunk[2]}`}</span>}
      </div>
      <ol className="flex flex-col gap-2">
        {steps.map((s, i) => (
          <li key={i} className="flex items-center gap-2 text-sm">
            <StepIcon status={s.status} />
            <span>{s.label}</span>
            <span className="sr-only">{`(${STEP_TEXT[s.status]})`}</span>
          </li>
        ))}
      </ol>
      <Collapsible defaultOpen className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm">
              Logs ({logs.length})
            </Button>
          </CollapsibleTrigger>
          <Button type="button" variant="outline" size="sm" disabled={logs.length === 0} onClick={copyLogs}>
            <Icon path={mdiContentCopy} />
            {COPY_TEXT[copy]}
          </Button>
        </div>
        <CollapsibleContent>
          <div ref={logRef} className="max-h-60 overflow-y-auto rounded-md border p-2 font-mono text-xs">
            {logs.map((l, i) => (
              <div key={i} className={LOG_COLOR[l.type]}>
                <span className="text-muted-foreground">{l.time}</span> {l.text}
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </>
  );

  const actions = running ? (
    <Button type="button" variant="outline" onClick={onCancel}>
      Cancel
    </Button>
  ) : (
    <>
      <Button type="button" variant="outline" onClick={onRunAgain}>
        Run again
      </Button>
      <Button type="button" onClick={onClose}>
        Done
      </Button>
    </>
  );

  if (compact) {
    if (!open) return null;
    return (
      <section aria-label={title} className="flex flex-col gap-4 rounded-md border p-4">
        <h3 className="text-md font-semibold">{title}</h3>
        {body}
        <div className="flex justify-end gap-2">{actions}</div>
      </section>
    );
  }

  // A running transfer can't be dismissed: Escape and outside clicks are ignored and the X is hidden.
  const guard = (e: Event) => running && e.preventDefault();
  return (
    <Sheet open={open} onOpenChange={(next) => !next && !running && onClose()}>
      <SheetContent
        side="right"
        className="sm:max-w-md"
        showCloseButton={!running}
        onEscapeKeyDown={guard}
        onPointerDownOutside={guard}
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription className="sr-only">Steps, progress and logs for this run.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">{body}</div>
        <SheetFooter>{actions}</SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
