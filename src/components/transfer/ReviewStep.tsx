import { cancelNote, treeWarning } from '@/components/transfer/copy';
import { EnvBadge } from '@/components/transfer/EnvironmentCards';
import { PageHeading } from '@/components/transfer/Layout';
import { PreflightNotes, PreflightStatus } from '@/components/transfer/Preflight';
import type { Preflight } from '@/components/transfer/usePreflight';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Icon } from '@/lib/icon';
import { addMissingParents, removeNotFound } from '@/lib/preflight';
import { SCOPES, labelOf, mergesFor, nameOf } from '@/lib/queue';
import { envKind, type Env } from '@/lib/sdk';
import type { DataTree } from '@/lib/transfer';
import { cn } from '@/lib/utils';
import { mdiArrowRight, mdiDatabaseOutline } from '@mdi/js';
import { useId } from 'react';

export const needsProdConfirm = (target?: Env): boolean => !!target && envKind(target) === 'prod';

type ProdConfirmProps = { target: Env; checked: boolean; onChange(v: boolean): void };

export function ProdConfirm({ target, checked, onChange }: ProdConfirmProps) {
  const id = useId();
  return (
    <Alert variant="danger" className="border-danger-200 items-start rounded-xl border px-4 py-3.5">
      <AlertDescription className="gap-2.5">
        <strong className="font-semibold break-words">{`${target.name} looks like a production environment.`}</strong>
        <Label htmlFor={id} className="cursor-pointer items-start leading-snug pointer-coarse:min-h-11 pointer-coarse:items-center">
          {/* The pseudo-element grows the tap target to 44px on touch screens without shifting the layout. */}
          <Checkbox
            id={id}
            className="relative mt-px size-[18px] bg-white pointer-coarse:mt-0 pointer-coarse:after:absolute pointer-coarse:after:-inset-3.5"
            checked={checked}
            onCheckedChange={(c) => onChange(c === true)}
          />
          <span className="break-words">{`I understand this writes to ${target.name}`}</span>
        </Label>
      </AlertDescription>
    </Alert>
  );
}

const CARD = {
  from: { box: 'bg-muted', tile: 'border bg-white text-neutral-fg', label: 'text-muted-foreground' },
  to: { box: 'border border-primary-200 bg-primary-50', tile: 'bg-primary text-inverse-text', label: 'text-primary-600' },
};

function RouteCard({ kind, env, detail }: { kind: keyof typeof CARD; env: Env; detail: string }) {
  const tone = CARD[kind];
  return (
    <div className={cn('flex min-w-0 items-center gap-3.5 rounded-xl p-4', tone.box)}>
      <span className={cn('grid size-11 shrink-0 place-items-center rounded-xl', tone.tile)}>
        <Icon path={mdiDatabaseOutline} className="size-[22px]" aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn('text-xs font-semibold tracking-wider uppercase', tone.label)}>{kind === 'from' ? 'From' : 'To'}</span>
        <span className="text-base font-semibold break-words" title={env.name}>
          {env.name}
        </span>
        <span className="text-muted-foreground font-mono text-xs break-all" title={detail}>
          {detail}
        </span>
      </span>
      <EnvBadge env={env} />
    </div>
  );
}

const PILL = 'inline-block rounded-full px-2.5 py-1 text-xs font-semibold';
const TH = 'text-muted-foreground border-b px-4 py-2.5 text-left text-xs font-semibold tracking-wider uppercase';
const TD = 'border-b px-4 py-3.5 align-top';

type Props = {
  mode: 'transfer' | 'export';
  source: Env;
  target?: Env;
  database: string;
  trees: DataTree[];
  prodChecked: boolean;
  onProdChecked(v: boolean): void;
  onEdit(): void;
  /** The pre-flight check of the target (transfer only). */
  preflight?: Preflight;
  /** Lets the pre-flight notes fix the list: add missing parents, remove items the source lacks. */
  onTreesChange?(trees: DataTree[]): void;
};

/** What will be written, before it is: route, replace warning, production confirmation and the items. */
export function ReviewStep({ mode, source, target, database, trees, prodChecked, onProdChecked, onEdit, preflight, onTreesChange }: Props) {
  const to = mode === 'transfer' ? target : undefined;
  const checks = preflight?.status === 'done' ? preflight.checks : undefined;
  const fix = (f: typeof addMissingParents) => (checks && onTreesChange ? () => onTreesChange(f(trees, checks)) : undefined);
  const replacing = trees.filter((t) => t.mergeStrategy === 'OverrideExistingTree').length;
  const detail = (env: Env, text: string) => [env.tenantName, text].filter(Boolean).join(' · ');

  return (
    <div className="flex flex-col gap-5">
      {mode === 'transfer' ? (
        <PageHeading title="Ready to transfer" sub="Nothing has been written yet. Check the route and items, then start." />
      ) : (
        <PageHeading title="Ready to export" sub="Check the items, then create the package." />
      )}

      <section
        aria-label="Route"
        className={cn('grid items-center gap-4 rounded-[14px] border bg-white p-5', to && 'sm:grid-cols-[1fr_auto_1fr]')}
      >
        <RouteCard kind="from" env={source} detail={detail(source, 'reads from master')} />
        {to && (
          <>
            <Icon path={mdiArrowRight} className="text-primary size-7 shrink-0 justify-self-center rotate-90 sm:rotate-0" aria-hidden="true" />
            <RouteCard kind="to" env={to} detail={detail(to, `writes to ${database}`)} />
          </>
        )}
      </section>

      {to && replacing > 0 && (
        <Alert variant="warning" role="note" className="border-warning-200 bg-warning-50 text-warning-700 items-start rounded-xl border px-4 py-3.5">
          <AlertDescription>
            <strong className="font-semibold break-words">
              {treeWarning(replacing, to.name)}
            </strong>
          </AlertDescription>
        </Alert>
      )}

      {to && (
        <PreflightNotes preflight={preflight} source={source} target={to} onAddParents={fix(addMissingParents)} onRemoveNotFound={fix(removeNotFound)} />
      )}

      {to && needsProdConfirm(to) && <ProdConfirm target={to} checked={prodChecked} onChange={onProdChecked} />}

      <section className="overflow-hidden rounded-[14px] border bg-white">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <h2 className="text-base font-semibold">{mode === 'transfer' ? 'Items to copy' : 'Items to package'}</h2>
          <Button type="button" variant="link" size="sm" className="h-9 px-2 text-sm pointer-coarse:h-11" onClick={onEdit}>
            Edit
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr>
                <th scope="col" className={TH}>
                  Item
                </th>
                {to && (
                  <th scope="col" className={TH}>
                    {`On ${to.name}`}
                  </th>
                )}
                <th scope="col" className={TH}>
                  Includes
                </th>
                <th scope="col" className={TH}>
                  {to ? `If it exists on ${to.name}` : 'If it exists'}
                </th>
              </tr>
            </thead>
            <tbody className="[&>tr:last-child>td]:border-b-0">
              {trees.map((t) => (
                <tr key={t.itemPath}>
                  <td className={TD}>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-semibold break-words">{nameOf(t.itemPath)}</span>
                      <span className="text-muted-foreground font-mono text-xs [overflow-wrap:anywhere]" title={t.itemPath}>
                        {t.itemPath}
                      </span>
                    </span>
                  </td>
                  {to && (
                    <td className={TD}>
                      <PreflightStatus preflight={preflight} itemPath={t.itemPath} source={source} />
                    </td>
                  )}
                  <td className={TD}>
                    <span className={cn(PILL, t.scope !== 'SingleItem' ? 'bg-primary-100 text-primary-700' : 'bg-neutral-bg text-neutral-fg')}>
                      {labelOf(SCOPES, t.scope, true)}
                    </span>
                  </td>
                  <td className={TD}>
                    <span className={cn(PILL, t.mergeStrategy === 'OverrideExistingTree' ? 'bg-warning-50 text-warning-600' : 'bg-neutral-bg text-neutral-fg')}>
                      {labelOf(mergesFor(t.scope), t.mergeStrategy, true)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {to && (
        <p className="text-muted-foreground text-[13px] leading-normal">
          {cancelNote(to.name)}
        </p>
      )}
    </div>
  );
}
