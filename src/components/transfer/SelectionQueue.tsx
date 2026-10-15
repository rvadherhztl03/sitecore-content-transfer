import { Segmented } from '@/components/transfer/Segmented';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Icon } from '@/lib/icon';
import { MERGES, SCOPES, labelOf, mergeTrees, mergesFor, nameOf, newTree, parseQueueJson, withScope } from '@/lib/queue';
import type { DataTree, MergeStrategy, Scope } from '@/lib/transfer';
import { mdiClose } from '@mdi/js';
import { useRef, useState } from 'react';

type Props = { trees: DataTree[]; onChange(trees: DataTree[]): void; disabled?: boolean };

const BTN = 'h-9 rounded-lg px-3 pointer-coarse:h-11';

export function SelectionQueue({ trees, onChange, disabled }: Props) {
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const add = (incoming: DataTree[]) => {
    const merged = mergeTrees(trees, incoming);
    if (merged.length !== trees.length) onChange(merged);
  };
  const update = (index: number, patch: Partial<DataTree>) =>
    onChange(trees.map((t, i) => (i === index ? { ...t, ...patch } : t)));

  const addPath = () => {
    const value = path.trim();
    if (!value) return;
    add([newTree(value)]);
    setPath('');
  };

  const importFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    try {
      add(parseQueueJson(await file.text()));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-[14px] border bg-white">
      <div className="flex flex-col gap-2.5 border-b px-4 py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-[15px] font-semibold">
            Selected{' '}
            <span className="bg-primary-100 text-primary-700 grid h-[22px] min-w-[22px] place-items-center rounded-full px-1.5 text-xs font-semibold">
              {trees.length}
            </span>
          </h2>
          <div className="flex gap-1.5">
            <Button type="button" variant="outline" size="sm" className={BTN} disabled={disabled} onClick={() => fileRef.current?.click()}>
              Import list
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              aria-label="Import JSON file"
              className="hidden"
              tabIndex={-1}
              onChange={importFile}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={`${BTN} text-muted-foreground`}
              disabled={disabled || trees.length === 0}
              onClick={() => onChange([])}
            >
              Clear all
            </Button>
          </div>
        </div>
        <div className="flex gap-2">
          <Input
            aria-label="Add by path"
            placeholder="/sitecore/content/…"
            className="rounded-lg font-mono text-sm pointer-coarse:h-11"
            value={path}
            disabled={disabled}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addPath()}
          />
          <Button type="button" variant="outline" size="sm" className="h-10 rounded-lg px-3.5 pointer-coarse:h-11" disabled={disabled} onClick={addPath}>
            Add
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2.5 p-3">
        {error && (
          <Alert variant="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {trees.length === 0 ? (
          <p className="text-muted-foreground px-1 py-2 text-sm">Pick items from the tree or paste a path.</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {trees.map((t, i) => (
              <li key={t.itemPath} className="flex flex-col gap-3 rounded-xl border p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-md font-semibold break-words">{nameOf(t.itemPath)}</span>
                    <span className="text-muted-foreground font-mono text-xs [overflow-wrap:anywhere]" title={t.itemPath}>
                      {t.itemPath}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="rounded-lg pointer-coarse:size-11"
                    aria-label={`Remove ${t.itemPath}`}
                    disabled={disabled}
                    onClick={() => onChange(trees.filter((_, j) => j !== i))}
                  >
                    <Icon path={mdiClose} />
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <Segmented
                    size="sm"
                    label={`Include for ${t.itemPath}`}
                    value={t.scope}
                    options={SCOPES}
                    disabled={disabled}
                    onChange={(v) => update(i, withScope(t, v as Scope))}
                  />
                  <div className="text-muted-foreground flex max-w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
                    <span className="shrink-0">If it exists</span>
                    <Select value={t.mergeStrategy} disabled={disabled} onValueChange={(v) => update(i, { mergeStrategy: v as MergeStrategy })}>
                      <SelectTrigger aria-label={`If ${t.itemPath} exists`} className="max-w-full min-w-0 rounded-lg text-sm data-[size=default]:pointer-coarse:h-11 *:data-[slot=select-value]:block *:data-[slot=select-value]:truncate">
                        <SelectValue>{labelOf(MERGES, t.mergeStrategy)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {mergesFor(t.scope).map((m) => (
                          <SelectItem key={m.value} value={m.value}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
