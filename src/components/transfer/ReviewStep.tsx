import { cancelNote, listOf, treeWarning } from '@/components/transfer/copy';
import { EnvBadge } from '@/components/transfer/EnvironmentCards';
import { ChangesToggle, FieldDiff } from '@/components/transfer/FieldDiff';
import { PageHeading } from '@/components/transfer/Layout';
import { PreflightNotes, PreflightStatus } from '@/components/transfer/Preflight';
import type { Preflight } from '@/components/transfer/usePreflight';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Icon } from '@/lib/icon';
import { addMissingParents, removeNotFound } from '@/lib/preflight';
import { addRelated } from '@/lib/related';
import { SCOPES, labelOf, mergesFor, nameOf } from '@/lib/queue';
import { envKind, type Env, type SdkClient } from '@/lib/sdk';
import type { DataTree } from '@/lib/transfer';
import { cn } from '@/lib/utils';
import { mdiArrowRight, mdiDatabaseOutline } from '@mdi/js';
import { Fragment, useId, useState } from 'react';

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

type ChoiceProps = { title: string; hint: string; checked: boolean; onChange(v: boolean): void };

// A checkbox card: the title names the checkbox, the hint describes it.
function Choice({ title, hint, checked, onChange }: ChoiceProps) {
  const id = useId();
  return (
    <div className="flex items-start gap-3 rounded-xl border bg-white px-4 py-3.5">
      <Checkbox
        id={id}
        aria-describedby={`${id}-hint`}
        className="relative mt-0.5 size-[18px] pointer-coarse:after:absolute pointer-coarse:after:-inset-3.5"
        checked={checked}
        onCheckedChange={(c) => onChange(c === true)}
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <Label htmlFor={id} className="cursor-pointer leading-snug font-semibold break-words">
          {title}
        </Label>
        <span id={`${id}-hint`} className="text-muted-foreground text-[13px] leading-normal">
          {hint}
        </span>
      </div>
    </div>
  );
}

/** `targets`: the ones it backs up when `available`, every target otherwise. */
type BackupChoiceProps = { targets: Env[]; available: boolean; checked: boolean; onChange(v: boolean): void };

/** "Back up <targets> first": on by default; when nothing on the targets would be overwritten, it says so instead. */
export function BackupChoice({ targets, available, ...choice }: BackupChoiceProps) {
  const names = listOf(targets.map((t) => t.name));
  if (!available) return <p className="text-muted-foreground text-sm">{`Nothing on ${names} to back up.`}</p>;
  return (
    <Choice
      title={`Back up ${names} first`}
      hint={`Saves what this transfer overwrites on ${names} as ${targets.length > 1 ? 'a package each' : 'a package'}, so you can restore it with Install a package. Large trees take longer.`}
      {...choice}
    />
  );
}

type PublishChoiceProps = { targets: Env[]; checked: boolean; onChange(v: boolean): void };

/** "Publish to Experience Edge when done": off by default, since it makes the content live. */
export function PublishChoice({ targets, ...choice }: PublishChoiceProps) {
  const names = listOf(targets.map((t) => t.name));
  const each = targets.length > 1 ? 'each of them has' : `${names} has`;
  return (
    <Choice
      title="Publish to Experience Edge when done"
      hint={`Publishes the transferred items on ${names} once the import finishes, in every language ${each}. Only changed items are sent.`}
      {...choice}
    />
  );
}

const CARD = {
  from: { box: 'bg-muted', tile: 'border bg-white text-neutral-fg', label: 'text-muted-foreground' },
  to: { box: 'border border-primary-200 bg-primary-50', tile: 'bg-primary text-inverse-text', label: 'text-primary-600' },
};

// `label` overrides From / To, e.g. to give several targets their order.
function RouteCard({ kind, env, detail, label }: { kind: keyof typeof CARD; env: Env; detail: string; label?: string }) {
  const tone = CARD[kind];
  return (
    <div className={cn('flex min-w-0 items-center gap-3.5 rounded-xl p-4', tone.box)}>
      <span className={cn('grid size-11 shrink-0 place-items-center rounded-xl', tone.tile)}>
        <Icon path={mdiDatabaseOutline} className="size-[22px]" aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn('text-xs font-semibold tracking-wider uppercase', tone.label)}>{label ?? (kind === 'from' ? 'From' : 'To')}</span>
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
  /** Where a transfer writes, in order (transfer only). */
  targets?: Env[];
  database: string;
  trees: DataTree[];
  /** The ids of the production targets whose box is ticked. */
  prodChecked: string[];
  onProdChecked(target: Env, v: boolean): void;
  onEdit(): void;
  /** The pre-flight check of each target, by id (transfer only). */
  preflights?: Record<string, Preflight>;
  /** Lets the pre-flight notes fix the list: add missing parents, remove items the source lacks. */
  onTreesChange?(trees: DataTree[]): void;
  /** The "Back up <targets> first" choice (transfer only). */
  backup?: BackupChoiceProps;
  /** The "Publish to Experience Edge when done" choice (transfer only). */
  publish?: Omit<PublishChoiceProps, 'targets'>;
  /** Reads field values for "Show changes" on items the transfer overwrites (transfer only). */
  client?: SdkClient;
};

/** What will be written, before it is: route, replace warning, production confirmation and the items. */
export function ReviewStep({ mode, source, targets = [], database, trees, prodChecked, onProdChecked, onEdit, preflights, onTreesChange, backup, publish, client }: Props) {
  const to = mode === 'transfer' ? targets : [];
  const many = to.length > 1;
  const names = listOf(to.map((t) => t.name));
  const checksOf = (t: Env) => {
    const p = preflights?.[t.id];
    return p?.status === 'done' ? p : undefined;
  };
  // The list is shared, so a fix found on one target changes what every target gets.
  const fix = (t: Env, f: typeof addMissingParents) => {
    const checks = checksOf(t)?.checks;
    return checks && onTreesChange ? () => onTreesChange(f(trees, checks)) : undefined;
  };
  const replacing = trees.filter((t) => t.mergeStrategy === 'OverrideExistingTree').length;
  const detail = (env: Env, text: string) => [env.tenantName, text].filter(Boolean).join(' · ');
  // The field diffs that are open, as `<target id>|<path>`: only the same item on a target, about to be overwritten, has one.
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const diffable = (t: DataTree, env: Env) =>
    !!client && checksOf(env)?.checks.get(t.itemPath)?.onTarget === 'same' && t.mergeStrategy !== 'KeepExistingItem';
  const isOpen = (t: DataTree, env: Env) => diffable(t, env) && opened.has(`${env.id}|${t.itemPath}`);
  const toggle = (k: string) =>
    setOpened((set) => {
      const next = new Set(set);
      if (!next.delete(k)) next.add(k);
      return next;
    });

  return (
    <div className="flex flex-col gap-5">
      {mode === 'transfer' ? (
        <PageHeading title="Ready to transfer" sub="Nothing has been written yet. Check the route and items, then start." />
      ) : (
        <PageHeading title="Ready to export" sub="Check the items, then create the package." />
      )}

      <section
        aria-label="Route"
        className={cn('grid items-center gap-4 rounded-[14px] border bg-white p-5', to.length > 0 && 'sm:grid-cols-[1fr_auto_1fr]')}
      >
        <RouteCard kind="from" env={source} detail={detail(source, 'reads from master')} />
        {to.length > 0 && (
          <>
            <Icon path={mdiArrowRight} className="text-primary size-7 shrink-0 justify-self-center rotate-90 sm:rotate-0" aria-hidden="true" />
            <div className="flex min-w-0 flex-col gap-3">
              {/* In write order: the transfer reaches each in turn. */}
              {to.map((t, i) => (
                <RouteCard key={t.id} kind="to" env={t} detail={detail(t, `writes to ${database}`)} label={i > 0 ? 'Then to' : undefined} />
              ))}
            </div>
          </>
        )}
      </section>

      {to.length > 0 && replacing > 0 && (
        <Alert variant="warning" role="note" className="border-warning-200 bg-warning-50 text-warning-700 items-start rounded-xl border px-4 py-3.5">
          <AlertDescription>
            <strong className="font-semibold break-words">
              {treeWarning(replacing, names)}
            </strong>
          </AlertDescription>
        </Alert>
      )}

      {to.map((t) => {
        const related = checksOf(t)?.related;
        return (
          <PreflightNotes
            key={t.id}
            preflight={preflights?.[t.id]}
            source={source}
            target={t}
            // What concerns only the source is said once, with the first finished check.
            sourceNotes={t.id === to.find(checksOf)?.id}
            onAddParents={fix(t, addMissingParents)}
            onRemoveNotFound={fix(t, removeNotFound)}
            onAddRelated={related && onTreesChange ? () => onTreesChange(addRelated(trees, related)) : undefined}
          />
        );
      })}

      {to.length > 0 && backup && <BackupChoice {...backup} />}

      {to.length > 0 && publish && <PublishChoice targets={to} {...publish} />}

      {to.filter(needsProdConfirm).map((t) => (
        <ProdConfirm key={t.id} target={t} checked={prodChecked.includes(t.id)} onChange={(v) => onProdChecked(t, v)} />
      ))}

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
                {to.map((t) => (
                  <th key={t.id} scope="col" className={TH}>
                    {`On ${t.name}`}
                  </th>
                ))}
                <th scope="col" className={TH}>
                  Includes
                </th>
                <th scope="col" className={TH}>
                  {to.length === 1 ? `If it exists on ${names}` : 'If it exists'}
                </th>
              </tr>
            </thead>
            <tbody className="[&>tr:last-child>td]:border-b-0">
              {trees.map((t) => {
                const open = to.filter((env) => isOpen(t, env));
                return (
                  <Fragment key={t.itemPath}>
                    <tr className={cn(open.length > 0 && '[&>td]:border-b-0')}>
                      <td className={TD}>
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="font-semibold break-words">{nameOf(t.itemPath)}</span>
                          <span className="text-muted-foreground font-mono text-xs [overflow-wrap:anywhere]" title={t.itemPath}>
                            {t.itemPath}
                          </span>
                        </span>
                      </td>
                      {to.map((env) => (
                        <td key={env.id} className={TD}>
                          <span className="flex flex-col items-start gap-1">
                            <PreflightStatus preflight={preflights?.[env.id]} itemPath={t.itemPath} source={source} />
                            {diffable(t, env) && (
                              <ChangesToggle
                                open={isOpen(t, env)}
                                itemPath={t.itemPath}
                                target={many ? env.name : undefined}
                                onClick={() => toggle(`${env.id}|${t.itemPath}`)}
                              />
                            )}
                          </span>
                        </td>
                      ))}
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
                    {open.map((env) => (
                      <tr key={env.id}>
                        <td colSpan={3 + to.length} className="border-b px-4 pb-3.5 align-top">
                          <FieldDiff client={client!} source={source} target={env} itemPath={t.itemPath} />
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {to.length > 0 && (
        <p className="text-muted-foreground text-[13px] leading-normal">
          {cancelNote(to[0].name)}
        </p>
      )}
    </div>
  );
}
