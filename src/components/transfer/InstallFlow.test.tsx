/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstallFlow } from '@/components/transfer/InstallFlow';
import type { Env } from '@/lib/sdk';
import { TIMING } from '@/lib/transfer';
import { fakeClient, type FakeReply } from '@/test/fakeClient';

const DEV: Env = { id: 'dev', name: 'Acme · Development', contextId: 'ctx-dev', tenantName: 'acme-dev' };
const QA: Env = { id: 'qa', name: 'Acme · QA', contextId: 'ctx-qa', tenantName: 'acme-qa' };
const PROD: Env = { id: 'prod', name: 'Acme Production', contextId: 'ctx-prod' };
const CT = 'xmc.contentTransfer.';
const NAME = 'p.zip';

type Handler = (params: any) => FakeReply | Promise<FakeReply>;

// Modelled on happyHandlers in src/lib/transfer.test.ts (only the calls an import makes).
function handlers(overrides: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    [CT + 'saveChunk']: () => ({}),
    [CT + 'completeChunkSetTransfer']: (p) => ({ data: { ContentTransferFileName: 'f-' + p.path.chunksetId + '.raif' } }),
    [CT + 'consumeFile']: () => ({}),
    [CT + 'getBlobState']: () => ({ data: { status: 'OK' } }),
    [CT + 'deleteContentTransfer']: () => ({}),
    ...Object.fromEntries(Object.entries(overrides).map(([k, h]) => [CT + k, h])),
  };
}

function setup({ envs = [DEV, QA, PROD], overrides = {} }: { envs?: Env[]; overrides?: Record<string, Handler> } = {}) {
  const { client, calls } = fakeClient(handlers(overrides));
  const onHome = vi.fn();
  const view = render(<InstallFlow client={client} envs={envs} onHome={onHome} />);
  return { client, calls, onHome, ...view };
}

const META = [
  { ItemPath: '/sitecore/content/A', ItemId: 'id-a', Scope: 'ItemAndDescendants', MergeStrategy: 'OverrideExistingTree' },
  { ItemPath: '/sitecore/media library/B', ItemId: 'id-b', Scope: 'SingleItem', MergeStrategy: 'LatestWin' },
];

// A legacy zip (no chunk map) uploads as one chunk; `chunked` adds a map with two (4 + 6 bytes of raif).
async function zipFile(name: string, chunked = false) {
  const zip = new JSZip().file('package.raif', 'raif-bytes').file('package-metadata.json', JSON.stringify(META));
  if (chunked) {
    zip.file(
      'package-chunks.json',
      JSON.stringify([
        { chunkSet: 0, index: 0, isMedia: false, offset: 0, length: 4 },
        { chunkSet: 0, index: 1, isMedia: true, offset: 4, length: 6 },
      ]),
    );
  }
  return new File([await zip.generateAsync({ type: 'uint8array' })], name);
}

async function load(name = NAME, chunked = false) {
  fireEvent.change(screen.getByLabelText('Package file'), { target: { files: [await zipFile(name, chunked)] } });
  await screen.findByText(name);
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const install = () => screen.getByRole('button', { name: 'Install package' });
const target = (env: Env) => within(screen.getByRole('group', { name: 'Install into' })).getByRole('radio', { name: new RegExp(env.name) });
const pick = (env: Env) => fireEvent.click(target(env));
const prodBox = () => screen.getByRole('checkbox', { name: 'I understand this writes to Acme Production' });
const ofKey = (calls: { key: string }[], k: string) => calls.filter((c) => c.key === CT + k) as any[];
// A promise handler that stays pending until `release()`; `ready()` waits until the engine reached it.
function hold() {
  let release!: () => void;
  return { handler: () => new Promise<FakeReply>((r) => (release = () => r({}))), release: () => release(), ready: () => waitFor(() => expect(release).toBeTypeOf('function')) };
}

describe('InstallFlow', () => {
  let pollMs: number;
  beforeEach(() => {
    pollMs = TIMING.pollMs;
    TIMING.pollMs = 0;
  });
  afterEach(() => {
    TIMING.pollMs = pollMs;
  });

  it('shows the screen with no target chosen, even with one environment', () => {
    setup({ envs: [QA] });
    expect(screen.getByRole('heading', { level: 1, name: 'Install a package' })).toBeInTheDocument();
    expect(within(screen.getByRole('banner')).getByText('Install a package')).toBeInTheDocument();
    expect(screen.getByText('Drop a .zip or .raif here, or browse')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Install into' })).queryByRole('radio', { checked: true })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'master' })).toBeChecked();
    expect(install()).toBeDisabled();
  });

  it('Install package needs a package and a target', async () => {
    setup();
    expect(screen.getByRole('contentinfo')).toHaveTextContent('No package');
    pick(QA);
    expect(install()).toBeDisabled();
    await load();
    expect(install()).toBeEnabled();
    expect(screen.getByRole('contentinfo')).toHaveTextContent(/2 items.*Acme · QA.*· master/);
    fireEvent.click(screen.getByRole('radio', { name: 'web' }));
    expect(screen.getByRole('contentinfo')).toHaveTextContent(/Acme · QA.*· web/);

    // An unusable file replaces the package, so there is nothing to install.
    fireEvent.change(screen.getByLabelText('Package file'), { target: { files: [new File(['x'], 'q.txt')] } });
    await screen.findByRole('alert');
    expect(install()).toBeDisabled();
  });

  it('the header Cancel and Back go home', () => {
    const { onHome } = setup();
    click('Cancel');
    click('Back');
    expect(onHome).toHaveBeenCalledTimes(2);
  });

  it('a production target needs the checkbox, and changing the target clears it', async () => {
    setup({ envs: [DEV, PROD] });
    await load();
    pick(DEV);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(install()).toBeEnabled();
    pick(PROD);
    expect(screen.getByText('Acme Production looks like a production environment.')).toBeInTheDocument();
    expect(install()).toBeDisabled();
    fireEvent.click(prodBox());
    expect(install()).toBeEnabled();
    pick(DEV);
    pick(PROD);
    expect(prodBox()).not.toBeChecked();
    expect(install()).toBeDisabled();
  });

  it('installs into the chosen target and database, then shows Package installed', async () => {
    const { calls } = setup();
    await load(NAME, true);
    pick(QA);
    fireEvent.click(screen.getByRole('radio', { name: 'web' }));
    click('Install package');

    // The screen steps aside for the run view.
    expect(screen.getByRole('heading', { level: 1, name: 'Installing package into Acme · QA' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: "What's inside" })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install package' })).not.toBeInTheDocument();
    const steps = within(screen.getByRole('list', { name: 'Steps' }));
    for (const label of ['Upload package', 'Assemble package on Acme · QA', 'Import into web', 'Verify']) {
      expect(steps.getByText(label)).toBeInTheDocument();
    }

    const heading = await screen.findByRole('heading', { level: 1, name: 'Package installed' });
    await waitFor(() => expect(heading).toHaveFocus());
    // Every call, and no other environment, went to the chosen target.
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c.params.query.sitecoreContextId).toBe('ctx-qa');
    const saves = ofKey(calls, 'saveChunk');
    expect(saves.map((c) => c.params.query.isMedia)).toEqual([false, true]);
    expect(ofKey(calls, 'consumeFile')[0].params.query).toMatchObject({ databaseName: 'web', sitecoreContextId: 'ctx-qa' });
    expect(ofKey(calls, 'deleteContentTransfer')).toHaveLength(1);
    expect(screen.getByText('Items').parentElement).toHaveTextContent('Items2');
    expect(screen.getByText('Chunks').parentElement).toHaveTextContent('Chunks2');
    expect(screen.getByText('Took')).toBeInTheDocument();
  });

  it('works with a single environment', async () => {
    const { calls } = setup({ envs: [QA] });
    await load();
    expect(install()).toBeDisabled();
    pick(QA);
    click('Install package');
    expect(await screen.findByText('Package installed')).toBeInTheDocument();
    expect(ofKey(calls, 'saveChunk').map((c) => c.params.query.sitecoreContextId)).toEqual(['ctx-qa']);
  });

  it('starts one run on two quick clicks', async () => {
    const { calls } = setup();
    await load();
    pick(QA);
    const start = install();
    // Both clicks land before React re-renders, so both reach the handler.
    act(() => {
      start.click();
      start.click();
    });
    expect(await screen.findByText('Package installed')).toBeInTheDocument();
    expect(ofKey(calls, 'saveChunk')).toHaveLength(1);
    expect(ofKey(calls, 'deleteContentTransfer')).toHaveLength(1);
  });

  it('leaves the header no way out while running, and home works again after', async () => {
    const saving = hold();
    const { calls, onHome } = setup({ overrides: { saveChunk: saving.handler } });
    await load();
    pick(QA);
    click('Install package');
    await saving.ready();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    const home = screen.getByRole('button', { name: 'Content Transfer' });
    expect(home).toBeDisabled();
    fireEvent.click(home);
    expect(onHome).not.toHaveBeenCalled();
    expect(ofKey(calls, 'deleteContentTransfer')).toHaveLength(0);

    saving.release();
    expect(await screen.findByText('Package installed')).toBeInTheDocument();
    // Still no header Cancel once the run is over; home is enabled.
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Content Transfer' }));
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it('offers Cancel only until the import starts', async () => {
    const importing = hold();
    setup({ overrides: { consumeFile: importing.handler } });
    await load();
    pick(QA);
    click('Install package');
    expect(screen.getByRole('button', { name: 'Cancel install' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel install' })).not.toBeInTheDocument());
    expect(screen.getByText("The import can't be cancelled once it starts.")).toBeInTheDocument();
    importing.release();
    expect(await screen.findByText('Package installed')).toBeInTheDocument();
  });

  it('Cancel stops the upload, cleans up and ends as a failed run', async () => {
    const saving = hold();
    const { calls } = setup({ overrides: { saveChunk: saving.handler } });
    await load();
    pick(QA);
    click('Install package');
    await saving.ready();
    click('Cancel install');
    saving.release();
    expect(await screen.findByRole('heading', { level: 1, name: 'Install failed' })).toBeInTheDocument();
    expect(screen.getByText('Cancelled.')).toBeInTheDocument();
    expect(ofKey(calls, 'completeChunkSetTransfer')).toHaveLength(0);
    expect(ofKey(calls, 'deleteContentTransfer').map((c) => c.params.query.sitecoreContextId)).toEqual(['ctx-qa']);
  });

  it('unmount aborts the run', async () => {
    const saving = hold();
    const { calls, unmount } = setup({ overrides: { saveChunk: saving.handler } });
    await load();
    pick(QA);
    click('Install package');
    await saving.ready();
    unmount();
    saving.release();
    await waitFor(() => expect(ofKey(calls, 'deleteContentTransfer')).toHaveLength(1));
    expect(ofKey(calls, 'completeChunkSetTransfer')).toHaveLength(0);
  });

  it('Install another package starts over with an empty screen', async () => {
    setup({ envs: [DEV, PROD] });
    await load();
    pick(PROD);
    fireEvent.click(prodBox());
    click('Install package');
    await screen.findByText('Package installed');

    click('Install another package');
    expect(screen.getByRole('heading', { level: 1, name: 'Install a package' })).toBeInTheDocument();
    expect(screen.queryByText(NAME)).not.toBeInTheDocument();
    expect(screen.getByText('Drop a .zip or .raif here, or browse')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Install into' })).queryByRole('radio', { checked: true })).not.toBeInTheDocument();
    expect(install()).toBeDisabled();

    await load();
    pick(PROD);
    expect(prodBox()).not.toBeChecked();
    expect(install()).toBeDisabled();
  });

  it('Try again after a failure keeps the package, target and database, but asks for the tick again', async () => {
    const { calls } = setup({ envs: [DEV, PROD], overrides: { saveChunk: () => ({ status: 500 }) } });
    await load();
    pick(PROD);
    fireEvent.click(prodBox());
    fireEvent.click(screen.getByRole('radio', { name: 'web' }));
    click('Install package');
    const heading = await screen.findByRole('heading', { level: 1, name: 'Install failed' });
    await waitFor(() => expect(heading).toHaveFocus());

    click('Try again');
    expect(screen.getByRole('heading', { level: 1, name: 'Install a package' })).toBeInTheDocument();
    expect(screen.getByText(NAME)).toBeInTheDocument();
    expect(screen.getByText('/sitecore/content/A')).toBeInTheDocument();
    expect(target(PROD)).toBeChecked();
    expect(screen.getByRole('radio', { name: 'web' })).toBeChecked();
    expect(prodBox()).not.toBeChecked();
    expect(install()).toBeDisabled();

    // The kept package installs again once confirmed.
    fireEvent.click(prodBox());
    click('Install package');
    await screen.findByRole('heading', { level: 1, name: 'Install failed' });
    expect(ofKey(calls, 'saveChunk')).toHaveLength(2);
    expect(ofKey(calls, 'saveChunk').map((c) => c.params.query.sitecoreContextId)).toEqual(['ctx-prod', 'ctx-prod']);
  });
});
