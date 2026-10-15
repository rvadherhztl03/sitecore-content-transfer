import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EnvironmentBar, type Mode } from '@/components/transfer/EnvironmentBar';

const ENVS = [
  { id: 'r1', name: 'Dev', contextId: 'ctx-dev' },
  { id: 'r2', name: 'QA', contextId: 'ctx-qa' },
];

function setup(mode: Mode, onSwap = vi.fn()) {
  render(
    <EnvironmentBar
      mode={mode}
      envs={ENVS}
      sourceId="r1"
      targetId="r2"
      database="master"
      onSourceChange={vi.fn()}
      onTargetChange={vi.fn()}
      onDatabaseChange={vi.fn()}
      onSwap={onSwap}
    />,
  );
}

describe('EnvironmentBar', () => {
  it('transfer mode shows source, target, database and swap', () => {
    setup('transfer');
    expect(screen.getByLabelText('Source')).toHaveTextContent('Dev');
    expect(screen.getByLabelText('Target')).toHaveTextContent('QA');
    expect(screen.getByLabelText('Database')).toHaveTextContent('master');
    expect(screen.getByRole('button', { name: 'Swap source and target' })).toBeInTheDocument();
  });

  it('export mode shows only source', () => {
    setup('export');
    expect(screen.getByLabelText('Source')).toBeInTheDocument();
    expect(screen.queryByLabelText('Target')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Database')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Swap source and target' })).not.toBeInTheDocument();
  });

  it('import mode shows target and database', () => {
    setup('import');
    expect(screen.queryByLabelText('Source')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Target')).toBeInTheDocument();
    expect(screen.getByLabelText('Database')).toBeInTheDocument();
  });

  it('swap calls onSwap', () => {
    const onSwap = vi.fn();
    setup('transfer', onSwap);
    fireEvent.click(screen.getByRole('button', { name: 'Swap source and target' }));
    expect(onSwap).toHaveBeenCalledTimes(1);
  });
});
