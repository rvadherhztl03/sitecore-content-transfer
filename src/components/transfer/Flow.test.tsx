/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Flow } from '@/components/transfer/Flow';
import { newTree } from '@/lib/queue';
import type { Env } from '@/lib/sdk';
import { TIMING } from '@/lib/transfer';
import { fakeClient, type FakeReply } from '@/test/fakeClient';

const DEV: Env = { id: 'dev', name: 'Acme · Development', contextId: 'ctx-dev', tenantName: 'acme-dev' };
const QA: Env = { id: 'qa', name: 'Acme · QA', contextId: 'ctx-qa', tenantName: 'acme-qa' };
const PROD: Env = { id: 'prod', name: 'Acme Production', contextId: 'ctx-prod' };
const HOME = '/sitecore/content/Home';
const CT = 'xmc.contentTransfer.';

type Handler = (params: any) => FakeReply | Promise<FakeReply>;

// Modelled on happyHandlers in src/lib/transfer.test.ts, plus the tree query.
function handlers(overrides: Record<string, Handler> = {}): Record<string, Handler> {
  let statusCalls = 0;
  return {
    'xmc.authoring.graphql': () => ({
      data: { data: { item: { children: { nodes: [{ itemId: 'c', name: 'content', path: '/sitecore/content', children: { nodes: [] } }] } } } },
    }),
    [CT + 'createContentTransfer']: () => ({}),
    [CT + 'getContentTransferStatus']: () =>
      statusCalls++ === 0
        ? { data: { State: 'Processing' } }
        : { data: { State: 'Completed', ChunkSetsMetadata: [{ ChunkSetId: 'cs1', ChunkCount: 2, TotalItemCount: 3 }] } },
    [CT + 'getChunk']: (p) => ({ data: new Blob(['c' + p.path.chunkId]), headers: { 'content-disposition': 'attachment; IsMedia=false' } }),
    [CT + 'saveChunk']: () => ({}),
    [CT + 'completeChunkSetTransfer']: (p) => ({ data: { ContentTransferFileName: 'f-' + p.path.chunksetId + '.raif' } }),
    [CT + 'consumeFile']: () => ({}),
    [CT + 'getBlobState']: () => ({ data: { status: 'OK' } }),
    [CT + 'deleteContentTransfer']: () => ({}),
    ...Object.fromEntries(Object.entries(overrides).map(([k, h]) => [CT + k, h])),
  };
}

function setup({ mode = 'transfer', envs = [DEV, QA, PROD], overrides = {} }: { mode?: 'transfer' | 'export'; envs?: Env[]; overrides?: Record<string, Handler> } = {}) {
  const { client, calls } = fakeClient(handlers(overrides));
  const onHome = vi.fn();
  const view = render(<Flow client={client} mode={mode} envs={envs} onHome={onHome} />);
  return { client, calls, onHome, ...view };
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const group = (name: string) => screen.getByRole('group', { name });
const radio = (legend: string, env: Env) => within(group(legend)).getByRole('radio', { name: new RegExp(env.name) });
const stepBar = () => screen.getByRole('navigation', { name: 'Transfer steps' });
const ofKey = (calls: { key: string }[], k: string) => calls.filter((c) => c.key === CT + k) as any[];
// jsdom may lack these; the export test stubs them and afterEach puts the originals back.
const URL_FNS = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };

// The tree loads its root on arrival at Content; wait for it so no update lands outside act().
async function toContent() {
  click('Continue');
  await screen.findByText('content');
}
function addPath(path = HOME) {
  fireEvent.change(screen.getByLabelText('Add by path'), { target: { value: path } });
  click('Add');
}
async function toReview(review = 'Review transfer') {
  await toContent();
  addPath();
  click(review);
}

describe('Flow', () => {
  let pollMs: number;
  beforeEach(() => {
    pollMs = TIMING.pollMs;
    TIMING.pollMs = 0;
  });
  afterEach(() => {
    TIMING.pollMs = pollMs;
    vi.restoreAllMocks();
    Object.assign(URL, URL_FNS);
  });

  describe('Route', () => {
    it('selects the first two environments by default', () => {
      setup();
      expect(screen.getByRole('heading', { level: 1, name: 'Where is the content going?' })).toBeInTheDocument();
      expect(radio('From', DEV)).toBeChecked();
      expect(radio('To', QA)).toBeChecked();
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
      expect(within(stepBar()).getByText('Acme · Development → Acme · QA · master')).toBeInTheDocument();
    });

    it('disables the source in To and the target in From', () => {
      setup();
      expect(radio('To', DEV)).toBeDisabled();
      expect(within(group('To')).getByText('Already the source')).toBeInTheDocument();
      expect(radio('From', QA)).toBeDisabled();
      expect(within(group('From')).getByText('Already the target')).toBeInTheDocument();
    });

    it('swaps source and target', () => {
      setup();
      click('Swap source and target');
      expect(radio('From', QA)).toBeChecked();
      expect(radio('To', DEV)).toBeChecked();
    });

    it('changing the source clears the queue', async () => {
      setup();
      await toContent();
      addPath();
      expect(screen.getByRole('button', { name: 'Review transfer' })).toBeEnabled();
      fireEvent.click(within(stepBar()).getByRole('button', { name: /Route/ }));
      fireEvent.click(radio('From', PROD));
      await toContent();
      expect(screen.getByText('Pick items from the tree or paste a path.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Review transfer' })).toBeDisabled();
      expect(screen.getByRole('heading', { name: 'Browse Acme Production' })).toBeInTheDocument();
    });

    it('a vanished target on Review returns to Route, and re-picking needs Continue', async () => {
      const { client, rerender } = setup();
      await toReview();
      expect(screen.getByRole('heading', { level: 1, name: 'Ready to transfer' })).toBeInTheDocument();
      rerender(<Flow client={client} mode="transfer" envs={[DEV, PROD]} onHome={vi.fn()} />);
      expect(screen.getByRole('heading', { level: 1, name: 'Where is the content going?' })).toBeInTheDocument();
      fireEvent.click(radio('To', PROD));
      expect(screen.getByRole('heading', { level: 1, name: 'Where is the content going?' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
    });

    it('a vanished environment is unselected', () => {
      const { client, rerender } = setup();
      rerender(<Flow client={client} mode="transfer" envs={[DEV, PROD]} onHome={vi.fn()} />);
      expect(within(group('To')).queryByRole('radio', { checked: true })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    });

    it('export shows only From', () => {
      setup({ mode: 'export' });
      expect(radio('From', DEV)).toBeChecked();
      expect(screen.queryByRole('group', { name: 'To' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Swap source and target' })).not.toBeInTheDocument();
      expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
      expect(screen.getByText('New export')).toBeInTheDocument();
    });

    it('Cancel in the header goes home', () => {
      const { onHome } = setup();
      expect(screen.getByText('New transfer')).toBeInTheDocument();
      click('Cancel');
      expect(onHome).toHaveBeenCalledTimes(1);
    });
  });

  describe('Focus', () => {
    const heading = (name: string) => screen.getByRole('heading', { level: 1, name });

    it('stays where it is on first mount', () => {
      setup();
      expect(document.body).toHaveFocus();
    });

    it('moves to the new step heading on Continue, Review, Edit, Back and the step bar', async () => {
      setup();
      await toContent();
      expect(heading('What should be copied?')).toHaveFocus();
      addPath();
      click('Review transfer');
      expect(heading('Ready to transfer')).toHaveFocus();
      click('Edit');
      expect(heading('What should be copied?')).toHaveFocus();
      click('Back');
      expect(heading('Where is the content going?')).toHaveFocus();
      await toContent();
      fireEvent.click(within(stepBar()).getByRole('button', { name: /Route/ }));
      expect(heading('Where is the content going?')).toHaveFocus();
    });

    it('does not steal focus when the queue changes within a step', async () => {
      setup();
      await toContent();
      fireEvent.change(screen.getByLabelText('Add by path'), { target: { value: HOME } });
      screen.getByLabelText('Add by path').focus();
      click('Add');
      expect(heading('What should be copied?')).not.toHaveFocus();
    });
  });

  describe('Content', () => {
    it('needs at least one item to continue', async () => {
      setup();
      await toContent();
      expect(screen.getByRole('heading', { name: 'Browse Acme · Development' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Review transfer' })).toBeDisabled();
      addPath();
      expect(screen.getByRole('button', { name: 'Review transfer' })).toBeEnabled();
      expect(within(stepBar()).getByText('1 item')).toBeInTheDocument();
    });

    it('ticks and unticks items in the tree', async () => {
      setup();
      await toContent();
      const box = screen.getByRole('checkbox', { name: 'Select /sitecore/content' });
      fireEvent.click(box);
      expect(screen.getByRole('button', { name: 'Remove /sitecore/content' })).toBeInTheDocument();
      fireEvent.click(box);
      expect(screen.queryByRole('button', { name: 'Remove /sitecore/content' })).not.toBeInTheDocument();
    });
  });

  describe('Review → Run', () => {
    it('starts one run on two quick clicks and sends what was reviewed', async () => {
      const { calls } = setup();
      await toReview();
      const start = screen.getByRole('button', { name: 'Start transfer' });
      // Both clicks land before React re-renders, so both reach the handler.
      act(() => {
        start.click();
        start.click();
      });
      expect(await screen.findByText('Transfer complete')).toBeInTheDocument();
      const create = ofKey(calls, 'createContentTransfer');
      expect(create).toHaveLength(1);
      expect(create[0].params.query.sitecoreContextId).toBe('ctx-dev');
      expect(create[0].params.body.configuration.dataTrees).toEqual([newTree(HOME)]);
      expect(ofKey(calls, 'saveChunk').map((c) => c.params.query.sitecoreContextId)).toEqual(['ctx-qa', 'ctx-qa']);
      expect(ofKey(calls, 'consumeFile')[0].params.query).toMatchObject({ databaseName: 'master', sitecoreContextId: 'ctx-qa' });
    });

    it('locks the step bar and hides header Cancel while running', async () => {
      setup();
      await toReview();
      click('Start transfer');
      expect(within(stepBar()).queryAllByRole('button')).toHaveLength(0);
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
      expect(screen.getByText('Create job on Acme · Development')).toBeInTheDocument();
      expect(screen.getByText('Copy chunks to Acme · QA')).toBeInTheDocument();
      expect(screen.getByText('Import into master')).toBeInTheDocument();
      expect(await screen.findByText('Transfer complete')).toBeInTheDocument();
    });

    it('shows the stats on completion, focuses the heading, and Start another transfer keeps the route', async () => {
      setup();
      await toReview();
      click('Start transfer');
      const heading = await screen.findByRole('heading', { level: 1, name: 'Transfer complete' });
      await waitFor(() => expect(heading).toHaveFocus());
      expect(screen.getByText('Items').parentElement).toHaveTextContent('Items3');
      expect(screen.getByText('Chunks').parentElement).toHaveTextContent('Chunks2');
      expect(screen.getByText('Took')).toBeInTheDocument();
      // Locked after the result too: only RunView's buttons lead on.
      expect(within(stepBar()).queryAllByRole('button')).toHaveLength(0);
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Content Transfer' })).toBeEnabled();

      click('Start another transfer');
      expect(screen.getByRole('heading', { level: 1, name: 'Where is the content going?' })).toBeInTheDocument();
      expect(radio('From', DEV)).toBeChecked();
      expect(radio('To', QA)).toBeChecked();
      await toContent();
      expect(screen.getByText('Pick items from the tree or paste a path.')).toBeInTheDocument();
    });

    it('keeps the run footer outside main so it stays a page landmark', async () => {
      setup();
      await toReview();
      click('Start transfer');
      const footer = screen.getByRole('contentinfo');
      expect(footer.closest('main')).toBeNull();
      expect(within(footer).getByRole('button', { name: 'Cancel transfer' })).toBeInTheDocument();
      expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { level: 1, name: 'Copying content to Acme · QA' }));
      expect(await screen.findByText('Transfer complete')).toBeInTheDocument();
    });

    it('omits the Items stat when the package does not report a count', async () => {
      setup({
        overrides: { getContentTransferStatus: () => ({ data: { State: 'Completed', ChunkSetsMetadata: [{ ChunkSetId: 'cs1', ChunkCount: 2 }] } }) },
      });
      await toReview();
      click('Start transfer');
      expect(await screen.findByRole('heading', { level: 1, name: 'Transfer complete' })).toBeInTheDocument();
      expect(screen.queryByText('Items')).not.toBeInTheDocument();
      expect(screen.getByText('Chunks').parentElement).toHaveTextContent('Chunks2');
    });

    it('offers Cancel until the import starts', async () => {
      let release!: () => void;
      setup({ overrides: { consumeFile: () => new Promise<FakeReply>((r) => (release = () => r({}))) } });
      await toReview();
      click('Start transfer');
      expect(screen.getByRole('button', { name: 'Cancel transfer' })).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel transfer' })).not.toBeInTheDocument());
      expect(screen.getByText("The import can't be cancelled once it starts.")).toBeInTheDocument();
      release();
      expect(await screen.findByText('Transfer complete')).toBeInTheDocument();
    });

    it('keeps Cancel hidden once the import has failed, while cleanup is still running', async () => {
      let release!: () => void;
      let cleanups = 0;
      setup({
        overrides: {
          consumeFile: () => ({ status: 500 }),
          // Cleanup runs on the source, then the target: hold the first, let the second through.
          deleteContentTransfer: () => (cleanups++ === 0 ? new Promise<FakeReply>((r) => (release = () => r({}))) : {}),
        },
      });
      await toReview();
      click('Start transfer');
      // The failure is logged, and the import step marked failed, just before cleanup starts.
      await screen.findByText('HTTP 500');
      await waitFor(() => expect(release).toBeTypeOf('function'));
      expect(screen.queryByRole('button', { name: 'Cancel transfer' })).not.toBeInTheDocument();
      expect(screen.getByText("The import can't be cancelled once it starts.")).toBeInTheDocument();
      release();
      expect(await screen.findByRole('heading', { level: 1, name: 'Transfer failed' })).toBeInTheDocument();
    });

    it('the header home button is disabled while running and does not abort', async () => {
      let release!: () => void;
      let chunks = 0;
      const { calls, onHome } = setup({
        overrides: {
          getChunk: () =>
            chunks++ === 0 ? new Promise<FakeReply>((r) => (release = () => r({ data: new Blob(['c']) }))) : { data: new Blob(['c']) },
        },
      });
      await toReview();
      click('Start transfer');
      await waitFor(() => expect(release).toBeTypeOf('function'));
      const home = screen.getByRole('button', { name: 'Content Transfer' });
      expect(home).toBeDisabled();
      fireEvent.click(home);
      expect(onHome).not.toHaveBeenCalled();
      expect(ofKey(calls, 'deleteContentTransfer')).toHaveLength(0);
      // Later chunks resolve at once; the run carries on to the end.
      release();
      expect(await screen.findByText('Transfer complete')).toBeInTheDocument();
      expect(ofKey(calls, 'saveChunk').length).toBeGreaterThan(0);
    });

    it('unmount aborts the run', async () => {
      let release!: () => void;
      const { calls, unmount } = setup({
        overrides: { getChunk: () => new Promise<FakeReply>((r) => (release = () => r({ data: new Blob(['c']) }))) },
      });
      await toReview();
      click('Start transfer');
      await waitFor(() => expect(release).toBeTypeOf('function'));
      unmount();
      release();
      await waitFor(() => expect(ofKey(calls, 'deleteContentTransfer')).toHaveLength(2));
      expect(ofKey(calls, 'saveChunk')).toHaveLength(0);
    });
  });

  it('a production target needs the checkbox before Start, every time Review opens', async () => {
    setup({ envs: [DEV, PROD] });
    await toReview();
    const start = () => screen.getByRole('button', { name: 'Start transfer' });
    expect(start()).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'I understand this writes to Acme Production' }));
    expect(start()).toBeEnabled();
    click('Back');
    click('Review transfer');
    expect(start()).toBeDisabled();
  });

  it('a failed run shows Transfer failed and Try again returns to Review', async () => {
    setup({ overrides: { getContentTransferStatus: () => ({ data: { State: 'Failed' } }) } });
    await toReview();
    click('Start transfer');
    const heading = await screen.findByRole('heading', { level: 1, name: 'Transfer failed' });
    await waitFor(() => expect(heading).toHaveFocus());
    // Durations of the finished and the failed step.
    expect(within(screen.getByRole('list', { name: 'Steps' })).getAllByText('0 s')).toHaveLength(2);
    click('Try again');
    expect(screen.getByRole('heading', { level: 1, name: 'Ready to transfer' })).toHaveFocus();
  });

  it('export success downloads once and Download package downloads again', async () => {
    const create = vi.fn(() => 'blob:pkg');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    const { calls } = setup({ mode: 'export' });
    await toReview('Review export');
    click('Create package');
    expect(await screen.findByText('Package ready')).toBeInTheDocument();
    expect(create).toHaveBeenCalledTimes(1);
    expect(revoke).not.toHaveBeenCalled();
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:pkg'), { timeout: 1500 });
    expect(names[0]).toMatch(/^contentTransfer-Acme · Development-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(ofKey(calls, 'saveChunk')).toHaveLength(0);

    click('Download package');
    expect(create).toHaveBeenCalledTimes(2);
    expect(names[1]).toBe(names[0]);
  });
});
