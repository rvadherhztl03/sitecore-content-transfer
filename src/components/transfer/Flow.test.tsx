/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Flow } from '@/components/transfer/Flow';
import { newTree } from '@/lib/queue';
import type { Env } from '@/lib/sdk';
import { TIMING } from '@/lib/transfer';
import {
  compareReply,
  fakeClient,
  isPreflight,
  isRelated,
  preflightReply,
  relatedReply,
  type CompareFake,
  type FakeReply,
  type RelatedFake,
} from '@/test/fakeClient';

const DEV: Env = { id: 'dev', name: 'Acme · Development', contextId: 'ctx-dev', tenantName: 'acme-dev' };
const QA: Env = { id: 'qa', name: 'Acme · QA', contextId: 'ctx-qa', tenantName: 'acme-qa' };
const PROD: Env = { id: 'prod', name: 'Acme Production', contextId: 'ctx-prod' };
const HOME = '/sitecore/content/Home';
const CT = 'xmc.contentTransfer.';

type Handler = (params: any) => FakeReply | Promise<FakeReply>;

type Find = Parameters<typeof preflightReply>[0];
// Every path is on both environments as the same item.
const EVERYWHERE: Find = (_, path) => ({ id: path });
// The default: like EVERYWHERE, except QA doesn't have Home yet. The check finds nothing wrong, and with nothing on QA
// to overwrite there is no backup step.
const NEW_ON_QA: Find = (ctx, path) => (ctx === 'ctx-qa' && path === HOME ? undefined : { id: path });

// Modelled on happyHandlers in src/lib/transfer.test.ts, plus the tree query and the pre-flight check.
function handlers(
  overrides: Record<string, Handler> = {},
  find: Find | Handler = NEW_ON_QA,
  related: Record<string, RelatedFake[]> = {},
  compare: Record<string, Record<string, CompareFake>> = {},
): Record<string, Handler> {
  let statusCalls = 0;
  const check: Handler = find.length === 2 ? preflightReply(find as Find) : (find as Handler);
  return {
    'xmc.authoring.graphql': (p) =>
      isPreflight(p)
        ? check(p)
        : isRelated(p)
          ? relatedReply(related)(p)
          : p.body.query.startsWith('query Compare')
            ? compareReply(compare)(p)
            : p.body.query.startsWith('mutation')
          ? { data: { data: { publishItem: { operationId: 'op-1' } } } }
          : p.body.query.includes('publishingStatus')
            ? { data: { data: { publishingStatus: { state: 'COMPLETED', isDone: true, isFailed: false, processed: 2 } } } }
            : { data: { data: { item: { children: { nodes: [{ itemId: 'c', name: 'content', path: '/sitecore/content', children: { nodes: [] } }] } } } } },
    'xmc.sites.listLanguages': () => ({ data: [{ name: 'en' }] }),
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

function setup({
  mode = 'transfer',
  envs = [DEV, QA, PROD],
  overrides = {},
  find,
  related,
  compare,
}: {
  mode?: 'transfer' | 'export';
  envs?: Env[];
  overrides?: Record<string, Handler>;
  find?: Find | Handler;
  related?: Record<string, RelatedFake[]>;
  compare?: Record<string, Record<string, CompareFake>>;
} = {}) {
  const { client, calls } = fakeClient(handlers(overrides, find, related, compare));
  const onHome = vi.fn();
  const view = render(<Flow client={client} mode={mode} envs={envs} onHome={onHome} />);
  return { client, calls, onHome, ...view };
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const group = (name: string) => screen.getByRole('group', { name });
// From is one pick (radios); To can be several (checkboxes).
const radio = (legend: string, env: Env) => within(group(legend)).getByRole(legend === 'To' ? 'checkbox' : 'radio', { name: new RegExp(env.name) });
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
// Counts downloads by file name.
function downloads() {
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:b'), revokeObjectURL: vi.fn() });
  const names: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    names.push(this.download);
  });
  return names;
}
const creates = (calls: { key: string }[]) => ofKey(calls, 'createContentTransfer').map((c) => c.params.query.sitecoreContextId);
const ctxs = (calls: { key: string }[], k: string) => ofKey(calls, k).map((c) => c.params.query.sitecoreContextId);
// Waits for a transfer's pre-flight check to finish, so Start runs with its result.
const checked = () => waitFor(() => expect(screen.queryAllByText(/^Checking/)).toHaveLength(0));
async function toReview(review = 'Review transfer') {
  await toContent();
  addPath();
  click(review);
  if (review === 'Review transfer') await checked();
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

    it('has no database choice: a transfer always writes to master', () => {
      setup();
      expect(screen.queryByRole('radiogroup', { name: /database/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: /database/i })).not.toBeInTheDocument();
      expect(within(screen.getByRole('contentinfo')).getByText('· master')).toBeInTheDocument();
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
      expect(within(group('To')).queryByRole('checkbox', { checked: true })).not.toBeInTheDocument();
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

  describe('Compare', () => {
    const R = '/sitecore/content/Acme';
    const tab = (name: string | RegExp) => screen.getByRole('radio', { name });

    it('picks new and changed items from a comparison into the list, and Browse still shows the tree', async () => {
      setup({
        compare: {
          'ctx-dev': { [R]: { id: 'root', rev: '1' }, [`${R}/Home`]: { id: 'home', rev: '2' }, [`${R}/News`]: { id: 'news', rev: '1' } },
          'ctx-qa': { [R]: { id: 'root', rev: '1' }, [`${R}/Home`]: { id: 'home', rev: '1' } },
        },
      });
      await toContent();
      expect(tab('Browse')).toBeChecked();
      fireEvent.click(tab('Compare with Acme · QA'));
      expect(screen.getByLabelText('Compare from')).toHaveValue('/sitecore/content');
      fireEvent.change(screen.getByLabelText('Compare from'), { target: { value: R } });
      click('Compare');
      await screen.findByRole('list', { name: 'Differences' });
      click('Select all new and changed');
      click('Add 2 to the list');
      expect(screen.getByRole('heading', { name: 'Selected 2' })).toBeInTheDocument();
      expect(screen.getByLabelText(`If ${R}/Home exists`)).toHaveTextContent('Replace this item only');
      expect(screen.getByLabelText(`If ${R}/News exists`)).toHaveTextContent("Keep what's there");

      fireEvent.click(tab('Browse'));
      expect(screen.getByText('content')).toBeVisible();
      // The comparison is kept while switching.
      fireEvent.click(tab('Compare with Acme · QA'));
      expect(screen.getByRole('list', { name: 'Differences' })).toBeInTheDocument();
    });

    it('starts from the first queued item', async () => {
      setup();
      await toContent();
      addPath(HOME);
      fireEvent.click(tab('Compare with Acme · QA'));
      expect(screen.getByLabelText('Compare from')).toHaveValue(HOME);
    });

    it('export has no target to compare with', async () => {
      setup({ mode: 'export' });
      await toContent();
      expect(screen.queryByRole('radio', { name: /^Compare with/ })).not.toBeInTheDocument();
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

  describe('Pre-flight check', () => {
    const PAGE = '/sitecore/content/Acme/Page';
    const ACME = '/sitecore/content/Acme';
    const GQL = 'xmc.authoring.graphql';

    it('checks the target on Review and shows what it holds for each item', async () => {
      setup({ find: EVERYWHERE });
      await toContent();
      addPath();
      click('Review transfer');
      expect(screen.getByRole('status')).toHaveTextContent('Checking Acme · QA…');
      expect(await screen.findByText('Pre-flight check: everything is in place on Acme · QA.')).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'On Acme · QA' })).toBeInTheDocument();
      expect(screen.getByRole('row', { name: /Home/ })).toHaveTextContent('Exists');
    });

    it('Add missing parents puts the parent in the list, and the transfer sends it first', async () => {
      const { calls } = setup({ find: (ctx, path) => (ctx === 'ctx-qa' && (path === ACME || path === PAGE) ? undefined : { id: path }) });
      await toContent();
      addPath(PAGE);
      click('Review transfer');
      const note = await screen.findByRole('note', { name: 'Missing parents on Acme · QA' });
      expect(within(note).getByText(ACME)).toBeInTheDocument();
      expect(screen.getByRole('row', { name: /Page/ })).toHaveTextContent('Parent missing');
      fireEvent.click(within(note).getByRole('button', { name: 'Add missing parents' }));
      expect(await screen.findByText('Pre-flight check: everything is in place on Acme · QA.')).toBeInTheDocument();
      const [, parent, page] = screen.getAllByRole('row');
      expect(parent).toHaveTextContent(`Acme${ACME}New`);
      expect(page).toHaveTextContent(`Page${PAGE}New`);
      click('Start transfer');
      await screen.findByText('Transfer complete');
      expect(ofKey(calls, 'createContentTransfer')[0].params.body.configuration.dataTrees).toEqual([
        { itemPath: ACME, scope: 'SingleItem', mergeStrategy: 'KeepExistingItem' },
        newTree(PAGE),
      ]);
    });

    it('Remove from the list drops the items the source lacks', async () => {
      setup({ find: (ctx, path) => (ctx === 'ctx-dev' && path === HOME ? undefined : { id: path }) });
      await toReview();
      const note = await screen.findByRole('note', { name: 'Not found on Acme · Development' });
      fireEvent.click(within(note).getByRole('button', { name: 'Remove from the list' }));
      expect(screen.queryByRole('row', { name: /Home/ })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Start transfer' })).toBeDisabled();
    });

    it('a failed check says so and does not block Start', async () => {
      setup({ find: () => ({ status: 500 }) });
      await toReview();
      expect(await screen.findByRole('note', { name: "Couldn't run the pre-flight check: HTTP 500. You can still start." })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Start transfer' })).toBeEnabled();
    });

    it('Add missing items puts what the item uses into the list, and the transfer sends it', async () => {
      const HERO = '/sitecore/media library/Acme/Hero';
      const HERO_ID = '11111111-2222-3333-4444-555555555555';
      const { calls } = setup({
        related: { 'ctx-dev': [{ id: 'h', path: HOME, fields: { Image: `<image mediaid="{${HERO_ID}}" />` } }, { id: HERO_ID, path: HERO, name: 'Hero' }], 'ctx-qa': [] },
      });
      await toReview();
      const note = screen.getByRole('note', { name: 'Used by your items but not in the list' });
      expect(within(note).getByRole('listitem')).toHaveTextContent(`Hero ${HERO} · used by Home`);
      fireEvent.click(within(note).getByRole('button', { name: 'Add 1 missing item' }));
      await checked();
      expect(screen.queryByRole('note', { name: 'Used by your items but not in the list' })).not.toBeInTheDocument();
      click('Start transfer');
      await screen.findByText('Transfer complete');
      expect(ofKey(calls, 'createContentTransfer')[0].params.body.configuration.dataTrees).toEqual([
        newTree(HOME),
        { itemPath: HERO, scope: 'SingleItem', mergeStrategy: 'KeepExistingItem' },
      ]);
    });

    it('export runs no check', async () => {
      const { calls } = setup({ mode: 'export' });
      await toReview('Review export');
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(calls.filter((c) => c.key === GQL && isPreflight(c.params))).toHaveLength(0);
    });
  });

  describe('Backup', () => {
    const box = () => screen.getByRole('checkbox', { name: 'Back up Acme · QA first' });

    it('is offered, ticked, when the transfer overwrites items on the target', async () => {
      setup({ find: EVERYWHERE });
      await toReview();
      expect(box()).toBeChecked();
      expect(box()).toHaveAccessibleDescription(
        'Saves what this transfer overwrites on Acme · QA as a package, so you can restore it with Install a package. Large trees take longer.',
      );
    });

    it('says so when nothing on the target would be overwritten', async () => {
      setup();
      await toReview();
      expect(screen.getByText('Nothing on Acme · QA to back up.')).toBeInTheDocument();
      expect(screen.queryByRole('checkbox', { name: /Back up/ })).not.toBeInTheDocument();
    });

    it('backs up the target first, downloads it, and offers it again with how to restore it', async () => {
      const names = downloads();
      const { calls } = setup({ find: EVERYWHERE });
      await toReview();
      click('Start transfer');
      expect(await screen.findByText('Transfer complete')).toBeInTheDocument();
      expect(creates(calls)).toEqual(['ctx-qa', 'ctx-dev']);
      expect(ofKey(calls, 'createContentTransfer')[0].params.body.configuration.dataTrees).toEqual([
        { itemPath: HOME, scope: 'ItemAndDescendants', mergeStrategy: 'OverrideExistingTree' },
      ]);
      expect(names).toHaveLength(1);
      expect(names[0]).toMatch(/^backup-Acme · QA-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/);
      expect(screen.getByText('A backup of Acme · QA from before this transfer was downloaded. Install it into Acme · QA to undo the transfer.')).toBeInTheDocument();
      click('Download backup');
      expect(names).toEqual([names[0], names[0]]);
    });

    it('unticked, transfers without a backup', async () => {
      const { calls } = setup({ find: EVERYWHERE });
      await toReview();
      fireEvent.click(box());
      click('Start transfer');
      expect(await screen.findByText('Transfer complete')).toBeInTheDocument();
      expect(creates(calls)).toEqual(['ctx-dev']);
      expect(screen.queryByRole('button', { name: 'Download backup' })).not.toBeInTheDocument();
    });

    it('keeps Cancel up to the import step, which the backup step moves along by one', async () => {
      let release!: () => void;
      setup({ find: EVERYWHERE, overrides: { completeChunkSetTransfer: (p) => new Promise<FakeReply>((r) => (release = () => r({ data: { ContentTransferFileName: `f-${p.path.chunksetId}.raif` } }))) } });
      await toReview();
      click('Start transfer');
      await waitFor(() => expect(release).toBeTypeOf('function'));
      // Assembling on the target: nothing imported yet.
      expect(screen.getByRole('button', { name: 'Cancel transfer' })).toBeInTheDocument();
      release();
      expect(await screen.findByText('Transfer complete')).toBeInTheDocument();
    });

    it('a failed transfer offers the backup to put the target back', async () => {
      downloads();
      setup({ find: EVERYWHERE, overrides: { consumeFile: () => ({ status: 500 }) } });
      await toReview();
      click('Start transfer');
      expect(await screen.findByRole('heading', { level: 1, name: 'Transfer failed' })).toBeInTheDocument();
      expect(screen.getByText('A backup of Acme · QA from before this transfer was downloaded. Install it into Acme · QA to put it back as it was.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Download backup' })).toBeInTheDocument();
      // The import had started, so QA may have changed: it can be restored.
      expect(screen.getByRole('button', { name: 'Restore Acme · QA' })).toBeInTheDocument();
    });

    it('a transfer that failed before the import offers no Restore: QA was not written', async () => {
      downloads();
      setup({ find: EVERYWHERE, overrides: { saveChunk: () => ({ status: 500 }) } });
      await toReview();
      click('Start transfer');
      expect(await screen.findByRole('heading', { level: 1, name: 'Transfer failed' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Download backup' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Restore Acme · QA' })).not.toBeInTheDocument();
    });

    // Runs a backed-up transfer to the end and confirms the restore.
    async function restore(options: Parameters<typeof setup>[0] = {}) {
      downloads();
      const view = setup({ find: EVERYWHERE, ...options });
      await toReview();
      click('Start transfer');
      await screen.findByText('Transfer complete');
      click('Restore Acme · QA');
      click('Restore now');
      return view;
    }

    it('Restore installs the backup back into the target', async () => {
      const { calls } = await restore();
      expect(await screen.findByRole('heading', { level: 1, name: 'Restore complete' })).toBeInTheDocument();
      expect(screen.getByText('Acme · QA is back as it was before the transfer.')).toBeInTheDocument();
      // The transfer saved its two chunks on QA, then the restore uploaded the backup's two.
      const saves = ofKey(calls, 'saveChunk');
      expect(saves.map((c) => c.params.query.sitecoreContextId)).toEqual(['ctx-qa', 'ctx-qa', 'ctx-qa', 'ctx-qa']);
      expect(await Promise.all(saves.slice(2).map((c) => c.params.body.text()))).toEqual(['c0', 'c1']);
      expect(saves[2].params.path.transferId).not.toBe(saves[0].params.path.transferId);
      expect(ofKey(calls, 'consumeFile').map((c) => c.params.query.sitecoreContextId)).toEqual(['ctx-qa', 'ctx-qa']);
      expect(screen.getByRole('button', { name: 'Download backup' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Restore Acme · QA' })).not.toBeInTheDocument();
    });

    it('a failed restore offers Try again, which restores again', async () => {
      let consumes = 0;
      await restore({ overrides: { consumeFile: () => (consumes++ === 1 ? { status: 500 } : {}) } });
      expect(await screen.findByRole('heading', { level: 1, name: 'Restore failed' })).toBeInTheDocument();
      click('Try again');
      expect(await screen.findByRole('heading', { level: 1, name: 'Restore complete' })).toBeInTheDocument();
      expect(consumes).toBe(3);
    });

    it('Start another transfer after a restore starts over at Route', async () => {
      await restore();
      await screen.findByRole('heading', { level: 1, name: 'Restore complete' });
      click('Start another transfer');
      expect(screen.getByRole('heading', { level: 1, name: 'Where is the content going?' })).toBeInTheDocument();
    });
  });

  describe('Several targets', () => {
    const pickProd = () => fireEvent.click(radio('To', PROD));

    it('picks more than one target: names them all, drops the swap and keeps them out of From', () => {
      setup();
      pickProd();
      expect(radio('To', QA)).toBeChecked();
      expect(radio('To', PROD)).toBeChecked();
      expect(within(stepBar()).getByText('Acme · Development → Acme · QA and Acme Production · master')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Swap source and target' })).not.toBeInTheDocument();
      expect(radio('From', PROD)).toBeDisabled();
      expect(within(group('From')).getAllByText('Already a target')).toHaveLength(2);
      // Unpicking every target leaves no route.
      fireEvent.click(radio('To', QA));
      pickProd();
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    });

    it('compares with each target on its own tab', async () => {
      setup();
      pickProd();
      await toContent();
      const tabs = within(screen.getByRole('radiogroup', { name: 'Pick items by' })).getAllByRole('radio').map((r) => r.textContent);
      expect(tabs).toEqual(['Browse', 'Compare with Acme · QA', 'Compare with Acme Production']);
      fireEvent.click(screen.getByRole('radio', { name: 'Compare with Acme Production' }));
      expect(screen.getByRole('heading', { name: 'Compare Acme · Development with Acme Production' })).toBeInTheDocument();
    });

    it('backs up and transfers to each target in turn, confirming production, and restores each on its own', async () => {
      const names = downloads();
      const { calls } = setup({ find: EVERYWHERE });
      pickProd();
      await toReview();
      expect(screen.getByRole('columnheader', { name: 'On Acme Production' })).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: 'Back up Acme · QA and Acme Production first' })).toBeChecked();
      expect(screen.getByRole('button', { name: 'Start transfer' })).toBeDisabled();
      fireEvent.click(screen.getByRole('checkbox', { name: 'I understand this writes to Acme Production' }));
      click('Start transfer');
      expect(await screen.findByText('Transfer complete')).toBeInTheDocument();
      expect(creates(calls)).toEqual(['ctx-qa', 'ctx-prod', 'ctx-dev']);
      expect(ctxs(calls, 'consumeFile')).toEqual(['ctx-qa', 'ctx-prod']);
      expect(names).toHaveLength(2);
      expect(screen.getByText('Content from Acme · Development is now in Acme · QA and Acme Production.')).toBeInTheDocument();

      click('Restore Acme · QA');
      click('Restore now');
      expect(await screen.findByRole('heading', { level: 1, name: 'Restore complete' })).toBeInTheDocument();
      expect(ctxs(calls, 'consumeFile')).toEqual(['ctx-qa', 'ctx-prod', 'ctx-qa']);
      // Production can still be restored from here; QA, just restored, can't again.
      expect(screen.queryByRole('button', { name: 'Restore Acme · QA' })).not.toBeInTheDocument();
      click('Restore Acme Production');
      expect(screen.getByRole('button', { name: 'Restore now' })).toBeDisabled();
    });

    it('a failure on a later target says which got the content', async () => {
      downloads();
      setup({ find: EVERYWHERE, overrides: { consumeFile: (p) => (p.query.sitecoreContextId === 'ctx-prod' ? { status: 500 } : {}) } });
      pickProd();
      await toReview();
      fireEvent.click(screen.getByRole('checkbox', { name: 'I understand this writes to Acme Production' }));
      click('Start transfer');
      expect(await screen.findByRole('heading', { level: 1, name: 'Transfer failed' })).toBeInTheDocument();
      expect(screen.getByText('Acme · QA got the content before the transfer stopped.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Restore Acme · QA' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Download Acme Production backup' })).toBeInTheDocument();
    });
  });

  describe('Publish', () => {
    const publishes = (calls: { key: string; params: any }[]) =>
      calls.filter((c) => c.key === 'xmc.authoring.graphql' && c.params.body.query.startsWith('mutation'));
    const box = () => screen.getByRole('checkbox', { name: 'Publish to Experience Edge when done' });

    it('is offered, unticked: publishing makes the content live', async () => {
      setup();
      await toReview();
      expect(box()).not.toBeChecked();
      expect(box()).toHaveAccessibleDescription(
        'Publishes the transferred items on Acme · QA once the import finishes, in every language Acme · QA has. Only changed items are sent.',
      );
    });

    it('ticked, publishes on the target as the last step', async () => {
      const { calls } = setup();
      await toReview();
      fireEvent.click(box());
      click('Start transfer');
      expect(await screen.findByText('Transfer complete')).toBeInTheDocument();
      const [publish] = publishes(calls);
      expect(publishes(calls)).toHaveLength(1);
      expect(publish.params.query.sitecoreContextId).toBe('ctx-qa');
      expect(publish.params.body.query).toContain(`rootItemPaths: ["${HOME}"]`);
      // The activity log (collapsed on Complete) ends the publish step before the run.
      expect(screen.getByText('Published to Experience Edge.')).toBeInTheDocument();
    });

    it('unticked, publishes nothing', async () => {
      const { calls } = setup();
      await toReview();
      click('Start transfer');
      expect(await screen.findByText('Transfer complete')).toBeInTheDocument();
      expect(publishes(calls)).toHaveLength(0);
    });

    it('a restore after a published transfer publishes what it puts back', async () => {
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:b'), revokeObjectURL: vi.fn() });
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      const { calls } = setup({ find: EVERYWHERE });
      await toReview();
      fireEvent.click(box());
      click('Start transfer');
      await screen.findByText('Transfer complete');
      click('Restore Acme · QA');
      click('Restore now');
      expect(await screen.findByRole('heading', { level: 1, name: 'Restore complete' })).toBeInTheDocument();
      expect(publishes(calls)).toHaveLength(2);
      expect(publishes(calls)[1].params.body.query).toContain(`rootItemPaths: ["${HOME}"]`);
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
