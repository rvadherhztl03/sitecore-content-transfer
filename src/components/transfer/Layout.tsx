import { Logo } from '@/components/transfer/Logo';
import { Button } from '@/components/ui/button';
import type { ReactNode } from 'react';

/** The page's content column, between the header and the footer. */
export const MAIN = 'mx-auto flex w-full max-w-[1120px] flex-1 flex-col gap-6 px-4 pt-7 pb-10 sm:px-8';
/** A footer or page-level button: 44px tall with the 10px radius. */
export const BTN = 'h-11 rounded-[10px] px-5';

/** Leave out `onHome` to keep the brand button visible but disabled, e.g. while a run is in progress. */
type HeaderProps = { crumb?: string; envCount?: number; onHome?(): void; onCancel?(): void };

export function AppHeader({ crumb, envCount, onHome, onCancel }: HeaderProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b bg-white px-4 py-3.5 sm:px-8">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onHome}
          disabled={!onHome}
          className="focus-visible:ring-primary/50 flex cursor-pointer items-center gap-3 rounded-lg outline-none focus-visible:ring-[3px] disabled:cursor-default pointer-coarse:min-h-11"
        >
          <Logo className="size-9 shrink-0" />
          <span className="text-lg font-semibold">Content Transfer</span>
        </button>
        {crumb && (
          <>
            <span aria-hidden="true" className="text-blackAlpha-300">
              /
            </span>
            <span className="text-neutral-fg min-w-0 text-[15px] break-words">{crumb}</span>
          </>
        )}
      </div>
      {(envCount !== undefined || onCancel) && (
        <div className="flex flex-wrap items-center gap-3">
          {envCount !== undefined && (
            <span className="bg-success-50 text-success-600 inline-flex min-h-8 items-center gap-2 rounded-full px-3 text-sm font-medium">
              <span aria-hidden="true" className="bg-success-500 size-2 rounded-full" />
              {envCount === 1 ? '1 environment connected' : `${envCount} environments connected`}
            </span>
          )}
          {onCancel && (
            <Button type="button" variant="outline" size="sm" className="h-9 rounded-lg px-3.5 pointer-coarse:h-11" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      )}
    </header>
  );
}

/** Sticky page footer: a summary on the left, the step's buttons on the right. */
export function ActionBar({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  return (
    <footer className="sticky bottom-0 z-10 border-t bg-white px-4 py-3.5 sm:px-8">
      <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-4">
        <div className="text-md text-neutral-fg flex min-w-0 flex-wrap items-center gap-2.5">{summary}</div>
        <div className="flex flex-wrap gap-2.5">{children}</div>
      </div>
    </footer>
  );
}

export function PageHeading({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      {/* Focusable by script only: Flow moves focus here when the step changes. */}
      <h1 tabIndex={-1} className="text-[26px] leading-tight font-semibold tracking-tight outline-none">
        {title}
      </h1>
      {sub && <p className="text-muted-foreground text-[15px]">{sub}</p>}
    </div>
  );
}
