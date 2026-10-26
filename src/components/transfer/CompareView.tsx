import { ChangesToggle, FieldDiff } from '@/components/transfer/FieldDiff';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { COMPARE_LIMIT, compareTrees, rowsFor, type CompareItem, type CompareStatus } from '@/lib/compare';
import type { Env, SdkClient } from '@/lib/sdk';
import type { DataTree } from '@/lib/transfer';
import { cn } from '@/lib/utils';
import { useEffect, useRef, useState } from 'react';

type Props = {
  client: SdkClient;
  source: Env;
  target: Env;
  /** Where to start; `/sitecore/content` when left out. */
  initialPath?: string;
  /** Receives the queue rows for the picked items. */
  onAdd(rows: DataTree[]): void;
  limit?: number;
};

type State =
  | { status: 'idle' }
  | { status: 'running'; compared: number }
  | { status: 'stopped' }
  | { status: 'failed'; error: string }
  | { status: 'done'; root: string; items: CompareItem[]; truncated: boolean };

const ORDER: CompareStatus[] = ['new', 'changed', 'other', 'onlyTarget', 'same'];
const TONE: Record<CompareStatus, string> = {
  new: 'bg-primary-100 text-primary-700',
  changed: 'bg-warning-50 text-warning-600',
  other: 'bg-danger-50 text-danger-600',
  onlyTarget: 'bg-neutral-bg text-neutral-fg',
  same: 'bg-neutral-bg text-muted-foreground',
};
const PICKABLE = (s: CompareStatus) => s === 'new' || s === 'changed';
const BTN = 'h-9 rounded-lg px-3 pointer-coarse:h-11';

/** Compares a section of the source with the target and turns the picked new and changed items into queue rows. */
export function CompareView({ client, source, target, initialPath, onAdd, limit = COMPARE_LIMIT }: Props) {
  const [root, setRoot] = useState(initialPath ?? '/sitecore/content');
  const [state, setState] = useState<State>({ status: 'idle' });
  const [shown, setShown] = useState<Set<CompareStatus>>(new Set(['new', 'changed', 'other', 'onlyTarget']));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<number | null>(null);
  // The changed items whose field diff is open.
  const [opened, setOpened] = useState<Set<string>>(new Set());
  // The comparison in progress; a result from any other (stopped or replaced) one is ignored.
  const run = useRef<AbortController | null>(null);
  useEffect(() => () => run.current?.abort(), []);

  const label: Record<CompareStatus, string> = {
    new: `New on ${source.name}`,
    changed: 'Changed',
    other: 'Different item',
    onlyTarget: `Only on ${target.name}`,
    same: 'Same',
  };

  const compare = async () => {
    const path = root.trim();
    if (!path) return;
    run.current?.abort();
    const ctrl = new AbortController();
    run.current = ctrl;
    setPicked(new Set());
    setAdded(null);
    setOpened(new Set());
    setState({ status: 'running', compared: 0 });
    const mine = () => run.current === ctrl;
    try {
      const result = await compareTrees(client, source, target, path, {
        signal: ctrl.signal,
        limit,
        onProgress: (compared) => mine() && setState({ status: 'running', compared }),
      });
      if (mine()) setState({ status: 'done', root: path, ...result });
    } catch (e) {
      if (mine()) setState({ status: 'failed', error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (mine()) run.current = null;
    }
  };
  // Stops at once: requests already sent finish on their own and are ignored.
  const stop = () => {
    run.current?.abort();
    run.current = null;
    setState({ status: 'stopped' });
  };

  const done = state.status === 'done' ? state : null;
  const count = (s: CompareStatus) => done?.items.filter((i) => i.status === s).length ?? 0;
  const visible = done?.items.filter((i) => shown.has(i.status)) ?? [];
  const differences = ORDER.filter((s) => s !== 'same').reduce((n, s) => n + count(s), 0);
  const toggle = <T,>(set: Set<T>, value: T) => {
    const next = new Set(set);
    if (!next.delete(value)) next.add(value);
    return next;
  };
  const statusText = (i: CompareItem) =>
    i.status === 'changed' && i.newer ? `Changed · newer on ${(i.newer === 'source' ? source : target).name}` : label[i.status];

  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-[14px] border bg-white">
      <div className="flex flex-col gap-2.5 border-b px-4 py-3.5">
        <h2 className="text-[15px] font-semibold break-words">{`Compare ${source.name} with ${target.name}`}</h2>
        <div className="flex gap-2">
          <Input
            aria-label="Compare from"
            className="rounded-lg font-mono text-sm pointer-coarse:h-11"
            value={root}
            onChange={(e) => setRoot(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && state.status !== 'running' && compare()}
          />
          {state.status === 'running' ? (
            <Button type="button" variant="outline" size="sm" className="h-10 rounded-lg px-3.5 pointer-coarse:h-11" onClick={stop}>
              Stop
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" className="h-10 rounded-lg px-3.5 pointer-coarse:h-11" disabled={!root.trim()} onClick={compare}>
              Compare
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 p-3">
        {state.status === 'idle' && (
          <p className="text-muted-foreground px-1 py-2 text-sm">{`Compare a section to see what's new, changed or only on ${target.name}.`}</p>
        )}
        {state.status === 'running' && (
          <p role="status" className="text-muted-foreground px-1 text-sm">
            {`Compared ${state.compared} ${state.compared === 1 ? 'item' : 'items'}…`}
          </p>
        )}
        {state.status === 'stopped' && (
          <p role="status" className="text-muted-foreground px-1 text-sm">
            Comparison stopped.
          </p>
        )}
        {state.status === 'failed' && (
          <Alert variant="danger">
            <AlertDescription className="break-words">{`Couldn't compare: ${state.error}`}</AlertDescription>
          </Alert>
        )}
        {done && differences === 0 && (
          <p role="status" className="text-success-700 px-1 text-sm font-medium">{`No differences under ${done.root}.`}</p>
        )}
        {done && differences > 0 && (
          <>
            <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
              {ORDER.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={shown.has(s)}
                  onClick={() => setShown((set) => toggle(set, s))}
                  className={cn(
                    'focus-visible:ring-primary/50 rounded-full border px-2.5 py-1 text-xs font-semibold outline-none focus-visible:ring-[3px] pointer-coarse:min-h-11',
                    shown.has(s) ? TONE[s] : 'text-muted-foreground bg-white',
                  )}
                >
                  {`${label[s]} ${count(s)}`}
                </button>
              ))}
            </div>
            {done.truncated && (
              <p className="text-muted-foreground text-sm">{`Showing the first ${limit.toLocaleString()} items. Compare a smaller section to see the rest.`}</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={BTN}
                onClick={() => setPicked(new Set(done.items.filter((i) => PICKABLE(i.status)).map((i) => i.path)))}
              >
                Select all new and changed
              </Button>
              <Button
                type="button"
                size="sm"
                className={BTN}
                disabled={picked.size === 0}
                onClick={() => {
                  const rows = rowsFor(done.items, picked);
                  onAdd(rows);
                  setAdded(rows.length);
                  setPicked(new Set());
                }}
              >
                {`Add ${picked.size} to the list`}
              </Button>
              {added !== null && (
                <span role="status" className="text-success-700 text-sm font-medium">
                  {`Added ${added} to the list.`}
                </span>
              )}
            </div>
            <ul aria-label="Differences" className="flex max-h-[520px] flex-col overflow-y-auto rounded-xl border">
              {visible.map((i) => (
                <li
                  key={i.path}
                  className="flex min-w-0 flex-col gap-2.5 border-b px-3 py-2.5 last:border-b-0"
                  style={{ paddingLeft: 12 + i.depth * 14 }}
                >
                  <div className="flex min-w-0 items-start gap-2.5">
                    {PICKABLE(i.status) ? (
                      <Checkbox
                        aria-label={`Pick ${i.path}`}
                        className="relative mt-0.5 size-[18px] pointer-coarse:after:absolute pointer-coarse:after:-inset-3.5"
                        checked={picked.has(i.path)}
                        onCheckedChange={() => setPicked((set) => toggle(set, i.path))}
                      />
                    ) : (
                      <span aria-hidden="true" className="size-[18px] shrink-0" />
                    )}
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-sm font-semibold break-words">{i.name}</span>
                      <span className="text-muted-foreground font-mono text-xs [overflow-wrap:anywhere]" title={i.path}>
                        {i.path}
                      </span>
                      {i.status === 'changed' && (
                        <ChangesToggle open={opened.has(i.path)} itemPath={i.path} onClick={() => setOpened((set) => toggle(set, i.path))} />
                      )}
                    </span>
                    <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold', TONE[i.status])}>{statusText(i)}</span>
                  </div>
                  {opened.has(i.path) && <FieldDiff client={client} source={source} target={target} itemPath={i.path} />}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
