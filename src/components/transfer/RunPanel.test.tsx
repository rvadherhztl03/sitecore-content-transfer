import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunPanel } from '@/components/transfer/RunPanel';
import type { StepStatus } from '@/lib/transfer';

const steps = (...statuses: StepStatus[]) => statuses.map((status, i) => ({ label: `Step ${i + 1}`, status }));
const LOGS = [
  { time: '10:00:01', text: 'Started', type: 'info' as const },
  { time: '10:00:02', text: 'Boom', type: 'error' as const },
];

function setup(props: Partial<React.ComponentProps<typeof RunPanel>> = {}) {
  const handlers = { onCancel: vi.fn(), onClose: vi.fn(), onRunAgain: vi.fn() };
  render(
    <RunPanel
      open
      title="Transfer to Prod"
      steps={steps('done', 'running', 'pending')}
      progress={40}
      logs={LOGS}
      running
      result={null}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

afterEach(() => vi.unstubAllGlobals());

describe('RunPanel', () => {
  it('while running shows the steps, a live status and Cancel', () => {
    const { onCancel } = setup();
    for (const label of ['Step 1', 'Step 2', 'Step 3']) expect(screen.getByText(label)).toBeInTheDocument();
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('Step 2');
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('40%');
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('on success shows Completed, Done and Run again but no Cancel', () => {
    const { onClose, onRunAgain } = setup({ running: false, result: 'success', progress: 100, steps: steps('done', 'done') });
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Run again' }));
    expect(onRunAgain).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('on failure shows Failed', () => {
    setup({ running: false, result: 'fail', steps: steps('done', 'fail') });
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('copies the logs as "<time> <text>" lines', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Copy logs' }));
    expect(writeText).toHaveBeenCalledWith('10:00:01 Started\n10:00:02 Boom');
  });

  it('ignores Escape and the close button while running', () => {
    const { onClose } = setup();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape once the run has finished', () => {
    const { onClose } = setup({ running: false, result: 'success' });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders inline without a dialog when compact', () => {
    setup({ compact: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Transfer to Prod' })).getByText('Step 1')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    setup({ open: false });
    expect(screen.queryByText('Step 1')).not.toBeInTheDocument();
  });
});
