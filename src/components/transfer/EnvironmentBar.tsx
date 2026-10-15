import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Icon } from '@/lib/icon';
import type { Env } from '@/lib/sdk';
import { mdiSwapHorizontal } from '@mdi/js';

export type Mode = 'transfer' | 'export' | 'import';

const DATABASES = ['master', 'web'];

type Props = {
  mode: Mode;
  envs: Env[];
  sourceId?: string;
  targetId?: string;
  database: string;
  disabled?: boolean;
  onSourceChange(id: string): void;
  onTargetChange(id: string): void;
  onDatabaseChange(db: string): void;
  onSwap(): void;
};

function Field({
  id,
  label,
  value,
  options,
  placeholder,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value?: string;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
  onChange(value: string): void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value ?? ''} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} className="w-56">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function EnvironmentBar({
  mode,
  envs,
  sourceId,
  targetId,
  database,
  disabled,
  onSourceChange,
  onTargetChange,
  onDatabaseChange,
  onSwap,
}: Props) {
  const envOptions = envs.map((e) => ({ value: e.id, label: e.name }));
  return (
    <div className="flex flex-wrap items-end gap-3">
      {mode !== 'import' && (
        <Field
          id="env-source"
          label="Source"
          value={sourceId}
          options={envOptions}
          placeholder="Select environment"
          disabled={disabled}
          onChange={onSourceChange}
        />
      )}
      {mode === 'transfer' && (
        <Button variant="ghost" size="icon" aria-label="Swap source and target" disabled={disabled} onClick={onSwap}>
          <Icon path={mdiSwapHorizontal} />
        </Button>
      )}
      {mode !== 'export' && (
        <>
          <Field
            id="env-target"
            label="Target"
            value={targetId}
            options={envOptions}
            placeholder="Select environment"
            disabled={disabled}
            onChange={onTargetChange}
          />
          <Field
            id="env-database"
            label="Database"
            value={database}
            options={DATABASES.map((d) => ({ value: d, label: d }))}
            disabled={disabled}
            onChange={onDatabaseChange}
          />
        </>
      )}
    </div>
  );
}
