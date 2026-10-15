import { Alert, AlertDescription } from '@/components/ui/alert';
import { Icon } from '@/lib/icon';
import { type PackageItem, type PackagePart, readPackage } from '@/lib/package';
import { MERGES, SCOPES, labelOf } from '@/lib/queue';
import { mdiFileUploadOutline } from '@mdi/js';
import { useState } from 'react';

export type LoadedPackage = { fileName: string; items: PackageItem[]; parts: PackagePart[] };

type Props = { disabled?: boolean; onPackage(pkg: LoadedPackage | null): void };

export function ImportPanel({ disabled, onPackage }: Props) {
  const [pkg, setPkg] = useState<LoadedPackage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = disabled || busy;

  const load = async (file: File | undefined) => {
    if (!file || locked) return;
    setBusy(true);
    setError(null);
    try {
      const next = { fileName: file.name, ...(await readPackage(file)) };
      setPkg(next);
      onPackage(next);
    } catch (err) {
      setPkg(null);
      setError(err instanceof Error ? err.message : String(err));
      onPackage(null);
    } finally {
      setBusy(false);
    }
  };

  const chunks = pkg?.parts.reduce((n, p) => n + p.chunks.length, 0) ?? 0;

  return (
    <section className="flex flex-col gap-3">
      <label
        aria-disabled={locked}
        className="text-muted-foreground has-[:focus-visible]:ring-primary/50 hover:bg-neutral-bg flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed p-6 text-center text-sm has-[:focus-visible]:ring-[3px] aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          load(e.dataTransfer.files[0]);
        }}
      >
        <Icon path={mdiFileUploadOutline} className="size-6" aria-hidden />
        <span>Drop a package here, or click to choose a .zip or .raif file</span>
        <input
          type="file"
          accept=".zip,.raif"
          aria-label="Package file"
          className="sr-only"
          disabled={locked}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            load(file);
          }}
        />
      </label>

      {error && (
        <Alert variant="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {pkg && (
        <>
          <p className="text-sm font-semibold">
            <span className="font-mono">{pkg.fileName}</span> · {chunks} {chunks === 1 ? 'chunk' : 'chunks'}
          </p>
          {pkg.items.length === 0 ? (
            <p className="text-muted-foreground text-sm">No metadata in this package.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-muted-foreground border-b">
                  <th className="py-1 pr-3 font-medium">Path</th>
                  <th className="py-1 pr-3 font-medium">Scope</th>
                  <th className="py-1 font-medium">Merge</th>
                </tr>
              </thead>
              <tbody>
                {pkg.items.map((i, n) => (
                  <tr key={`${i.id}-${n}`} className="border-b last:border-0">
                    <td className="max-w-0 truncate py-1 pr-3 font-mono" title={i.path}>
                      {i.path}
                    </td>
                    <td className="py-1 pr-3">{labelOf(SCOPES, i.scope, true)}</td>
                    <td className="py-1">{labelOf(MERGES, i.mergeStrategy, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
