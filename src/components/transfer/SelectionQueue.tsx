import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Icon } from '@/lib/icon';
import { MERGES, SCOPES, mergeTrees, newTree, parseQueueJson } from '@/lib/queue';
import type { DataTree, MergeStrategy, Scope } from '@/lib/transfer';
import { mdiClose, mdiPlus, mdiUpload } from '@mdi/js';
import { useRef, useState } from 'react';

type Props = { trees: DataTree[]; onChange(trees: DataTree[]): void; disabled?: boolean };

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
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-md mr-auto font-semibold">Selected ({trees.length})</h3>
        <Input
          aria-label="Add path"
          placeholder="/sitecore/content/…"
          className="w-64 font-mono"
          value={path}
          disabled={disabled}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addPath()}
        />
        <Button variant="outline" size="sm" disabled={disabled} onClick={addPath}>
          <Icon path={mdiPlus} />
          Add
        </Button>
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => fileRef.current?.click()}>
          <Icon path={mdiUpload} />
          Import JSON
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
        <Button variant="ghost" size="sm" disabled={disabled || trees.length === 0} onClick={() => onChange([])}>
          Clear all
        </Button>
      </div>

      {error && (
        <Alert variant="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {trees.length === 0 ? (
        <p className="text-muted-foreground text-sm">Pick items from the tree or paste a path.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {trees.map((t, i) => (
            <li key={t.itemPath} className="flex items-center gap-2 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-sm" title={t.itemPath}>
                {t.itemPath}
              </span>
              <Select value={t.scope} disabled={disabled} onValueChange={(v) => update(i, { scope: v as Scope })}>
                <SelectTrigger size="sm" aria-label={`Scope for ${t.itemPath}`}>
                  <SelectValue>{SCOPES.find((s) => s.value === t.scope)?.label}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {SCOPES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={t.mergeStrategy}
                disabled={disabled}
                onValueChange={(v) => update(i, { mergeStrategy: v as MergeStrategy })}
              >
                <SelectTrigger size="sm" aria-label={`Merge for ${t.itemPath}`}>
                  <SelectValue>{MERGES.find((m) => m.value === t.mergeStrategy)?.label}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {MERGES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${t.itemPath}`}
                disabled={disabled}
                onClick={() => onChange(trees.filter((_, j) => j !== i))}
              >
                <Icon path={mdiClose} />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
