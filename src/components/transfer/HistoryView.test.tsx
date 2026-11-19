/* eslint-disable @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HistoryView } from '@/components/transfer/HistoryView';
import { addEntry, type HistoryEntry } from '@/lib/history';
import type { Env } from '@/lib/sdk';
import { fakeClient, type FakeReply } from '@/test/fakeClient';
import { historyReply, historyStore, type HistoryStore } from '@/test/fakeHistory';

const DEV: Env = { id: 'dev', name: 'Acme · Development', contextId: 'ctx-dev', tenantName: 'acme-dev' };
const QA: Env = { id: 'qa', name: 'Acme · QA', contextId: 'ctx-qa', tenantName: 'acme-qa' };
const GQL = 'xmc.authoring.graphql';
const HOME = '/sitecore/content/Home';

const OLDER: HistoryEntry = {
  id: 'older0000',
  kind: 'install',
  at: '2026-11-18T09:05:00.000Z',
  target: QA.name,
  items: [{ itemPath: '/sitecore/media library/Logo', scope: 'SingleItem', mergeStrategy: 'KeepExistingItem' }],
  result: 'fail',
};
const NEWER: HistoryEntry = {
  id: 'newer0000',
  kind: 'transfer',
  at: '2026-11-19T14:32:00.000Z',
  by: 'Jane Doe',
  source: DEV.name,
  target: QA.name,
  items: [
    { itemPath: HOME, scope: 'ItemAndDescendants', mergeStrategy: 'OverrideExistingTree' },
    { itemPath: `${HOME}/News`, scope: 'ItemAndChildren', mergeStrategy: 'OverrideExistingItem' },
  ],
  result: 'success',
  itemCount: 12,
};

async function seeded() {
  const store = historyStore('ctx-dev', 'ctx-qa');
  const { client } = fakeClient({ [GQL]: historyReply(store) });
  await addEntry(client, QA, OLDER);
  await addEntry(client, QA, NEWER);
  return store;
}

function setup(gql: (p: any) => FakeReply | Promise<FakeReply>) {
  const { client, calls } = fakeClient({ [GQL]: gql });
  const onHome = vi.fn();
  render(<HistoryView client={client} envs={[QA, DEV]} onHome={onHome} />);
  return { calls, onHome };
}

const runs = () => screen.findByRole('list', { name: `Runs into ${QA.name}` });

describe('HistoryView', () => {
  it('lists the first environment’s runs newest first: when, who, from → to, how many and the result', async () => {
    setup(historyReply(await seeded()));
    expect(screen.getByRole('radio', { name: /Acme · QA/ })).toBeChecked();
    const rows = within(await runs()).getAllByRole('group');
    expect(rows).toHaveLength(2);
    const [first, second] = rows.map((r) => r.querySelector('summary')!.textContent);
    expect(first).toMatch(/^Acme · Development\s*to\s*Acme · QA/);
    expect(first).toContain(`${new Date(NEWER.at).toLocaleString()} · by Jane Doe · 12 items`);
    expect(first).toContain('Transfer complete');
    // An install has no source and no one it knows ran it.
    expect(second).toMatch(/^Package\s*to\s*Acme · QA/);
    expect(second).toContain(`${new Date(OLDER.at).toLocaleString()} · 1 item`);
    expect(second).not.toContain('by');
    expect(second).toContain('Install failed');
  });

  it('opens a run to its item paths, each with what it includes and what happens if it exists', async () => {
    setup(historyReply(await seeded()));
    const row = within(await runs()).getAllByRole('group')[0];
    expect(row).not.toHaveAttribute('open');
    fireEvent.click(row.querySelector('summary')!);
    expect(row).toHaveAttribute('open');
    expect(within(row).getByText(HOME)).toBeInTheDocument();
    expect(within(row).getByText('Item + everything below · Replace it and everything below')).toBeInTheDocument();
    expect(within(row).getByText('Item + its children · Replace it and its children')).toBeInTheDocument();
  });

  it('switches to another environment, which has nothing recorded yet', async () => {
    const { calls } = setup(historyReply(await seeded()));
    await runs();
    fireEvent.click(screen.getByRole('radio', { name: /Acme · Development/ }));
    expect(await screen.findByText('No runs recorded in Acme · Development yet.')).toBeInTheDocument();
    expect(calls.at(-1)!.params.query.sitecoreContextId).toBe('ctx-dev');
  });

  it('Refresh loads the list again, picking up a run saved after it loaded', async () => {
    const store = historyStore('ctx-dev', 'ctx-qa');
    const { client } = fakeClient({ [GQL]: historyReply(store) });
    setup(historyReply(store));
    expect(await screen.findByText(`No runs recorded in ${QA.name} yet.`)).toBeInTheDocument();
    await addEntry(client, QA, NEWER);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(within(await runs()).getAllByRole('group')).toHaveLength(1);
    expect(screen.getByText('1 run')).toBeInTheDocument();
  });

  it('shows a load error with Retry, which loads again', async () => {
    const store: HistoryStore = await seeded();
    let fail = true;
    setup((p) => (fail ? { data: { errors: [{ message: 'Access denied' }] } } : historyReply(store)(p)));
    expect(await screen.findByText(`Couldn't load the history of ${QA.name}`)).toBeInTheDocument();
    expect(screen.getByText('Access denied')).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(within(screen.getByRole('list', { name: `Runs into ${QA.name}` })).getAllByRole('group')).toHaveLength(2));
  });

  it('shows skeletons while loading, and Back goes home', async () => {
    const { onHome } = setup(() => new Promise(() => {}));
    expect(screen.getByRole('status', { name: 'Loading history' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onHome).toHaveBeenCalled();
  });
});
