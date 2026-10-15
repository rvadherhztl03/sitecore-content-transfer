import { cn } from '@/lib/utils';
import type { KeyboardEvent } from 'react';

type Props = {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange(v: string): void;
  size?: 'sm' | 'md';
  disabled?: boolean;
};

const ARROWS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export function Segmented({ label, value, options, onChange, size = 'md', disabled }: Props) {
  // Roving tabindex: the checked option is the only tab stop (the first one when nothing matches).
  const tabStop = Math.max(0, options.findIndex((o) => o.value === value));

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = ARROWS[e.key];
    if (!step) return;
    e.preventDefault();
    const radios = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'));
    const from = radios.indexOf(e.target as HTMLElement);
    const next = (from < 0 ? tabStop : from) + step;
    const i = (next + options.length) % options.length;
    onChange(options[i].value);
    radios[i]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className="bg-neutral-bg inline-flex max-w-full flex-wrap gap-1 rounded-lg p-1">
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={i === tabStop ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'focus-visible:ring-primary/50 cursor-pointer rounded-lg whitespace-nowrap outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11',
              size === 'sm' ? 'text-sm min-h-8 px-3' : 'text-md min-h-9 px-4.5',
              selected ? 'text-foreground bg-white font-semibold shadow-[0_1px_3px_rgba(20,20,40,0.12)]' : 'text-muted-foreground bg-transparent font-medium',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
