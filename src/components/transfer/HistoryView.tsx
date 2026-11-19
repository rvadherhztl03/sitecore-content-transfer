import { EnvironmentCards } from '@/components/transfer/EnvironmentCards';
import { ActionBar, AppHeader, BTN, MAIN, PageHeading } from '@/components/transfer/Layout';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { loadHistory, type HistoryEntry } from '@/lib/history';
import { Icon } from '@/lib/icon';
import { SCOPES, labelOf, mergesFor } from '@/lib/queue';
import type { Env, SdkClient } from '@/lib/sdk';
import { cn } from '@/lib/utils';
import { mdiArrowRight, mdiChevronDown } from '@mdi/js';
import { useEffect, useState } from 'react';

type Props = { client: SdkClient; envs: Env[]; onHome(): void };
type State = { entries: HistoryEntry[]; loading: boolean; error: string | null };

const PILL = 'inline-flex shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold';

function Entry({ entry }: { entry: HistoryEntry }) {
  const count = entry.itemCount ?? (entry.items.length || undefined);
  const ok = entry.result === 'success';
  const result = `${entry.kind === 'install' ? 'Install' : 'Transfer'} ${ok ? 'complete' : 'failed'}`;
  return (
    <li>
      <details className="group">
        <summary className="hover:bg-muted/50 flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3.5 [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-2 text-[15px] font-medium break-words">
              {entry.source ?? 'Package'}
              <Icon path={mdiArrowRight} className="text-primary size-4 shrink-0" aria-hidden="true" />
              <span className="sr-only">to</span>
              {entry.target}
            </span>
            <span className="text-muted-foreground text-[13px] break-words">
              <time dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time>
              {entry.by && ` · by ${entry.by}`}
              {count !== undefined && ` · ${count} ${count === 1 ? 'item' : 'items'}`}
            </span>
          </span>
          <span className={cn(PILL, ok ? 'bg-success-50 text-success-600' : 'bg-danger-50 text-danger-600')}>{result}</span>
          <Icon path={mdiChevronDown} className="text-muted-foreground size-5 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        {entry.items.length ? (
          <ul className="m-0 flex list-none flex-col gap-2 px-5 pt-1 pb-4">
            {entry.items.map((t) => (
              <li key={t.itemPath} className="flex flex-col gap-0.5">
                <span className="font-mono text-xs [overflow-wrap:anywhere]">{t.itemPath}</span>
                <span className="text-muted-foreground text-xs">{`${labelOf(SCOPES, t.scope, true)} · ${labelOf(mergesFor(t.scope), t.mergeStrategy, true)}`}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground px-5 pt-1 pb-4 text-sm">The package had no item list.</p>
        )}
      </details>
    </li>
  );
}

/** What was moved into each environment: pick one, and its recorded runs are listed newest first. */
export function HistoryView({ client, envs, onHome }: Props) {
  const [envId, setEnvId] = useState(envs[0]?.id);
  const [state, setState] = useState<State>({ entries: [], loading: true, error: null });
  const [attempt, setAttempt] = useState(0);
  const env = envs.find((e) => e.id === envId);

  useEffect(() => {
    if (!env) return;
    let alive = true;
    setState({ entries: [], loading: true, error: null });
    loadHistory(client, env).then(
      (entries) => alive && setState({ entries, loading: false, error: null }),
      (e) => alive && setState({ entries: [], loading: false, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      alive = false;
    };
  }, [client, env, attempt]);

  const { entries, loading, error } = state;
  const count = entries.length === 1 ? '1 run' : `${entries.length} runs`;

  return (
    <div className="bg-muted flex min-h-screen flex-col">
      <AppHeader crumb="Transfer history" onHome={onHome} />
      <main className={MAIN}>
        <PageHeading title="Transfer history" sub="See what was moved into each environment, who moved it and when." />
        <div className="flex flex-wrap items-start gap-5">
          <EnvironmentCards legend="Environment" name="history-env" envs={envs} value={env?.id} onChange={setEnvId} />
          {env && (
            <section aria-labelledby="history-runs" className="flex min-w-0 flex-[2_1_460px] flex-col overflow-hidden rounded-[14px] border bg-white">
              <div className="flex items-center justify-between gap-3 border-b px-5 py-[18px]">
                <h2 id="history-runs" className="text-base font-semibold break-words">{`Runs into ${env.name}`}</h2>
                {!loading && !error && <span className="text-muted-foreground text-[13px]">{count}</span>}
              </div>
              {loading ? (
                <div role="status" aria-label="Loading history" className="flex flex-col gap-3 p-5">
                  <Skeleton className="h-11" />
                  <Skeleton className="h-11" />
                  <Skeleton className="h-11" />
                </div>
              ) : error ? (
                <div className="p-5">
                  <Alert variant="danger">
                    <AlertTitle>{`Couldn't load the history of ${env.name}`}</AlertTitle>
                    <AlertDescription className="flex flex-wrap items-center gap-x-2">
                      <span className="min-w-0 break-words">{error}</span>
                      <Button type="button" variant="link" size="xs" className="pointer-coarse:h-11" onClick={() => setAttempt((n) => n + 1)}>
                        Retry
                      </Button>
                    </AlertDescription>
                  </Alert>
                </div>
              ) : entries.length === 0 ? (
                <p className="text-muted-foreground p-5 text-sm">{`No runs recorded in ${env.name} yet.`}</p>
              ) : (
                <ul aria-label={`Runs into ${env.name}`} className="m-0 list-none divide-y p-0">
                  {entries.map((e) => (
                    <Entry key={e.id} entry={e} />
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </main>
      <ActionBar summary={null}>
        <Button type="button" variant="outline" className={BTN} onClick={onHome}>
          Back
        </Button>
      </ActionBar>
    </div>
  );
}
