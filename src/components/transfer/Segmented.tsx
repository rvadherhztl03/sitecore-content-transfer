import { cn } from '@/lib/utils';

type Props = {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange(v: string): void;
  size?: 'sm' | 'md';
};

// ponytail: every option is a tab stop (no roving tabindex / arrow keys); add them if a group grows past a few options.
export function Segmented({ label, value, options, onChange, size = 'md' }: Props) {
  return (
    <div role="radiogroup" aria-label={label} className="bg-muted inline-flex max-w-full gap-1 rounded-lg p-1">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.value)}
            className={cn(
              'focus-visible:ring-primary/50 cursor-pointer rounded-lg text-sm outline-none focus-visible:ring-[3px]',
              size === 'sm' ? 'min-h-7 px-3' : 'min-h-9 px-4.5',
              selected ? 'text-foreground bg-white font-semibold shadow-sm' : 'text-muted-foreground bg-transparent font-medium',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
