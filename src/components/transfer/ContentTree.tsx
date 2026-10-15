import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Icon } from '@/lib/icon';
import { fetchChildren, type Env, type SdkClient, type TreeNode } from '@/lib/sdk';
import { mdiChevronDown, mdiChevronRight, mdiFileOutline, mdiFolderOutline } from '@mdi/js';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

const ROOT = '/sitecore';

type Entry = TreeNode[] | 'loading' | { error: string };
type Props = {
  client: SdkClient;
  env: Env;
  selectedPaths: string[];
  onToggle(path: string, checked: boolean): void;
};

// Keyed by environment: switching env remounts the tree, which drops the cache, the expansion state and the filter,
// and lets Tree's unmount guard discard any response still in flight for the previous env.
export function ContentTree(props: Props) {
  return <Tree key={props.env.id} {...props} />;
}

function Tree({ client, env, selectedPaths, onToggle }: Props) {
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

  const check = (n: TreeNode) => (
    <Checkbox
      aria-label={`Select ${n.path}`}
      checked={selected.has(n.path)}
      onCheckedChange={(c) => onToggle(n.path, c === true)}
    />
  );
  const nodeIcon = (n: TreeNode) => (
    <Icon path={n.hasChildren ? mdiFolderOutline : mdiFileOutline} className="text-muted-foreground size-5 shrink-0" />
  );

  const row = (n: TreeNode, depth: number): ReactNode => (
    <Collapsible open={!!open[n.path]} onOpenChange={(o) => toggle(n.path, o)}>
      <div className="flex items-center gap-1.5 py-0.5 pr-2" style={{ paddingLeft: `${depth * 1.25}rem` }}>
        {n.hasChildren ? (
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`${open[n.path] ? 'Collapse' : 'Expand'} ${n.name}`}
            >
              <Icon path={open[n.path] ? mdiChevronDown : mdiChevronRight} />
            </Button>
          </CollapsibleTrigger>
        ) : (
          <span className="size-8 shrink-0" aria-hidden />
        )}
        {check(n)}
        {nodeIcon(n)}
        <span className="min-w-0 truncate text-sm" title={n.name}>
          {n.name}
        </span>
      </div>
      <CollapsibleContent>{branch(n.path, depth + 1)}</CollapsibleContent>
    </Collapsible>
  );

  const branch = (path: string, depth: number): ReactNode => {
    const entry = cache[path];
    const indent = { paddingLeft: `${depth * 1.25}rem` };
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
              <Button type="button" variant="link" size="xs" onClick={() => void load(path)}>
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
    <section className="flex flex-col gap-2">
      <Input
        aria-label="Filter loaded items"
        placeholder="Filter loaded items"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {/* Radix wraps the content in a `display: table` div (inline style), which grows to the widest row and defeats `truncate`; force it to a block. */}
      <ScrollArea className="h-96 rounded-md border [&>[data-slot=scroll-area-viewport]>div]:!block">
        <div className="p-1">
          {!query ? (
            branch(ROOT, 0)
          ) : matches.length === 0 ? (
            <p className="text-muted-foreground px-2 py-1 text-sm">No loaded items match.</p>
          ) : (
            <ul>
              {matches.map((n) => (
                <li key={n.path} className="flex items-center gap-1.5 px-2 py-1">
                  {check(n)}
                  {nodeIcon(n)}
                  <span className="min-w-0 truncate text-sm" title={n.name}>
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
