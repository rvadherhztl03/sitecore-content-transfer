import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Icon } from '@/lib/icon';
import { fetchChildren, type Env, type SdkClient, type TreeNode } from '@/lib/sdk';
import { cn } from '@/lib/utils';
import { mdiChevronDown, mdiChevronRight, mdiFileOutline, mdiFolderOutline, mdiMagnify } from '@mdi/js';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

const ROOT = '/sitecore';

type Entry = TreeNode[] | 'loading' | { error: string };
type Props = {
  client: SdkClient;
  env: Env;
  selectedPaths: string[];
  onToggle(path: string, checked: boolean): void;
  /** Card heading, e.g. `Browse Acme · Development`. */
  title?: string;
};

const ROW = 'flex min-h-10 items-center gap-2 rounded-lg pr-2.5 pointer-coarse:min-h-11';

// Keyed by environment: switching env remounts the tree, which drops the cache, the expansion state and the filter,
// and lets Tree's unmount guard discard any response still in flight for the previous env.
export function ContentTree(props: Props) {
  return <Tree key={props.env.id} {...props} />;
}

function Tree({ client, env, selectedPaths, onToggle, title }: Props) {
  const [cache, setCache] = useState<Record<string, Entry>>({ [ROOT]: 'loading' });
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState('');
  const alive = useRef(true);
  const selected = useMemo(() => new Set(selectedPaths), [selectedPaths]);

  const load = async (path: string) => {
    setCache((c) => ({ ...c, [path]: 'loading' }));
    let entry: Entry;
    try {
      entry = await fetchChildren(client, env, path);
    } catch (e) {
      entry = { error: e instanceof Error ? e.message : String(e) };
    }
    if (alive.current) setCache((c) => ({ ...c, [path]: entry }));
  };

  useEffect(() => {
    alive.current = true;
    void load(ROOT);
    return () => {
      alive.current = false;
    };
    // Mount only: this component is remounted per environment (see ContentTree).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (path: string, isOpen: boolean) => {
    setOpen((o) => ({ ...o, [path]: isOpen }));
    if (isOpen && !cache[path]) void load(path);
  };

  // The pseudo-element grows the tap target to 44px on touch screens without shifting the layout.
  const check = (n: TreeNode) => (
    <Checkbox
      aria-label={`Select ${n.path}`}
      className="relative size-[18px] pointer-coarse:after:absolute pointer-coarse:after:-inset-3.5"
      checked={selected.has(n.path)}
      onCheckedChange={(c) => onToggle(n.path, c === true)}
    />
  );
  const nodeIcon = (n: TreeNode) => (
    <Icon path={n.hasChildren ? mdiFolderOutline : mdiFileOutline} className="text-muted-foreground size-5 shrink-0" />
  );
  const rowTone = (n: TreeNode) => (selected.has(n.path) ? 'bg-primary-50' : 'hover:bg-neutral-bg');
  const nameClass = (n: TreeNode) => cn('min-w-0 truncate text-md', selected.has(n.path) && 'font-semibold');

  const row = (n: TreeNode, depth: number): ReactNode => (
    <Collapsible open={!!open[n.path]} onOpenChange={(o) => toggle(n.path, o)}>
      <div className={cn(ROW, rowTone(n))} style={{ paddingLeft: `${0.625 + depth * 1.25}rem` }}>
        {n.hasChildren ? (
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-7 rounded-md pointer-coarse:size-11"
              aria-label={`${open[n.path] ? 'Collapse' : 'Expand'} ${n.name}`}
            >
              <Icon path={open[n.path] ? mdiChevronDown : mdiChevronRight} />
            </Button>
          </CollapsibleTrigger>
        ) : (
          <span className="size-7 shrink-0 pointer-coarse:size-11" aria-hidden />
        )}
        {check(n)}
        {nodeIcon(n)}
        <span className={nameClass(n)} title={n.name}>
          {n.name}
        </span>
      </div>
      <CollapsibleContent>{branch(n.path, depth + 1)}</CollapsibleContent>
    </Collapsible>
  );

  const branch = (path: string, depth: number): ReactNode => {
    const entry = cache[path];
    const indent = { paddingLeft: `${0.625 + depth * 1.25}rem` };
    if (!entry || entry === 'loading') {
      return (
        <div role="status" aria-label="Loading" className="flex flex-col gap-1 py-1 pr-2" style={indent}>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-6 w-40" />
        </div>
      );
    }
    if (!Array.isArray(entry)) {
      return (
        <div className="py-1 pr-2" style={indent}>
          <Alert variant="danger" className="py-2">
            <AlertDescription className="flex flex-wrap items-center gap-x-2">
              <span className="min-w-0 break-words">{entry.error || "Couldn't load items."}</span>
              <Button type="button" variant="link" size="xs" className="pointer-coarse:h-11" onClick={() => void load(path)}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      );
    }
    if (entry.length === 0) {
      return (
        <p className="text-muted-foreground py-1 pr-2 text-sm" style={indent}>
          No items.
        </p>
      );
    }
    return (
      <ul>
        {entry.map((n) => (
          <li key={n.path}>{row(n, depth)}</li>
        ))}
      </ul>
    );
  };

  // A filter replaces the tree with a flat list; it only sees nodes that are already loaded.
  const query = filter.trim().toLowerCase();
  const matches = query
    ? Object.values(cache)
        .flatMap((e) => (Array.isArray(e) ? e : []))
        .filter((n) => n.name.toLowerCase().includes(query))
    : [];

  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-[14px] border bg-white">
      <div className="flex flex-col gap-2.5 border-b px-4 py-3.5">
        {title && <h2 className="text-[15px] font-semibold break-words">{title}</h2>}
        <div className="relative">
          <Icon path={mdiMagnify} className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2" aria-hidden />
          <Input
            aria-label="Filter loaded items"
            placeholder="Search loaded items"
            className="rounded-lg pl-10 text-sm pointer-coarse:h-11"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>
      {/* Radix wraps the content in a `display: table` div (inline style), which grows to the widest row and defeats `truncate`; force it to a block. */}
      <ScrollArea className="h-100 [&>[data-slot=scroll-area-viewport]>div]:!block">
        <div className="p-2">
          {!query ? (
            branch(ROOT, 0)
          ) : matches.length === 0 ? (
            <p className="text-muted-foreground px-2 py-1 text-sm">No loaded items match.</p>
          ) : (
            <ul>
              {matches.map((n) => (
                <li key={n.path} className={cn(ROW, 'pl-2.5', rowTone(n))}>
                  {check(n)}
                  {nodeIcon(n)}
                  <span className={nameClass(n)} title={n.name}>
                    {n.name}
                  </span>
                  <span className="text-muted-foreground min-w-0 truncate font-mono text-xs" title={n.path}>
                    {n.path}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </ScrollArea>
    </section>
  );
}
