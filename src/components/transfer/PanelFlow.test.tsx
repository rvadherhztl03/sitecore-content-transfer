/* eslint-disable @typescript-eslint/no-explicit-any */
import { PanelFlow } from '@/components/transfer/PanelFlow';
import { TIMING } from '@/lib/transfer';
import { fakeClient, type FakeReply } from '@/test/fakeClient';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const DEV = 'Acme · Development';
const QA = 'Acme · QA';
const PROD = 'Acme Production';
const HOME = '/sitecore/content/Acme/Home';
const ABOUT = '/sitecore/content/Acme/About';
const NEWS = '/sitecore/content/Acme/News';
const ONE_ENV = 'Grant this app access to another environment in Cloud Portal to transfer between environments.';
const NO_PAGE = 'Open a page in the Pages editor to send it.';
const CT = 'xmc.contentTransfer.';

type Handler = (params: any) => FakeReply | Promise<FakeReply>;

const context = (...names: string[]) => ({
  data: { resourceAccess: names.map((name, i) => ({ resourceId: `r${i + 1}`, tenantDisplayName: name, context: { preview: `ctx-${name}` } })) },
});

// Modelled on happyHandlers in src/lib/transfer.test.ts.
function handlers(names: string[], overrides: Record<string, Handler>): Record<string, Handler> {
  let statusCalls = 0;
  return {
    'application.context': () => context(...names),
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
    // The page's children, for "This page + child pages".
    'xmc.authoring.graphql': () => ({
      data: { data: { item: { children: { nodes: ['Team', 'Jobs'].map((n) => ({ itemId: n, name: n, path: `${HOME}/${n}`, children: { nodes: [] } })) } } } },
    }),
    ...Object.fromEntries(Object.entries(overrides).map(([k, h]) => [CT + k, h])),
  };
}

type Page = { pageName?: string; pagePath?: string };
const HOME_PAGE: Page = { pageName: 'Home', pagePath: HOME };

function setup({ names = [DEV, QA, PROD], overrides = {}, page = HOME_PAGE }: { names?: string[]; overrides?: Record<string, Handler>; page?: Page } = {}) {
  const { client, calls } = fakeClient(handlers(names, overrides));
  const view = render(<PanelFlow client={client} {...page} />);
  return { calls, ...view, show: (next: Page) => view.rerender(<PanelFlow client={client} {...next} />) };
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const ofKey = (calls: { key: string }[], k: string) => calls.filter((c) => c.key === CT + k) as any[];
const send = () => screen.getByRole('button', { name: /^Send to / });
const ready = () => screen.findByLabelText('From');

// Opens a Radix select from the keyboard and picks an option.
function pick(label: string, option: string) {
  fireEvent.keyDown(screen.getByLabelText(label), { key: 'Enter' });
  fireEvent.click(screen.getByRole('option', { name: option }));
}
async function route(from = DEV, to = QA, options: Parameters<typeof setup>[0] = {}) {
  const view = setup(options);
  await ready();
  pick('From', from);
  pick('To', to);
  return view;
}
async function toReview(from = DEV, to = QA, options: Parameters<typeof setup>[0] = {}) {
  const view = await route(from, to, options);
  fireEvent.click(send());
  return view;
}

describe('PanelFlow', () => {
  let pollMs: number;
  beforeEach(() => {
    pollMs = TIMING.pollMs;
    TIMING.pollMs = 0;
  });
  afterEach(() => {
    TIMING.pollMs = pollMs;
  });

  describe('Form', () => {
    it('shows the page and starts with nothing picked and Send disabled', async () => {
      setup();
      expect(screen.getByRole('heading', { level: 1, name: 'Send this page' })).toBeInTheDocument();
      expect(await ready()).toHaveTextContent('Choose an environment');
      expect(screen.getByText('Home')).toBeInTheDocument();
      expect(screen.getByText(HOME)).toBeInTheDocument();
      expect(screen.getByLabelText('To')).toHaveTextContent('Choose an environment');
      expect(screen.getByLabelText('Include')).toHaveTextContent('This page + all subpages');
      expect(screen.getByLabelText('If it already exists on the target')).toHaveTextContent('Replace it and everything below');
      expect(send()).toHaveAccessibleName('Send to target');
      expect(send()).toBeDisabled();
      expect(screen.getByText("You'll confirm before anything is written.")).toBeInTheDocument();
    });

    it('names the target on Send once both environments are picked', async () => {
      await route();
      expect(send()).toHaveAccessibleName('Send to Acme · QA');
      expect(send()).toBeEnabled();
      expect(screen.getByLabelText('If it already exists on Acme · QA')).toBeInTheDocument();
    });

    it('stays disabled until both are picked', async () => {
      setup();
      await ready();
      pick('From', DEV);
      expect(send()).toBeDisabled();
    });

    it('stays disabled with the same environment twice, and says why', async () => {
      await route(QA, QA);
      expect(send()).toBeDisabled();
      expect(screen.getByText('From and To must be different environments.')).toBeInTheDocument();
      pick('To', DEV);
      expect(send()).toBeEnabled();
      expect(screen.queryByText('From and To must be different environments.')).not.toBeInTheDocument();
    });

    it('offers the Panel wording for replacing only this page', async () => {
      await route();
      fireEvent.keyDown(screen.getByLabelText('If it already exists on Acme · QA'), { key: 'Enter' });
      expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
        'Replace it and everything below',
        'Replace this page only',
        "Keep what's there",
      ]);
    });

    it('keeps long labels readable: the value truncates and carries the full name as a title', async () => {
      await route();
      const from = screen.getByLabelText('From');
      expect(from).toHaveAttribute('title', DEV);
      expect(from.className).toContain('*:data-[slot=select-value]:truncate');
      expect(from.className).toContain('*:data-[slot=select-value]:block');
      expect(from.className).not.toContain('*:data-[slot=select-value]:flex');
    });

    it('without a page it says so and Send stays disabled', async () => {
      await route(DEV, QA, { page: {} });
      expect(screen.getByText(NO_PAGE)).toBeInTheDocument();
      expect(send()).toBeDisabled();
    });

    it('with one environment it shows the access message instead of the pickers', async () => {
      setup({ names: [DEV] });
      expect(await screen.findByText(ONE_ENV)).toBeInTheDocument();
      expect(screen.queryByLabelText('From')).not.toBeInTheDocument();
      expect(send()).toBeDisabled();
    });

    it('shows a Retry alert when the environments fail to load', async () => {
      let calls = 0;
      const { client } = fakeClient({
        ...handlers([DEV, QA], {}),
        'application.context': () => {
          if (calls++ === 0) throw new Error('no context');
          return context(DEV, QA);
        },
      });
      render(<PanelFlow client={client} {...HOME_PAGE} />);
      expect(await screen.findByRole('alert')).toHaveTextContent('no context');
      click('Retry');
      expect(await ready()).toBeInTheDocument();
    });
  });

  describe('Review', () => {
    it('shows the route, the page and what will happen, with Start and Back', async () => {
      await toReview();
      expect(screen.getByRole('heading', { name: 'Ready to transfer' })).toBeInTheDocument();
      expect(screen.getByText('Nothing has been written yet. Check the route and items, then start.')).toBeInTheDocument();
      const review = screen.getByRole('region', { name: 'Review' });
      expect(within(review).getByText(DEV)).toBeInTheDocument();
      expect(within(review).getByText(QA)).toBeInTheDocument();
      expect(within(review).getByText(HOME)).toBeInTheDocument();
      expect(within(review).getByText('This page + all subpages')).toBeInTheDocument();
      expect(within(review).getByText('Replace it and everything below')).toBeInTheDocument();
      expect(screen.getByRole('note')).toHaveTextContent('1 item replaces everything below it on Acme · QA.');
      expect(screen.getByText(/You can cancel until the import into Acme · QA starts/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled();
      expect(screen.queryByLabelText('From')).not.toBeInTheDocument();
    });

    it('reflects the include and merge choices, and warns only when replacing the tree', async () => {
      await route();
      pick('Include', 'This page only');
      pick('If it already exists on Acme · QA', 'Replace this page only');
      fireEvent.click(send());
      const review = screen.getByRole('region', { name: 'Review' });
      expect(within(review).getByText('This page only')).toBeInTheDocument();
      expect(within(review).getByText('Replace this page only')).toBeInTheDocument();
      expect(screen.queryByRole('note')).not.toBeInTheDocument();
    });

    it('child pages moves off replacing everything below and no longer offers it', async () => {
      await route();
      pick('Include', 'This page + child pages');
      const merge = screen.getByLabelText('If it already exists on Acme · QA');
      expect(merge).toHaveTextContent('Replace it and its child pages');
      fireEvent.keyDown(merge, { key: 'Enter' });
      expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Replace it and its child pages', "Keep what's there"]);
      fireEvent.click(screen.getByRole('option', { name: 'Replace it and its child pages' }));
      fireEvent.click(send());
      const review = screen.getByRole('region', { name: 'Review' });
      expect(within(review).getByText('This page + child pages')).toBeInTheDocument();
      expect(within(review).getByText('Replace it and its child pages')).toBeInTheDocument();
      expect(screen.queryByRole('note')).not.toBeInTheDocument();
    });

    it('this page only does not offer replacing everything below', async () => {
      await route();
      pick('Include', 'This page only');
      const merge = screen.getByLabelText('If it already exists on Acme · QA');
      expect(merge).toHaveTextContent('Replace this page only');
      fireEvent.keyDown(merge, { key: 'Enter' });
      expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Replace this page only', "Keep what's there"]);
    });

    it('Back returns to the form with the choices kept', async () => {
      await toReview();
      click('Back');
      expect(screen.getByLabelText('From')).toHaveTextContent(DEV);
      expect(screen.getByLabelText('To')).toHaveTextContent(QA);
      expect(send()).toBeEnabled();
    });

    it('a production target needs the checkbox before Start, every time the review opens', async () => {
      await toReview(DEV, PROD);
      const start = () => screen.getByRole('button', { name: 'Start' });
      expect(screen.getByText('Acme Production looks like a production environment.')).toBeInTheDocument();
      expect(start()).toBeDisabled();
      fireEvent.click(screen.getByRole('checkbox', { name: 'I understand this writes to Acme Production' }));
      expect(start()).toBeEnabled();
      click('Back');
      fireEvent.click(send());
      expect(screen.getByRole('checkbox', { name: 'I understand this writes to Acme Production' })).not.toBeChecked();
      expect(start()).toBeDisabled();
    });

    it('a ticked production box does not carry over to another production target', async () => {
      await toReview(DEV, PROD, { names: [DEV, PROD, 'Acme Prod EU'] });
      fireEvent.click(screen.getByRole('checkbox', { name: 'I understand this writes to Acme Production' }));
      click('Back');
      pick('To', 'Acme Prod EU');
      fireEvent.click(send());
      expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    });

    it('a non-production target needs no confirmation', async () => {
      await toReview();
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });
  });

  describe('Run', () => {
    it('sends the reviewed page, scope, merge and route, once', async () => {
      const { calls } = await toReview();
      const start = screen.getByRole('button', { name: 'Start' });
      fireEvent.click(start);
      fireEvent.click(start);
      expect(await screen.findByRole('heading', { name: 'Transfer complete' })).toBeInTheDocument();
      const create = ofKey(calls, 'createContentTransfer');
      expect(create).toHaveLength(1);
      expect(create[0].params.query.sitecoreContextId).toBe(`ctx-${DEV}`);
      expect(create[0].params.body.configuration.dataTrees).toEqual([
        { itemPath: HOME, scope: 'ItemAndDescendants', mergeStrategy: 'OverrideExistingTree' },
      ]);
      expect(ofKey(calls, 'saveChunk').map((c) => c.params.query.sitecoreContextId)).toEqual([`ctx-${QA}`, `ctx-${QA}`]);
      expect(ofKey(calls, 'consumeFile')[0].params.query).toMatchObject({ databaseName: 'master', sitecoreContextId: `ctx-${QA}` });
    });

    it('child pages sends the page and each child page on its own', async () => {
      const { calls } = await route();
      pick('Include', 'This page + child pages');
      fireEvent.click(send());
      click('Start');
      await screen.findByRole('heading', { name: 'Transfer complete' });
      expect(ofKey(calls, 'createContentTransfer')[0].params.body.configuration.dataTrees).toEqual(
        [HOME, `${HOME}/Team`, `${HOME}/Jobs`].map((itemPath) => ({ itemPath, scope: 'SingleItem', mergeStrategy: 'OverrideExistingItem' })),
      );
    });

    it('this page only, replacing only this page, is what is sent', async () => {
      const { calls } = await route();
      pick('Include', 'This page only');
      pick('If it already exists on Acme · QA', 'Replace this page only');
      fireEvent.click(send());
      click('Start');
      await screen.findByRole('heading', { name: 'Transfer complete' });
      expect(ofKey(calls, 'createContentTransfer')[0].params.body.configuration.dataTrees).toEqual([
        { itemPath: HOME, scope: 'SingleItem', mergeStrategy: 'OverrideExistingItem' },
      ]);
    });

    it('focuses the result heading and Back to home returns to the form with the route kept', async () => {
      await toReview();
      click('Start');
      const heading = await screen.findByRole('heading', { name: 'Transfer complete' });
      await waitFor(() => expect(heading).toHaveFocus());
      expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
      click('Back to home');
      expect(screen.getByRole('heading', { level: 1, name: 'Send this page' })).toBeInTheDocument();
      expect(screen.getByLabelText('From')).toHaveTextContent(DEV);
      expect(send()).toHaveAccessibleName('Send to Acme · QA');
    });

    it('a failed run offers Try again, which returns to a fresh review', async () => {
      await toReview(DEV, PROD, { overrides: { getContentTransferStatus: () => ({ data: { State: 'Failed' } }) } });
      fireEvent.click(screen.getByRole('checkbox', { name: 'I understand this writes to Acme Production' }));
      click('Start');
      const heading = await screen.findByRole('heading', { name: 'Transfer failed' });
      await waitFor(() => expect(heading).toHaveFocus());
      click('Try again');
      expect(screen.getByRole('heading', { name: 'Ready to transfer' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    });

    it('offers Cancel until the import starts, then explains it cannot be cancelled', async () => {
      let release!: () => void;
      await toReview(DEV, QA, { overrides: { consumeFile: () => new Promise<FakeReply>((r) => (release = () => r({}))) } });
      click('Start');
      expect(screen.getByRole('button', { name: 'Cancel transfer' })).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel transfer' })).not.toBeInTheDocument());
      expect(screen.getByText("The import can't be cancelled once it starts.")).toBeInTheDocument();
      release();
      expect(await screen.findByRole('heading', { name: 'Transfer complete' })).toBeInTheDocument();
    });

    it('Cancel before the import stops the run', async () => {
      const { calls } = await toReview(DEV, QA, { overrides: { getContentTransferStatus: () => ({ data: { State: 'Processing' } }) } });
      click('Start');
      click('Cancel transfer');
      expect(await screen.findByRole('heading', { name: 'Transfer failed' })).toBeInTheDocument();
      expect(ofKey(calls, 'saveChunk')).toHaveLength(0);
      expect(ofKey(calls, 'deleteContentTransfer')).toHaveLength(2);
    });

    it('unmount aborts the run', async () => {
      let release!: () => void;
      const { calls, unmount } = await toReview(DEV, QA, {
        overrides: { getChunk: () => new Promise<FakeReply>((r) => (release = () => r({ data: new Blob(['c']) }))) },
      });
      click('Start');
      await waitFor(() => expect(release).toBeTypeOf('function'));
      unmount();
      release();
      await waitFor(() => expect(ofKey(calls, 'deleteContentTransfer')).toHaveLength(2));
      expect(ofKey(calls, 'saveChunk')).toHaveLength(0);
    });
  });

  describe('Held page', () => {
    it('a new page during review does not change what is run; the form shows it after Back to home', async () => {
      let release!: () => void;
      let chunks = 0;
      const { calls, show } = await toReview(DEV, QA, {
        overrides: {
          getChunk: () =>
            chunks++ === 0 ? new Promise<FakeReply>((r) => (release = () => r({ data: new Blob(['c']) }))) : { data: new Blob(['c']) },
        },
      });
      // The editor moves to another page while the review is open...
      show({ pageName: 'About', pagePath: ABOUT });
      const review = screen.getByRole('region', { name: 'Review' });
      expect(within(review).getByText(HOME)).toBeInTheDocument();
      expect(screen.queryByText(ABOUT)).not.toBeInTheDocument();

      click('Start');
      await waitFor(() => expect(release).toBeTypeOf('function'));
      // ...and again while the run is in progress.
      show({ pageName: 'News', pagePath: NEWS });
      release();
      expect(await screen.findByRole('heading', { name: 'Transfer complete' })).toBeInTheDocument();
      expect(ofKey(calls, 'createContentTransfer')[0].params.body.configuration.dataTrees[0].itemPath).toBe(HOME);

      click('Back to home');
      expect(screen.getByText('News')).toBeInTheDocument();
      expect(screen.getByText(NEWS)).toBeInTheDocument();
      expect(screen.queryByText(HOME)).not.toBeInTheDocument();
    });

    it('Back from the review applies the latest page', async () => {
      const { show } = await toReview();
      show({ pageName: 'About', pagePath: ABOUT });
      click('Back');
      expect(screen.getByText(ABOUT)).toBeInTheDocument();
      fireEvent.click(send());
      expect(within(screen.getByRole('region', { name: 'Review' })).getByText(ABOUT)).toBeInTheDocument();
    });

    it('a page that goes away on the form leaves Send disabled', async () => {
      const { show } = await route();
      show({});
      expect(screen.getByText(NO_PAGE)).toBeInTheDocument();
      expect(send()).toBeDisabled();
    });
  });
});
