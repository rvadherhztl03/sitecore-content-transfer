import { Icon } from '@/lib/icon';
import { cn } from '@/lib/utils';
import { mdiCheck } from '@mdi/js';
import type { ReactNode } from 'react';

type Props = { steps: { label: string; hint: string }[]; current: number; locked?: boolean; onGo(i: number): void };

const ITEM = 'flex min-w-0 items-center gap-3 rounded-xl border px-3.5 py-3 text-left';

function Item({ badge, label, hint, hintClass }: { badge: ReactNode; label: string; hint: string; hintClass: string }) {
  return (
    <>
      {badge}
      <span className="flex min-w-0 flex-col gap-px">
        <span className="text-md break-words">{label}</span>
        <span className={cn('text-xs break-words', hintClass)}>{hint}</span>
      </span>
    </>
  );
}

const DONE_BADGE = (
  <span className="bg-success-500 text-inverse-text grid size-7 shrink-0 place-items-center rounded-full">
    <Icon path={mdiCheck} className="size-4" aria-hidden="true" />
  </span>
);
const DONE_CLASS = 'border-success-100 bg-success-50/60 text-foreground';

export function Stepper({ steps, current, locked, onGo }: Props) {
  return (
    <nav aria-label="Transfer steps" className="border-b bg-white px-4 py-4 sm:px-8">
      <ol className="mx-auto flex max-w-[1120px] flex-wrap gap-3">
        {steps.map((s, i) => {
          if (i < current) {
            const body = <Item badge={DONE_BADGE} label={s.label} hint={s.hint} hintClass="text-success-600" />;
            return (
              <li key={s.label} className="flex flex-[1_1_200px]">
                {locked ? (
                  <div className={cn(ITEM, DONE_CLASS, 'flex-1')}>{body}</div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onGo(i)}
                    className={cn(ITEM, DONE_CLASS, 'hover:border-success-300 focus-visible:ring-primary/50 flex-1 cursor-pointer outline-none focus-visible:ring-[3px]')}
                  >
                    {body}
                  </button>
                )}
              </li>
            );
          }
          const isCurrent = i === current;
          return (
            <li
              key={s.label}
              aria-current={isCurrent ? 'step' : undefined}
              className={cn('flex-[1_1_200px]', ITEM, isCurrent ? 'border-primary bg-primary-50 border-[1.5px]' : 'bg-white')}
            >
              <Item
                badge={
                  <span
                    className={cn(
                      'text-md grid size-7 shrink-0 place-items-center rounded-full font-semibold',
                      isCurrent ? 'bg-primary text-inverse-text' : 'text-neutral-fg border-blackAlpha-300 border-[1.5px]',
                    )}
                  >
                    {i + 1}
                  </span>
                }
                label={s.label}
                hint={s.hint}
                hintClass={isCurrent ? 'text-primary-fg' : 'text-muted-foreground'}
              />
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
