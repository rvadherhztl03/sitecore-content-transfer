import type { Env } from '@/lib/sdk';
import { envKind } from '@/lib/sdk';
import { cn } from '@/lib/utils';

const BADGES = {
  prod: { label: 'Production', tone: 'bg-warning-50 text-warning-600' },
  test: { label: 'Test', tone: 'bg-primary-100 text-primary-700' },
  dev: { label: 'Dev', tone: 'bg-neutral-bg text-neutral-fg' },
};

export function EnvBadge({ env }: { env: Env }) {
  const kind = envKind(env);
  if (!kind) return null;
  const { label, tone } = BADGES[kind];
  return <span className={cn('inline-flex shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold', tone)}>{label}</span>;
}

type Props = {
  legend: string;
  name: string;
  envs: Env[];
  value?: string;
  disabledId?: string;
  disabledReason?: string;
  onChange(id: string): void;
};

/** A card of radio options, one per environment. Place it in a `flex flex-wrap` row: it grows from a 340px basis. */
export function EnvironmentCards({ legend, name, envs, value, disabledId, disabledReason, onChange }: Props) {
  return (
    <fieldset className="m-0 flex min-w-0 flex-[1_1_340px] flex-col gap-2.5 rounded-[14px] border bg-white p-5">
      <legend className="text-muted-foreground px-1.5 text-sm font-semibold tracking-wider uppercase">{legend}</legend>
      {envs.map((env) => {
        const disabled = env.id === disabledId;
        const selected = !disabled && env.id === value;
        return (
          <label
            key={env.id}
            className={cn(
              'has-[:focus-visible]:ring-primary/50 flex items-center gap-3 rounded-xl border px-4 py-3.5 has-[:focus-visible]:ring-[3px]',
              disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer',
              selected ? 'border-primary bg-primary-50 border-[1.5px]' : cn('bg-white', !disabled && 'hover:border-primary-300'),
            )}
          >
            <input
              type="radio"
              name={name}
              value={env.id}
              checked={selected}
              disabled={disabled}
              onChange={() => onChange(env.id)}
              className="accent-primary m-0 size-[18px] shrink-0"
            />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className={cn('text-[15px] break-words', selected ? 'font-semibold' : 'font-medium')} title={env.name}>
                {env.name}
              </span>
              {disabled && disabledReason ? (
                <span className="text-muted-foreground text-xs">{disabledReason}</span>
              ) : (
                env.tenantName && (
                  <span className="text-muted-foreground font-mono text-xs break-all" title={env.tenantName}>
                    {env.tenantName}
                  </span>
                )
              )}
            </span>
            <EnvBadge env={env} />
          </label>
        );
      })}
    </fieldset>
  );
}
