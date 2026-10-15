import { act, fireEvent, render, screen, within } from '@testing-library/react';
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

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

  it('hides Cancel while running without onCancel', () => {
    setup({ onCancel: undefined });
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
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

  it('copies the logs as "<time> <text>" lines and confirms with Copied', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Copy logs' }));
    expect(writeText).toHaveBeenCalledWith('10:00:01 Started\n10:00:02 Boom');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('goes back to Copy logs after two seconds', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    vi.useFakeTimers();
    setup();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy logs' }));
    });
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('button', { name: 'Copy logs' })).toBeInTheDocument();
  });

  it('shows Copy failed when the clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Copy logs' }));
    expect(await screen.findByRole('button', { name: 'Copy failed' })).toBeInTheDocument();
  });

  it('shows Copy failed when the clipboard rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Copy logs' }));
    expect(await screen.findByRole('button', { name: 'Copy failed' })).toBeInTheDocument();
  });

  it('shows the live chunk counter from the latest chunk log', () => {
    setup({
      logs: [
        { time: '10:00:01', text: 'Copying chunk 1 / 10', type: 'info' },
        { time: '10:00:02', text: 'Uploading chunk 3 / 10', type: 'info' },
        { time: '10:00:03', text: 'Waiting for the target', type: 'info' },
      ],
    });
    expect(screen.getByText('Chunk 3 / 10')).toBeInTheDocument();
  });

  it('shows no chunk counter without chunk logs or once finished', () => {
    const logs = [{ time: '10:00:01', text: 'Uploading chunk 3 / 10', type: 'info' as const }];
    setup({ logs, running: false, result: 'success' });
    expect(screen.queryByText(/^Chunk \d/)).not.toBeInTheDocument();
  });

  it('cannot be dismissed while running: no Close button, Escape ignored', () => {
    const { onClose } = setup();
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('can be dismissed once finished: Close button and Escape', () => {
    const { onClose } = setup({ running: false, result: 'success' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
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
