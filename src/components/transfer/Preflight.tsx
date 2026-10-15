import type { Preflight } from '@/components/transfer/usePreflight';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Icon } from '@/lib/icon';
import { nameOf } from '@/lib/queue';
import type { Env } from '@/lib/sdk';
import { cn } from '@/lib/utils';
import { mdiCheckCircle, mdiLoading } from '@mdi/js';
import { useId, type ReactNode } from 'react';

const NOTE = {
  warning: 'border-warning-200 bg-warning-50 text-warning-700',
  danger: 'border-danger-200 bg-danger-50 text-danger-700',
};
const CHIP = {
  danger: 'bg-danger-50 text-danger-600',
  warning: 'bg-warning-50 text-warning-600',
  neutral: 'bg-neutral-bg text-neutral-fg',
};
const PILL = 'inline-block rounded-full px-2.5 py-1 text-xs font-semibold';
const PATH = 'font-mono text-xs [overflow-wrap:anywhere]';
const MAX_NAMES = 8;

function Note({ tone, title, children, action }: { tone: keyof typeof NOTE; title: string; children?: ReactNode; action?: ReactNode }) {
  const id = useId();
  return (
    <Alert variant={tone} role="note" aria-labelledby={id} className={cn('items-start rounded-xl border px-4 py-3.5', NOTE[tone])}>
      <AlertDescription className="gap-2">
        <strong id={id} className="font-semibold break-words">
          {title}
        </strong>
        {children}
        {action && <div>{action}</div>}
      </AlertDescription>
    </Alert>
  );
}

const Paths = ({ paths }: { paths: string[] }) => (
  <ul className="flex flex-col gap-1">
    {paths.map((p) => (
      <li key={p} className={PATH}>
        {p}
      </li>
    ))}
  </ul>
);

const Action = ({ label, onClick }: { label: string; onClick(): void }) => (
  <Button type="button" variant="outline" size="sm" className="h-9 rounded-lg bg-white px-3 pointer-coarse:h-11" onClick={onClick}>
    {label}
  </Button>
);

type NotesProps = { preflight?: Preflight; source: Env; target: Env; onAddParents?(): void; onRemoveNotFound?(): void };

/** The pre-flight result for the whole list: progress, a clean bill, or one note per kind of problem. Nothing here blocks Start. */
export function PreflightNotes({ preflight, source, target, onAddParents, onRemoveNotFound }: NotesProps) {
  if (!preflight) return null;
  if (preflight.status === 'checking') {
    return (
      <p role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
        <Icon path={mdiLoading} className="size-4 animate-spin" aria-hidden="true" />
        {`Checking ${target.name}…`}
      </p>
    );
  }
  if (preflight.status === 'failed') {
    return <Note tone="warning" title={`Couldn't run the pre-flight check: ${preflight.error}. You can still start.`} />;
  }

  const checks = [...preflight.checks.values()];
  const found = checks.filter((c) => c.onSource);
  const notFound = checks.filter((c) => !c.onSource);
  const missing = [...new Set(found.flatMap((c) => c.missingParents))];
  const otherParents = found.filter((c) => c.otherParents.length);
  const otherHere = found.filter((c) => c.onTarget === 'other');
  const deleted = found.filter((c) => c.deleted.length);

  if (!notFound.length && !missing.length && !otherParents.length && !otherHere.length && !deleted.length) {
    return (
      <p role="status" className="text-success-700 flex items-center gap-2 text-sm font-medium">
        <Icon path={mdiCheckCircle} className="size-4" aria-hidden="true" />
        {`Pre-flight check: everything is in place on ${target.name}.`}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {/* First, so it sits right under the "replaces everything below" warning it details. */}
      {deleted.length > 0 && (
        <Note tone="warning" title={`Deleted on ${target.name}`}>
          <span>{`These exist only on ${target.name}, so replacing everything below deletes them and everything under them.`}</span>
          <ul className="flex flex-col gap-1">
            {deleted.map((c) => (
              <li key={c.itemPath} className="break-words">
                {`Under ${nameOf(c.itemPath)}: ${c.deleted.slice(0, MAX_NAMES).join(', ')}`}
                {c.deleted.length > MAX_NAMES && ` and ${c.deleted.length - MAX_NAMES} more`}
              </li>
            ))}
          </ul>
        </Note>
      )}
      {notFound.length > 0 && (
        <Note
          tone="danger"
          title={`Not found on ${source.name}`}
          action={onRemoveNotFound && <Action label="Remove from the list" onClick={onRemoveNotFound} />}
        >
          <span>{`These paths don't exist on ${source.name}, so nothing is copied for them.`}</span>
          <Paths paths={notFound.map((c) => c.itemPath)} />
        </Note>
      )}
      {missing.length > 0 && (
        <Note
          tone="warning"
          title={`Missing parents on ${target.name}`}
          action={onAddParents && <Action label="Add missing parents" onClick={onAddParents} />}
        >
          <span>{`Items whose parents aren't on ${target.name} transfer but don't appear in the content tree.`}</span>
          <Paths paths={missing} />
          {onAddParents && <span>They&apos;re added as This item, keeping what&apos;s there.</span>}
        </Note>
      )}
      {otherParents.length > 0 && (
        <Note tone="warning" title={`Different parent items on ${target.name}`}>
          {otherParents.flatMap((c) =>
            c.otherParents.map((p) => (
              <span key={`${c.itemPath}|${p}`} className="[overflow-wrap:anywhere]">
                {`${p} is a different item on ${target.name}, so ${nameOf(c.itemPath)} won't appear under it.`}
              </span>
            )),
          )}
          <span>Transfer from a parent both environments share instead.</span>
        </Note>
      )}
      {otherHere.length > 0 && (
        <Note tone="warning" title={`A different item already exists on ${target.name}`}>
          <span>Copying adds a second item with the same name next to it.</span>
          <Paths paths={otherHere.map((c) => c.itemPath)} />
        </Note>
      )}
    </div>
  );
}

/** What the target holds for one item, most serious first, for the items table. */
export function PreflightStatus({ preflight, itemPath, source }: { preflight?: Preflight; itemPath: string; source: Env }) {
  if (preflight?.status === 'checking') return <span className="text-muted-foreground text-xs">Checking…</span>;
  const c = preflight?.status === 'done' ? preflight.checks.get(itemPath) : undefined;
  if (!c) return <span className="text-muted-foreground">—</span>;
  const [label, tone]: [string, keyof typeof CHIP] = !c.onSource
    ? [`Not on ${source.name}`, 'danger']
    : c.onTarget === 'other'
      ? ['Different item here', 'warning']
      : c.otherParents.length
        ? ['Different parent', 'warning']
        : c.missingParents.length
          ? ['Parent missing', 'warning']
          : c.onTarget === 'new'
            ? ['New', 'neutral']
            : ['Exists', 'neutral'];
  return <span className={cn(PILL, CHIP[tone])}>{label}</span>;
}
