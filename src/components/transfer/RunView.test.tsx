import { RunView, formatDuration, type LogLine, type RunKind } from '@/components/transfer/RunView';
import type { Env } from '@/lib/sdk';
import type { StepStatus } from '@/lib/transfer';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const DEV: Env = { id: 'dev', name: 'Acme · Development', contextId: 'c1', tenantName: 'acme-dev' };
const QA: Env = { id: 'qa', name: 'Acme · QA', contextId: 'c2', tenantName: 'acme-qa' };

const LOGS: LogLine[] = [
  { time: '10:42:03', text: 'Created transfer on Acme · Development', type: 'info' },
  { time: '10:43:59', text: 'Copying chunk 6 / 12', type: 'info' },
  { time: '10:44:17', text: 'Copying chunk 7 / 12', type: 'info' },
];
const steps = (...rows: [StepStatus, number?][]) => rows.map(([status, ms], i) => ({ label: `Step ${i + 1}`, status, ms }));

function setup(props: Partial<React.ComponentProps<typeof RunView>> = {}) {
  const handlers = { onCancel: vi.fn(), onAgain: vi.fn(), onHome: vi.fn(), onDownload: vi.fn() };
  const view = render(
    <RunView
      kind="transfer"
      source={DEV}
      target={QA}
      steps={steps(['done', 3000], ['running'], ['pending'])}
      progress={58}
      logs={LOGS}
      running
      result={null}
      {...handlers}
      {...props}
    />,
  );
  return { ...handlers, ...view };
}

const done = (kind: RunKind, extra: Partial<React.ComponentProps<typeof RunView>> = {}) =>
  setup({
    kind,
    running: false,
    result: 'success',
    progress: 100,
    steps: steps(['done', 3000], ['done', 200000]),
    info: { chunkCount: 12, itemCount: 184 },
    tookMs: 200000,
    ...extra,
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('formatDuration', () => {
  it.each([
    [45000, '45 s'],
    [200000, '3 min 20 s'],
    [3720000, '1 h 2 min'],
    [0, '0 s'],
    [60000, '1 min'],
    [3600000, '1 h'],
    [59600, '1 min'],
    [-5, '0 s'],
  ])('%d ms -> %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});

describe('RunView running', () => {
  it('shows the status, title, percent and an accessible progressbar', () => {
    setup();
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Copying content to Acme · QA' })).toBeInTheDocument();
    expect(screen.getByText('58%')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: 'Transfer progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '58');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('clamps an out-of-range progress', () => {
    setup({ progress: 140 });
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it.each([
    ['export', 'Packaging content from Acme · Development', 'Export progress'],
    ['install', 'Installing package into Acme · QA', 'Install progress'],
  ] as const)('titles the %s run', (kind, title, label) => {
    setup({ kind });
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: label })).toBeInTheDocument();
  });

  it('announces the latest chunk from the logs in a polite live region', () => {
    setup();
    const live = document.querySelector('[aria-live="polite"]');
    expect(live).toHaveTextContent('Copying chunk 7 of 12');
    expect(live).not.toHaveTextContent('6 of 12');
  });

  it('takes the verb from the log line and leaves the live region empty without a chunk line', () => {
    const { rerender, container } = setup({ logs: [{ time: '1', text: 'Uploading chunk 3 / 10', type: 'info' }] });
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent('Uploading chunk 3 of 10');
    rerender(
      <RunView kind="transfer" steps={[]} progress={5} logs={[{ time: '1', text: 'Waiting', type: 'info' }]} running result={null} onAgain={vi.fn()} onHome={vi.fn()} />,
    );
    expect(container.querySelector('[aria-live="polite"]')).toBeEmptyDOMElement();
  });

  it('lists the steps with a status word and the duration of finished ones', () => {
    setup({
      steps: [
        { label: 'Create job', status: 'done', ms: 45000 },
        { label: 'Copy chunks', status: 'done', ms: 200000 },
        { label: 'Assemble', status: 'running' },
        { label: 'Verify', status: 'pending' },
      ],
    });
    const items = within(screen.getByRole('list', { name: 'Steps' })).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent('Create job');
    expect(items[0]).toHaveTextContent('Done');
    expect(items[0]).toHaveTextContent('45 s');
    expect(items[1]).toHaveTextContent('3 min 20 s');
    expect(items[2]).toHaveAttribute('aria-current', 'step');
    expect(items[2]).toHaveTextContent('Running');
    expect(items[2]).not.toHaveTextContent(/\d+ s/);
    expect(items[3]).toHaveTextContent('Not started');
    expect(within(items[3]).getByText('Not started')).toHaveClass('sr-only');
  });

  it('shows the dark activity log with the lines and times', () => {
    setup();
    expect(screen.getByRole('heading', { level: 2, name: 'Activity' })).toBeInTheDocument();
    expect(screen.getByText('Created transfer on Acme · Development')).toBeInTheDocument();
    expect(screen.getByText('10:44:17')).toBeInTheDocument();
  });

  it('calls onCancel from the kind-specific Cancel button', () => {
    const { onCancel } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel transfer' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it.each([
    ['export', 'Cancel export'],
    ['install', 'Cancel install'],
  ] as const)('labels Cancel for %s', (kind, name) => {
    setup({ kind });
    expect(screen.getByRole('button', { name })).toBeInTheDocument();
  });

  it.each(['transfer', 'install'] as const)('without onCancel a %s says it cannot be cancelled', (kind) => {
    setup({ kind, onCancel: undefined });
    expect(screen.getByText("The import can't be cancelled once it starts.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Cancel/ })).not.toBeInTheDocument();
  });

  it('without onCancel an export shows neither Cancel nor the import note nor a footer', () => {
    setup({ kind: 'export', onCancel: undefined });
    expect(screen.queryByRole('button', { name: /^Cancel/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/can't be cancelled/)).not.toBeInTheDocument();
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
  });

  it('shows no result actions while running', () => {
    setup();
    expect(screen.queryByRole('button', { name: 'Back to home' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });
});

describe('RunView complete', () => {
  it.each([
    ['transfer', 'Transfer complete', 'Content from Acme · Development is now in Acme · QA.'],
    ['export', 'Package ready', 'Your package is ready to download.'],
    ['install', 'Package installed', 'The package is now in Acme · QA.'],
  ] as const)('titles and summarises a %s', (kind, title, summary) => {
    done(kind);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByText(summary)).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Cancel/ })).not.toBeInTheDocument();
  });

  it('shows the Items, Chunks and Took stats', () => {
    done('transfer');
    expect(screen.getByText('Items').nextSibling).toHaveTextContent('184');
    expect(screen.getByText('Chunks').nextSibling).toHaveTextContent('12');
    expect(screen.getByText('Took').nextSibling).toHaveTextContent('3 min 20 s');
  });

  it('omits stats it has no data for', () => {
    done('transfer', { info: undefined, tookMs: 45000 });
    expect(screen.queryByText('Items')).not.toBeInTheDocument();
    expect(screen.queryByText('Chunks')).not.toBeInTheDocument();
    expect(screen.getByText('Took').nextSibling).toHaveTextContent('45 s');
  });

  it('omits the stats row entirely when there is nothing to show', () => {
    done('transfer', { info: undefined, tookMs: undefined });
    for (const label of ['Items', 'Chunks', 'Took']) expect(screen.queryByText(label)).not.toBeInTheDocument();
  });

  it('transfer: Start another transfer and Back to home', () => {
    const { onAgain, onHome } = done('transfer');
    fireEvent.click(screen.getByRole('button', { name: 'Start another transfer' }));
    expect(onAgain).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Back to home' }));
    expect(onHome).toHaveBeenCalledOnce();
  });

  it('export: Download package calls onDownload only, Start another export calls onAgain', () => {
    const { onDownload, onAgain } = done('export');
    fireEvent.click(screen.getByRole('button', { name: 'Download package' }));
    expect(onDownload).toHaveBeenCalledOnce();
    expect(onAgain).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Start another export' }));
    expect(onAgain).toHaveBeenCalledOnce();
  });

  it('export: no Download button without onDownload', () => {
    done('export', { onDownload: undefined });
    expect(screen.queryByRole('button', { name: 'Download package' })).not.toBeInTheDocument();
  });

  it('install: Install another package calls onAgain', () => {
    const { onAgain } = done('install');
    fireEvent.click(screen.getByRole('button', { name: 'Install another package' }));
    expect(onAgain).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Download package' })).not.toBeInTheDocument();
  });

  it('keeps the log in a collapsed details titled Activity log', () => {
    const { container } = done('transfer');
    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    expect(within(details!).getByText('Activity log').tagName).toBe('SUMMARY');
    expect(details).toContainElement(screen.getByText('Copying chunk 7 / 12'));
  });
});

describe('RunView failed', () => {
  it.each([
    ['transfer', 'Transfer failed'],
    ['export', 'Export failed'],
    ['install', 'Install failed'],
  ] as const)('titles a failed %s', (kind, title) => {
    setup({ kind, running: false, result: 'fail' });
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
  });

  it('shows the failing step, the expanded log, Try again and Back to home', () => {
    const { container, onAgain, onHome } = setup({
      running: false,
      result: 'fail',
      steps: steps(['done', 3000], ['fail', 1000], ['pending']),
    });
    const items = within(screen.getByRole('list', { name: 'Steps' })).getAllByRole('listitem');
    expect(items[1]).toHaveTextContent('Failed');
    expect(container.querySelector('details')).toBeNull();
    expect(screen.getByText('Copying chunk 7 / 12')).toBeVisible();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Cancel/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onAgain).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Back to home' }));
    expect(onHome).toHaveBeenCalledOnce();
  });
});

describe('RunView late result', () => {
  it('offers no Cancel once a result is in, even if running lags behind', () => {
    setup({ running: true, result: 'fail' });
    expect(screen.queryByRole('button', { name: /^Cancel/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
  });
});

describe('RunView Copy log', () => {
  it('copies "<time> <text>" lines and confirms with Copied', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Copy log' }));
    expect(writeText).toHaveBeenCalledWith(LOGS.map((l) => `${l.time} ${l.text}`).join('\n'));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('goes back to Copy log after two seconds', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
    vi.useFakeTimers();
    setup();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy log' }));
    });
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('button', { name: 'Copy log' })).toBeInTheDocument();
  });

  it('shows Copy failed when the clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Copy log' }));
    expect(await screen.findByRole('button', { name: 'Copy failed' })).toBeInTheDocument();
  });

  it('shows Copy failed when the clipboard rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Copy log' }));
    expect(await screen.findByRole('button', { name: 'Copy failed' })).toBeInTheDocument();
  });

  it('clears its timer on unmount', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
    vi.useFakeTimers();
    const { unmount } = setup();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy log' }));
    });
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is disabled without logs', () => {
    setup({ logs: [] });
    expect(screen.getByRole('button', { name: 'Copy log' })).toBeDisabled();
  });

  it('is also available in the collapsed log of a finished run', () => {
    done('transfer');
    expect(screen.getByRole('button', { name: 'Copy log' })).toBeInTheDocument();
  });
});

describe('RunView layout', () => {
  it('renders a sticky footer landmark for the full page', () => {
    setup();
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByRole('button', { name: 'Cancel transfer' })).toBeInTheDocument();
  });

  it('compact has no footer landmark; actions are inline', () => {
    const { onCancel, container } = setup({ compact: true });
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
    expect(container.querySelector('.sticky')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel transfer' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('compact shows the can-not-cancel note inline', () => {
    setup({ compact: true, onCancel: undefined });
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
    expect(screen.getByText("The import can't be cancelled once it starts.")).toBeInTheDocument();
  });

  it.each([
    ['complete', { running: false, result: 'success' as const }],
    ['failed', { running: false, result: 'fail' as const }],
  ])('compact %s keeps its actions and has no footer', (_n, props) => {
    const { onAgain } = setup({ compact: true, ...props });
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to home' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button').find((b) => /another transfer|Try again/.test(b.textContent ?? ''))!);
    expect(onAgain).toHaveBeenCalledOnce();
  });
});
