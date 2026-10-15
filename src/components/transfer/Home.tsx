import { EnvBadge } from '@/components/transfer/EnvironmentCards';
import { BTN, MAIN } from '@/components/transfer/Layout';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Icon } from '@/lib/icon';
import type { Env } from '@/lib/sdk';
import { cn } from '@/lib/utils';
import { mdiDatabaseArrowRight, mdiDownload, mdiUpload } from '@mdi/js';

export type Screen = 'transfer' | 'export' | 'install';
type Props = { envs: Env[]; loading: boolean; error: string | null; onRetry(): void; onOpen(screen: Screen): void };

const ONE_ENV = 'Grant this app access to another environment in Cloud Portal to transfer between environments.';
const MISSING_ENV = 'Missing an environment? Grant this app access to it in Cloud Portal, then reopen the app.';

const STEPS = [
  ['Choose a route', 'Where content comes from, and where it goes.'],
  ['Pick content', 'Tick items in the tree or paste paths.'],
  ['Review', 'See exactly what will be written.'],
  ['Watch it run', 'Live progress, step by step.'],
];

const CARDS = [
  {
    screen: 'transfer',
    icon: mdiDatabaseArrowRight,
    title: 'Transfer between environments',
    body: 'Copy items — and everything under them — straight from one environment into another.',
    action: 'Start a transfer',
  },
  {
    screen: 'export',
    icon: mdiDownload,
    title: 'Export a package',
    body: 'Download selected items as a .zip you can keep, review, or install later.',
    action: 'Create a package',
  },
  {
    screen: 'install',
    icon: mdiUpload,
    title: 'Install a package',
    body: 'Upload a .zip or .raif package and install it into one of your environments.',
    action: 'Install a package',
  },
] as const;

/** The start screen: what to do, and which environments the app can reach. */
export function Home({ envs, loading, error, onRetry, onOpen }: Props) {
  const ready = !loading && !error;
  // Export and install need one environment; a transfer needs two.
  const canOpen = (screen: Screen) => ready && envs.length >= (screen === 'transfer' ? 2 : 1);

  return (
    <main className={cn(MAIN, 'gap-8 pt-10 pb-14')}>
      <section className="flex flex-col gap-2">
        <h1 className="text-[30px] leading-tight font-semibold tracking-tight">What would you like to do?</h1>
        <p className="text-muted-foreground max-w-[680px] text-base">
          Move items between your XM Cloud environments. You pick environments by name — no client IDs, secrets or hosts.
        </p>
      </section>

      <section aria-label="Actions" className="flex flex-wrap gap-5">
        {CARDS.map(({ screen, icon, title, body, action }) => {
          const primary = screen === 'transfer';
          // Only the transfer can be blocked by having too few environments, and says why.
          const note = primary && ready && envs.length < 2;
          return (
            <article
              key={screen}
              className={cn(
                'flex min-w-0 flex-[1_1_300px] flex-col gap-4 rounded-[14px] border bg-white p-6',
                primary && 'border-primary shadow-[0_1px_2px_rgba(20,20,40,0.04),0_8px_24px_rgba(110,63,255,0.08)]',
              )}
            >
              <span className={cn('grid size-12 place-items-center rounded-xl', primary ? 'bg-primary-100 text-primary-700' : 'bg-neutral-bg text-neutral-fg')}>
                <Icon path={icon} className="size-[26px]" aria-hidden="true" />
              </span>
              <div className="flex flex-col gap-1.5">
                <h2 className="text-lg font-semibold">{title}</h2>
                <p className="text-muted-foreground text-sm">{body}</p>
                {note && (
                  <p id="one-env" className="text-warning-600 text-sm">
                    {ONE_ENV}
                  </p>
                )}
              </div>
              <div className="mt-auto">
                <Button
                  type="button"
                  variant={primary ? 'default' : 'outline'}
                  className={BTN}
                  disabled={!canOpen(screen)}
                  aria-describedby={note ? 'one-env' : undefined}
                  onClick={() => onOpen(screen)}
                >
                  {action}
                </Button>
              </div>
            </article>
          );
        })}
      </section>

      <section className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[2_1_460px] flex-col overflow-hidden rounded-[14px] border bg-white">
          <div className="flex items-center justify-between gap-3 border-b px-5 py-[18px]">
            <h2 className="text-base font-semibold">Environments this app can reach</h2>
            {ready && <span className="text-muted-foreground text-[13px]">{envs.length}</span>}
          </div>
          {loading ? (
            <div role="status" aria-label="Loading environments" className="flex flex-col gap-3 p-5">
              <Skeleton className="h-11" />
              <Skeleton className="h-11" />
              <Skeleton className="h-11" />
            </div>
          ) : error ? (
            <div className="p-5">
              <Alert variant="danger">
                <AlertTitle>Couldn&apos;t load environments</AlertTitle>
                <AlertDescription className="flex flex-wrap items-center gap-x-2">
                  <span className="min-w-0 break-words">{error}</span>
                  <Button type="button" variant="link" size="xs" onClick={onRetry}>
                    Retry
                  </Button>
                </AlertDescription>
              </Alert>
            </div>
          ) : envs.length === 0 ? (
            <div className="p-5">
              <Alert variant="warning">
                <AlertDescription>{MISSING_ENV}</AlertDescription>
              </Alert>
            </div>
          ) : (
            <>
              <ul aria-label="Environments" className="m-0 list-none divide-y p-0">
                {envs.map((env) => (
                  <li key={env.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-[15px] font-medium break-words" title={env.name}>
                        {env.name}
                      </span>
                      {env.tenantName && (
                        <span className="text-muted-foreground font-mono text-xs break-all" title={env.tenantName}>
                          {env.tenantName}
                        </span>
                      )}
                    </span>
                    <EnvBadge env={env} />
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground bg-muted/50 border-t px-5 py-3.5 text-[13px]">{MISSING_ENV}</p>
            </>
          )}
        </div>

        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-4 rounded-[14px] border bg-white p-5">
          <h2 className="text-base font-semibold">How a transfer works</h2>
          <ol className="m-0 flex list-none flex-col gap-3.5 p-0">
            {STEPS.map(([label, hint], i) => (
              <li key={label} className="flex items-start gap-3">
                <span aria-hidden="true" className="bg-primary-100 text-primary-700 grid size-[26px] shrink-0 place-items-center rounded-full text-[13px] font-semibold">
                  {i + 1}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{label}</span>
                  <span className="text-muted-foreground text-[13px]">{hint}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </main>
  );
}
