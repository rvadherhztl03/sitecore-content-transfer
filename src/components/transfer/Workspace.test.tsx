/* eslint-disable @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Workspace, blockReason } from '@/components/transfer/Workspace';
import { newTree } from '@/lib/queue';
import { TIMING } from '@/lib/transfer';
import { fakeClient, type FakeReply } from '@/test/fakeClient';

const ONE_ENV = 'Grant this app access to another environment in Cloud Portal to transfer between environments.';
const DEV = { id: 'r1', name: 'Dev', contextId: 'ctx-dev' };
const QA = { id: 'r2', name: 'QA', contextId: 'ctx-qa' };

describe('blockReason', () => {
  const trees = [newTree('/sitecore/content/Home')];
  const ok = { envs: [DEV, QA], source: DEV, target: QA, trees, hasPackage: false };

  it('checks the rules in order', () => {
    expect(blockReason('transfer', { ...ok, envs: [DEV], target: undefined, trees: [] })).toBe(ONE_ENV);
    expect(blockReason('transfer', { ...ok, target: undefined })).toBe('Choose an environment.');
    expect(blockReason('export', { ...ok, source: undefined })).toBe('Choose an environment.');
    expect(blockReason('import', { ...ok, target: undefined })).toBe('Choose an environment.');
    expect(blockReason('transfer', { ...ok, target: DEV, trees: [] })).toBe('Source and target must be different environments.');
    expect(blockReason('transfer', { ...ok, trees: [] })).toBe('Add at least one item to the queue.');
    expect(blockReason('export', { ...ok, envs: [DEV], target: undefined, trees: [] })).toBe('Add at least one item to the queue.');
    expect(blockReason('import', { ...ok, envs: [DEV], source: undefined, target: DEV })).toBe('Choose a package to import.');
    expect(blockReason('transfer', ok)).toBeNull();
    expect(blockReason('export', { ...ok, envs: [DEV], target: undefined })).toBeNull();
    expect(blockReason('import', { ...ok, trees: [], hasPackage: true })).toBeNull();
  });
});

type Handler = (params: any) => FakeReply | Promise<FakeReply>;

const context = (...names: string[]) => ({
  data: {
    resourceAccess: names.map((name, i) => ({
      resourceId: `r${i + 1}`,
      tenantDisplayName: name,
      context: { preview: `ctx-${name}` },
    })),
  },
});

// Modeled on happyHandlers in src/lib/transfer.test.ts.
function handlers(ctx: Handler): Record<string, Handler> {
  const CT = 'xmc.contentTransfer.';
  let statusCalls = 0;
  return {
    'application.context': ctx,
    'xmc.authoring.graphql': () => ({
      data: {
        data: {
          item: {
            children: { nodes: [{ itemId: 'c', name: 'content', path: '/sitecore/content', children: { nodes: [] } }] },
          },
        },
      },
    }),
    [CT + 'createContentTransfer']: () => ({}),
    [CT + 'getContentTransferStatus']: () =>
      statusCalls++ === 0
        ? { data: { State: 'Processing' } }
        : { data: { State: 'Completed', ChunkSetsMetadata: [{ ChunkSetId: 'cs1', ChunkCount: 1 }] } },
    [CT + 'getChunk']: () => ({ data: new Blob(['c0']), headers: { 'content-disposition': 'attachment; IsMedia=false' } }),
    [CT + 'saveChunk']: () => ({}),
    [CT + 'completeChunkSetTransfer']: () => ({ data: { ContentTransferFileName: 'f-cs1.raif' } }),
    [CT + 'consumeFile']: () => ({}),
    [CT + 'getBlobState']: () => ({ data: { status: 'OK' } }),
    [CT + 'deleteContentTransfer']: () => ({}),
  };
}

function setup(ctx: Handler, props: { initialItemPath?: string } = {}) {
  const { client, calls } = fakeClient(handlers(ctx));
  render(<Workspace client={client} {...props} />);
  return { calls };
}

// The source tree loads its root once the environments arrive; wait for it so no update lands outside act().
const treeLoaded = () => screen.findByText('content');

describe('Workspace', () => {
  let pollMs: number;
  beforeEach(() => {
    pollMs = TIMING.pollMs;
    TIMING.pollMs = 0;
  });
  afterEach(() => {
    TIMING.pollMs = pollMs;
  });

  it('lists environments from the application context', async () => {
    setup(() => context('Dev', 'QA'));
    expect(await screen.findByLabelText('Source')).toHaveTextContent('Dev');
    expect(screen.getByLabelText('Target')).toHaveTextContent('QA');
    await treeLoaded();
  });

  it('shows the access notice with one environment', async () => {
    setup(() => context('Dev'));
    expect(await screen.findByText(ONE_ENV)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start transfer' })).toBeDisabled();
    await treeLoaded();
  });

  it('shows a Retry alert when the context fails', async () => {
    let calls = 0;
    setup(() => {
      if (calls++ === 0) throw new Error('no context');
      return context('Dev', 'QA');
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('no context');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByLabelText('Source')).toHaveTextContent('Dev');
    await treeLoaded();
  });

  it('warns before writing to a prod-looking target', async () => {
    setup(() => context('Dev', 'Prod-EU'), { initialItemPath: '/sitecore/content/Home' });
    await treeLoaded();
    fireEvent.click(screen.getByRole('button', { name: 'Start transfer' }));
    expect(
      within(screen.getByRole('alertdialog')).getByText(
        'Prod-EU looks like a production environment. Double-check before continuing.',
      ),
    ).toBeInTheDocument();
  });

  it('compact mode has no tabs or tree and sends to the target', async () => {
    const { client } = fakeClient(handlers(() => context('Dev', 'QA')));
    render(<Workspace client={client} compact initialItemPath="/sitecore/content/Home" />);
    expect(await screen.findByRole('button', { name: 'Send to QA' })).toBeEnabled();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Filter loaded items')).not.toBeInTheDocument();
    expect(screen.getByText('/sitecore/content/Home')).toBeInTheDocument();
  });

  it('keeps Import usable with one environment', async () => {
    setup(() => context('Dev'));
    await treeLoaded();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Import' }));
    expect(screen.getByLabelText('Target')).toHaveTextContent('Dev');
    expect(screen.getByText('Choose a package to import.')).toBeInTheDocument();
    expect(screen.queryByText('Choose an environment.')).not.toBeInTheDocument();
    expect(screen.queryByText(ONE_ENV)).not.toBeInTheDocument();
  });

  it('holds a new page path until the confirmed run is over', async () => {
    const { client, calls } = fakeClient(handlers(() => context('Dev', 'QA')));
    const { rerender } = render(<Workspace client={client} compact initialItemPath="/sitecore/content/A" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Send to QA' }));
    rerender(<Workspace client={client} compact initialItemPath="/sitecore/content/B" />);
    expect(within(screen.getByRole('alertdialog')).getByText('/sitecore/content/A')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByText('Completed')).toBeInTheDocument();
    const create = calls.find((c) => c.key === 'xmc.contentTransfer.createContentTransfer');
    expect(create?.params.body.configuration.dataTrees).toEqual([newTree('/sitecore/content/A')]);

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByText('/sitecore/content/B')).toBeInTheDocument();
    expect(screen.queryByText('/sitecore/content/A')).not.toBeInTheDocument();
  });

  it('runs a transfer end to end and blocks a second start', async () => {
    const { calls } = setup(() => context('Dev', 'QA'), { initialItemPath: '/sitecore/content/Home' });
    await treeLoaded();
    fireEvent.click(screen.getByRole('button', { name: 'Start transfer' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Copy 1 item tree from Dev → QA (master). Merge: Override tree.');
    expect(within(dialog).getByText('/sitecore/content/Home')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    // The run sheet is modal, so the page behind it is aria-hidden.
    expect(screen.getByRole('button', { name: 'Start transfer', hidden: true })).toBeDisabled();
    expect(await screen.findByText('Completed')).toBeInTheDocument();
    const create = calls.find((c) => c.key === 'xmc.contentTransfer.createContentTransfer');
    expect(create?.params.body.configuration.dataTrees).toEqual([newTree('/sitecore/content/Home')]);
  });
});
