import { listOf } from '@/components/transfer/copy';
import type { Preflight } from '@/components/transfer/usePreflight';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { addLanguages, type LanguageFailure, type MissingLanguage } from '@/lib/checks';
import { Icon } from '@/lib/icon';
import { nameOf } from '@/lib/queue';
import type { Env, SdkClient } from '@/lib/sdk';
import { cn } from '@/lib/utils';
import { mdiCheckCircle, mdiLoading } from '@mdi/js';
import { useId, useState, type ReactNode } from 'react';

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

const Action = ({ label, onClick, disabled }: { label: string; onClick(): void; disabled?: boolean }) => (
  <Button type="button" variant="outline" size="sm" className="h-9 rounded-lg bg-white px-3 pointer-coarse:h-11" onClick={onClick} disabled={disabled}>
    {label}
  </Button>
);

type LanguagesNoteProps = {
  languages: MissingLanguage[];
  source: Env;
  target: Env;
  client?: SdkClient;
  /** Checks the target again once the languages are added. */
  recheck?(): Promise<void>;
};

/** The languages the source has and the target lacks, with a button that adds them on the target, then checks again. */
function LanguagesNote({ languages, source, target, client, recheck }: LanguagesNoteProps) {
  const [added, setAdded] = useState<number>();
  const [failed, setFailed] = useState<LanguageFailure[]>([]);
  const many = languages.length > 1;
  const add = async () => {
    setFailed([]);
    setAdded(0);
    try {
      const errors = await addLanguages(client!, target, languages, setAdded);
      await recheck?.();
      setFailed(errors);
    } finally {
      setAdded(undefined);
    }
  };
  const label =
    added === undefined
      ? `Add ${many ? 'them' : 'it'} to ${target.name}`
      : added < languages.length
        ? many ? `Adding ${added + 1} of ${languages.length}…` : 'Adding…'
        : 'Checking again…';
  return (
    <Note
      tone="warning"
      title={`${many ? 'Languages' : 'Language'} ${target.name} doesn't have`}
      action={client && <Action label={label} onClick={add} disabled={added !== undefined} />}
    >
      <span>{`${source.name} has ${listOf(languages.map((l) => l.label))}. ${target.name} doesn't, so versions of your items in ${many ? 'those languages' : 'that language'} may not show there until you add ${many ? 'them' : 'it'}.`}</span>
      {failed.map((f) => (
        <span key={f.label} role="alert" className="break-words">{`Couldn't add ${f.label}: ${f.error.replace(/\.?$/, '.')}`}</span>
      ))}
    </Note>
  );
}

type NotesProps = {
  preflight?: Preflight;
  source: Env;
  target: Env;
  /** False to leave out what only concerns the source (items it lacks, items not approved), when another target's notes already say it. */
  sourceNotes?: boolean;
  /** Lets the languages note add the missing languages on the target. */
  client?: SdkClient;
  onAddParents?(): void;
  onRemoveNotFound?(): void;
  onAddRelated?(): void;
};

/** The pre-flight result for the whole list: progress, a clean bill, or one note per kind of problem. Nothing here blocks Start. */
export function PreflightNotes({ preflight, source, target, sourceNotes = true, client, onAddParents, onRemoveNotFound, onAddRelated }: NotesProps) {
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
    return <Note tone="warning" title={`Couldn't run the pre-flight check on ${target.name}: ${preflight.error}. You can still start.`} />;
  }

  const checks = [...preflight.checks.values()];
  const found = checks.filter((c) => c.onSource);
  const notFound = sourceNotes ? checks.filter((c) => !c.onSource) : [];
  const missing = [...new Set(found.flatMap((c) => c.missingParents))];
  const otherParents = found.filter((c) => c.otherParents.length);
  const otherHere = found.filter((c) => c.onTarget === 'other');
  const deleted = found.filter((c) => c.deleted.length);
  // Related content: what the target lacks (or has as a different item) is listed; what it has is only counted.
  const related = preflight.related ?? [];
  const absent = related.filter((r) => r.onTarget !== 'same');
  const addable = absent.filter((r) => r.onTarget === 'new').length;
  const present = related.length - absent.length;
  const scanFailed = preflight.relatedError;
  const definitions = preflight.definitions ?? [];
  const definitionsFailed = preflight.definitionsError;
  const languages = preflight.languages ?? [];
  const languagesFailed = preflight.languagesError;
  const locked = preflight.locked ?? [];
  const lockedFailed = preflight.lockedError;
  // Like the items the source lacks, what the source says about the items is said once.
  const unapproved = sourceNotes ? (preflight.unapproved ?? []) : [];
  const unapprovedFailed = sourceNotes ? preflight.unapprovedError : undefined;

  if (
    !notFound.length &&
    !missing.length &&
    !otherParents.length &&
    !otherHere.length &&
    !deleted.length &&
    !absent.length &&
    !scanFailed &&
    !definitions.length &&
    !definitionsFailed &&
    !languages.length &&
    !languagesFailed &&
    !locked.length &&
    !lockedFailed &&
    !unapproved.length &&
    !unapprovedFailed
  ) {
    return (
      <div className="flex flex-col gap-1">
        <p role="status" className="text-success-700 flex items-center gap-2 text-sm font-medium">
          <Icon path={mdiCheckCircle} className="size-4" aria-hidden="true" />
          {`Pre-flight check: everything is in place on ${target.name}.`}
        </p>
        {present > 0 && (
          <p className="text-muted-foreground text-sm">{`${present} related ${present === 1 ? 'item is' : 'items are'} already on ${target.name}.`}</p>
        )}
      </div>
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
      {locked.length > 0 && (
        <Note tone="warning" title={`Locked on ${target.name}`}>
          <span>{`Someone may be editing ${locked.length > 1 ? 'them' : 'it'}; the transfer overwrites their changes.`}</span>
          <ul className="flex flex-col gap-1">
            {locked.map((l) => (
              <li key={l.itemPath} className="break-words">
                <span className={PATH}>{l.itemPath}</span>
                {l.lockedBy && ` · locked by ${l.lockedBy}`}
              </li>
            ))}
          </ul>
        </Note>
      )}
      {lockedFailed && <Note tone="warning" title={`Couldn't check for locked items on ${target.name}: ${lockedFailed.replace(/\.?$/, '.')} You can still start.`} />}
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
      {unapproved.length > 0 && (
        <Note tone="warning" title={`Not approved on ${source.name}`}>
          <span>{`The transfer copies ${unapproved.length > 1 ? 'them as they are' : 'it as it is'}.`}</span>
          <ul className="flex flex-col gap-1">
            {unapproved.map((u) => (
              <li key={u.itemPath} className="break-words">
                <span className={PATH}>{u.itemPath}</span>
                {` · in ${u.state}`}
              </li>
            ))}
          </ul>
        </Note>
      )}
      {unapprovedFailed && <Note tone="warning" title={`Couldn't check approval states on ${source.name}: ${unapprovedFailed.replace(/\.?$/, '.')} You can still start.`} />}
      {/* No add button: copying developer items through content would put them out of step with serialization. */}
      {definitions.length > 0 && (
        <Note tone="danger" title={`Missing on ${target.name}: templates and renderings`}>
          <span>{`Items that use them won't open or render properly on ${target.name}. They usually ship with a code deployment: deploy them to ${target.name} first.`}</span>
          <ul className="flex flex-col gap-1">
            {definitions.map((d) => (
              <li key={d.itemPath} className="break-words">
                {`${d.kind} `}
                <span className="font-semibold">{d.name}</span> <span className={PATH}>{d.itemPath}</span>
                {` · used by ${d.usedBy.map(nameOf).join(', ')}`}
              </li>
            ))}
          </ul>
        </Note>
      )}
      {definitionsFailed && <Note tone="warning" title={`Couldn't check templates and renderings for ${target.name}: ${definitionsFailed.replace(/\.?$/, '.')} You can still start.`} />}
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
      {absent.length > 0 && (
        <Note
          tone="warning"
          title={`Used by your items but not on ${target.name}`}
          action={onAddRelated && addable > 0 && <Action label={`Add ${addable} missing ${addable === 1 ? 'item' : 'items'}`} onClick={onAddRelated} />}
        >
          <span>They aren&apos;t in the list either, so the items that use them may show gaps:</span>
          <ul className="flex flex-col gap-1">
            {absent.map((r) => (
              <li key={r.itemPath} className="break-words">
                <span className="font-semibold">{r.name}</span> <span className={PATH}>{r.itemPath}</span>
                {` · used by ${r.usedBy.map(nameOf).join(', ')}`}
                {r.onTarget === 'other' && ` · a different item has this path on ${target.name}`}
              </li>
            ))}
          </ul>
          {present > 0 && <span>{`${present} more ${present === 1 ? 'is' : 'are'} already on ${target.name} (not added; ${present === 1 ? 'it' : 'they'} may be older there).`}</span>}
        </Note>
      )}
      {scanFailed && <Note tone="warning" title={`Couldn't scan for related content for ${target.name}: ${scanFailed.replace(/\.?$/, '.')} You can still start.`} />}
      {languages.length > 0 && <LanguagesNote languages={languages} source={source} target={target} client={client} recheck={preflight.recheck} />}
      {languagesFailed && <Note tone="warning" title={`Couldn't compare languages for ${target.name}: ${languagesFailed.replace(/\.?$/, '.')} You can still start.`} />}
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
  const done = preflight?.status === 'done' ? preflight : undefined;
  const c = done?.checks.get(itemPath);
  if (!c) return <span className="text-muted-foreground">—</span>;
  const [label, tone]: [string, keyof typeof CHIP] = !c.onSource
    ? [`Not on ${source.name}`, 'danger']
    : done?.definitions?.some((d) => d.templateOf.includes(itemPath))
      ? ['Template missing', 'danger']
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
