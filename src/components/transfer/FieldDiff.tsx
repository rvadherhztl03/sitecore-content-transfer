import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { fieldDiff, type FieldValue } from '@/lib/diff';
import { Icon } from '@/lib/icon';
import type { Env, SdkClient } from '@/lib/sdk';
import { cn } from '@/lib/utils';
import { mdiLoading } from '@mdi/js';
import { useEffect, useId, useState } from 'react';

type Props = { client: SdkClient; source: Env; target: Env; itemPath: string };

type State = { status: 'loading' } | { status: 'failed'; error: string } | { status: 'done'; fields: FieldValue[] };

const BTN = 'h-9 shrink-0 rounded-lg px-3 pointer-coarse:h-11';

/** The "Show changes" button that opens an item's field diff; `target` names it too, where several targets have one. */
export function ChangesToggle({ open, itemPath, target, onClick }: { open: boolean; itemPath: string; target?: string; onClick(): void }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn(BTN, 'mt-1.5 self-start')}
      aria-expanded={open}
      aria-label={`${open ? 'Hide' : 'Show'} changes to ${itemPath}${target ? ` on ${target}` : ''}`}
      onClick={onClick}
    >
      {open ? 'Hide changes' : 'Show changes'}
    </Button>
  );
}

// One side's full value: scrolls when long, never cut short.
function Value({ label, value, missing }: { label: string; value?: string; missing?: string }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="flex min-w-0 flex-col gap-1">
      <span id={id} className="text-muted-foreground text-xs font-semibold [overflow-wrap:anywhere]">
        {label}
      </span>
      {value === undefined || value === '' ? (
        <span className="text-muted-foreground text-xs">{value === undefined ? missing : '(empty)'}</span>
      ) : (
        <pre
          tabIndex={0}
          className="bg-muted focus-visible:ring-primary/50 max-h-64 overflow-auto rounded-lg border p-2.5 font-mono text-xs whitespace-pre-wrap outline-none [overflow-wrap:anywhere] focus-visible:ring-[3px]"
        >
          {value}
        </pre>
      )}
    </div>
  );
}

function FieldRow({ field, source, target }: { field: FieldValue; source: Env; target: Env }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <li className="flex min-w-0 flex-col gap-2 border-b px-3 py-2.5 last:border-b-0">
      <div className="flex min-w-0 flex-wrap items-center gap-2.5">
        <span className="min-w-0 flex-1 font-semibold break-words">{field.name}</span>
        {field.changed && <span className="bg-warning-50 text-warning-600 shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold">Changed</span>}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={BTN}
          aria-expanded={open}
          aria-controls={id}
          aria-label={`${open ? 'Hide' : 'Show'} values of ${field.name}`}
          onClick={() => setOpen(!open)}
        >
          {open ? 'Hide values' : 'Show values'}
        </Button>
      </div>
      {open && (
        <div id={id} className={cn('grid gap-2', field.changed && 'sm:grid-cols-2')}>
          {field.changed ? (
            <>
              <Value label={source.name} value={field.source} missing={`Not on ${source.name}`} />
              <Value label={target.name} value={field.target} missing={`Not on ${target.name}`} />
            </>
          ) : (
            <Value label="Both" value={field.source} />
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Which fields of an item differ between the environments, with each side's full value on request. Reads both
 * environments when mounted, so mount it only once it's opened.
 */
export function FieldDiff({ client, source, target, itemPath }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [all, setAll] = useState(false);

  useEffect(() => {
    let live = true;
    fieldDiff(client, source, target, itemPath).then(
      (fields) => live && setState({ status: 'done', fields }),
      (e) => live && setState({ status: 'failed', error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [client, source, target, itemPath]);

  const fields = state.status === 'done' ? state.fields : [];
  const changed = fields.filter((f) => f.changed);
  const shown = all ? [...changed, ...fields.filter((f) => !f.changed)] : changed;

  return (
    <div role="group" aria-label={`Changes to ${itemPath}`} className="flex min-w-0 flex-col gap-2.5 rounded-xl border bg-white p-3 text-sm font-normal">
      {state.status === 'loading' && (
        <p role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
          <Icon path={mdiLoading} className="size-4 animate-spin" aria-hidden="true" />
          Reading fields…
        </p>
      )}
      {state.status === 'failed' && (
        <Alert variant="danger">
          <AlertDescription className="break-words">{`Couldn't read the fields: ${state.error}`}</AlertDescription>
        </Alert>
      )}
      {state.status === 'done' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground text-xs">Default language, latest version. Revision and updated dates are left out.</p>
            <Button type="button" variant="outline" size="sm" className={BTN} aria-pressed={all} onClick={() => setAll(!all)}>
              {`Show all fields (${fields.length})`}
            </Button>
          </div>
          {changed.length === 0 && (
            <p role="status" className="text-success-700 text-sm font-medium">
              No field values differ.
            </p>
          )}
          {shown.length > 0 && (
            <ul aria-label="Fields" className="flex flex-col rounded-xl border">
              {shown.map((f) => (
                <FieldRow key={f.name} field={f} source={source} target={target} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
