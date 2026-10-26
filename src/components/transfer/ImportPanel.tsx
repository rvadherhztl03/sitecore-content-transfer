import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Icon } from '@/lib/icon';
import { type PackageItem, type PackagePart, readPackage } from '@/lib/package';
import { MERGES, SCOPES, labelOf, mergesFor } from '@/lib/queue';
import type { Scope } from '@/lib/transfer';
import { mdiFileOutline, mdiFileUploadOutline } from '@mdi/js';
import { useRef, useState } from 'react';

export type LoadedPackage = { fileName: string; size: number; items: PackageItem[]; parts: PackagePart[] };

type Props = { disabled?: boolean; onPackage(pkg: LoadedPackage | null): void };

const formatBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`;

const TH = 'text-muted-foreground border-b px-4 py-2.5 text-left text-xs font-semibold tracking-wider uppercase';
const TD = 'border-b px-4 py-3 align-top';

export function ImportPanel({ disabled, onPackage }: Props) {
  const [pkg, setPkg] = useState<LoadedPackage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const locked = disabled || busy;

  const load = async (file: File | undefined) => {
    if (!file || locked) return;
    setBusy(true);
    setError(null);
    // Nothing is loaded while the replacement is read, so the parent can't act on the old package.
    onPackage(null);
    try {
      const next = { fileName: file.name, size: file.size, ...(await readPackage(file)) };
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

  const chunks = pkg?.parts.flatMap((p) => p.chunks) ?? [];
  const media = chunks.filter((c) => c.isMedia).length;

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <label
        aria-disabled={locked}
        className="border-primary-200 bg-primary-50 has-[:focus-visible]:ring-primary/50 flex cursor-pointer flex-col items-center justify-center gap-2.5 rounded-[14px] border-2 border-dashed p-7 text-center has-[:focus-visible]:ring-[3px] aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          load(e.dataTransfer.files[0]);
        }}
      >
        <Icon path={mdiFileUploadOutline} className="text-primary size-8" aria-hidden />
        <span className="text-[15px] font-semibold">Drop a .zip or .raif here, or browse</span>
        <span className="text-muted-foreground text-sm">Packages exported from this app include a list of their items.</span>
        <input
          ref={inputRef}
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
          <div className="flex items-center gap-3.5 rounded-xl border bg-white px-4 py-3.5">
            <span className="bg-primary-100 text-primary-700 grid size-10 shrink-0 place-items-center rounded-lg">
              <Icon path={mdiFileOutline} className="size-5" aria-hidden />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="font-mono text-sm font-medium [overflow-wrap:anywhere]" title={pkg.fileName}>
                {pkg.fileName}
              </span>
              <span className="text-muted-foreground text-xs">
                {`${formatBytes(pkg.size)} · ${chunks.length} ${chunks.length === 1 ? 'chunk' : 'chunks'} · ${media} media`}
              </span>
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 rounded-lg px-3 pointer-coarse:h-11"
              disabled={locked}
              onClick={() => inputRef.current?.click()}
            >
              Replace
            </Button>
          </div>

          {pkg.items.length === 0 ? (
            <p className="text-muted-foreground text-sm">No metadata in this package.</p>
          ) : (
            <div className="overflow-hidden rounded-[14px] border bg-white">
              <div className="flex items-center justify-between gap-3 border-b px-4 py-3.5">
                <h2 className="text-[15px] font-semibold">What&apos;s inside</h2>
                <span className="text-muted-foreground text-sm">{pkg.items.length === 1 ? '1 item' : `${pkg.items.length} items`}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] border-collapse text-md">
                  <thead>
                    <tr>
                      <th scope="col" className={TH}>
                        Item
                      </th>
                      <th scope="col" className={TH}>
                        Includes
                      </th>
                      <th scope="col" className={TH}>
                        If it exists
                      </th>
                    </tr>
                  </thead>
                  <tbody className="[&_tr:last-child_td]:border-b-0">
                    {pkg.items.map((i, n) => (
                      <tr key={`${i.id}-${n}`}>
                        <td className={`${TD} font-mono text-xs [overflow-wrap:anywhere]`} title={i.path}>
                          {i.path}
                        </td>
                        <td className={TD}>{labelOf(SCOPES, i.scope, true)}</td>
                        {/* A package from before scope-specific options can pair any scope with any strategy. */}
                        <td className={TD}>{labelOf([...mergesFor(i.scope as Scope), ...MERGES], i.mergeStrategy, true)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
