/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CompareView } from '@/components/transfer/CompareView';
import type { Env } from '@/lib/sdk';
import { compareReply, fakeClient, fieldDiffReply, isFieldDiff, type CompareFake, type FakeReply } from '@/test/fakeClient';

const DEV: Env = { id: 'd', name: 'Acme · Dev', contextId: 'ctx-dev' };
const QA: Env = { id: 'q', name: 'Acme · QA', contextId: 'ctx-qa' };
const GQL = 'xmc.authoring.graphql';
const R = '/sitecore/content/Acme';

const SOURCE: Record<string, CompareFake> = {
  [R]: { id: 'root', rev: 'r1' },
  [`${R}/Data`]: { id: 'data', rev: 'r2', updated: '20261015T000000Z' },
  [`${R}/Home`]: { id: 'home', rev: 'r1' },
  [`${R}/Home/News`]: { id: 'news', rev: 'r1' },
  [`${R}/Home/News/Launch`]: { id: 'launch', rev: 'r1' },
  [`${R}/Footer`]: { id: 'footer', rev: 'r1' },
};
const TARGET: Record<string, CompareFake> = {
  [R]: { id: 'root', rev: 'r1' },
  [`${R}/Data`]: { id: 'data', rev: 'r1', updated: '20261001T000000Z' },
  [`${R}/Home`]: { id: 'home', rev: 'r1' },
  [`${R}/Footer`]: { id: 'other-footer', rev: 'r1' },
  [`${R}/Old`]: { id: 'old', rev: 'r1' },
};

function setup({ source = SOURCE, target = TARGET, gql, limit, initialPath = R }: { source?: Record<string, CompareFake>; target?: Record<string, CompareFake>; gql?: (p: any) => FakeReply | Promise<FakeReply>; limit?: number; initialPath?: string } = {}) {
  const { client, calls } = fakeClient({ [GQL]: gql ?? compareReply({ 'ctx-dev': source, 'ctx-qa': target }) });
  const onAdd = vi.fn();
  render(<CompareView client={client} source={DEV} target={QA} initialPath={initialPath} onAdd={onAdd} limit={limit} />);
  return { onAdd, calls };
}
const compare = () => fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
const rows = () => within(screen.getByRole('list', { name: 'Differences' })).getAllByRole('listitem').map((li) => li.textContent);
const chip = (name: RegExp) => within(screen.getByRole('group', { name: 'Show' })).getByRole('button', { name });

describe('CompareView', () => {
  it('starts from the given path and explains what it does', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Compare Acme · Dev with Acme · QA' })).toBeInTheDocument();
    expect(screen.getByLabelText('Compare from')).toHaveValue(R);
    expect(screen.getByText("Compare a section to see what's new, changed or only on Acme · QA.")).toBeInTheDocument();
  });

  it('lists the differences in tree order with their status, and hides Same until asked', async () => {
    setup();
    compare();
    await screen.findByRole('list', { name: 'Differences' });
    expect(rows()).toEqual([
      `Data${R}/DataShow changesChanged · newer on Acme · Dev`,
      `Footer${R}/FooterDifferent item`,
      `News${R}/Home/NewsNew on Acme · Dev`,
      `Launch${R}/Home/News/LaunchNew on Acme · Dev`,
      `Old${R}/OldOnly on Acme · QA`,
    ]);
    expect(chip(/^New on Acme · Dev 2$/)).toHaveAttribute('aria-pressed', 'true');
    expect(chip(/^Changed 1$/)).toHaveAttribute('aria-pressed', 'true');
    expect(chip(/^Different item 1$/)).toHaveAttribute('aria-pressed', 'true');
    expect(chip(/^Only on Acme · QA 1$/)).toHaveAttribute('aria-pressed', 'true');
    expect(chip(/^Same 2$/)).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(chip(/^Same 2$/));
    expect(rows()).toContain(`Home${R}/HomeSame`);
    fireEvent.click(chip(/^Only on Acme · QA 1$/));
    expect(rows()).not.toContain(`Old${R}/OldOnly on Acme · QA`);
  });

  it('offers a checkbox only for new and changed items', async () => {
    setup();
    compare();
    await screen.findByRole('list', { name: 'Differences' });
    expect(screen.getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'))).toEqual([`Pick ${R}/Data`, `Pick ${R}/Home/News`, `Pick ${R}/Home/News/Launch`]);
  });

  it('Select all new and changed, then Add puts the rows in the list', async () => {
    const { onAdd } = setup();
    compare();
    await screen.findByRole('list', { name: 'Differences' });
    expect(screen.getByRole('button', { name: 'Add 0 to the list' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Select all new and changed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add 3 to the list' }));
    expect(onAdd).toHaveBeenCalledWith([
      { itemPath: `${R}/Data`, scope: 'SingleItem', mergeStrategy: 'OverrideExistingItem' },
      { itemPath: `${R}/Home/News`, scope: 'ItemAndDescendants', mergeStrategy: 'KeepExistingItem' },
    ]);
    expect(screen.getByText('Added 2 to the list.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add 0 to the list' })).toBeDisabled();
  });

  it('a single pick adds just that item', async () => {
    const { onAdd } = setup();
    compare();
    fireEvent.click(await screen.findByRole('checkbox', { name: `Pick ${R}/Home/News/Launch` }));
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 to the list' }));
    expect(onAdd).toHaveBeenCalledWith([{ itemPath: `${R}/Home/News/Launch`, scope: 'SingleItem', mergeStrategy: 'KeepExistingItem' }]);
  });

  it('shows progress, and Stop ends the comparison', async () => {
    let release!: () => void;
    const reply = compareReply({ 'ctx-dev': SOURCE, 'ctx-qa': TARGET });
    setup({ gql: (p) => (p.body.query.startsWith('query CompareLevel') ? new Promise<FakeReply>((r) => (release = () => r(reply(p)))) : reply(p)) });
    compare();
    expect(await screen.findByText('Compared 1 item…')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await act(async () => release());
    expect(await screen.findByText('Comparison stopped.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Compare' })).toBeEnabled();
  });

  it('Show changes on a changed item opens its field diff, and picking still works', async () => {
    const tree = compareReply({ 'ctx-dev': SOURCE, 'ctx-qa': TARGET });
    const fields = fieldDiffReply({ 'ctx-dev': { [`${R}/Data`]: { Title: 'New' } }, 'ctx-qa': { [`${R}/Data`]: { Title: 'Old' } } });
    setup({ gql: (p) => (isFieldDiff(p) ? fields(p) : tree(p)) });
    compare();
    const show = await screen.findByRole('button', { name: `Show changes to ${R}/Data` });
    // Only the changed item has one.
    expect(screen.getAllByRole('button', { name: /^Show changes/ })).toEqual([show]);
    expect(show).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(show);
    expect(show).toHaveAccessibleName(`Hide changes to ${R}/Data`);
    expect(show).toHaveAttribute('aria-expanded', 'true');
    const diff = screen.getByRole('group', { name: `Changes to ${R}/Data on ${QA.name}` });
    expect(await within(diff).findByRole('button', { name: 'Show values of Title' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: `Pick ${R}/Data` }));
    expect(screen.getByRole('button', { name: 'Add 1 to the list' })).toBeEnabled();
    fireEvent.click(show);
    expect(screen.queryByRole('group', { name: `Changes to ${R}/Data on ${QA.name}` })).not.toBeInTheDocument();
  });

  it('says when nothing differs', async () => {
    setup({ target: SOURCE });
    compare();
    expect(await screen.findByText(`No differences under ${R}.`)).toBeInTheDocument();
  });

  it('says when it stopped at the limit', async () => {
    setup({ limit: 3 });
    compare();
    expect(await screen.findByText('Showing the first 3 items. Compare a smaller section to see the rest.')).toBeInTheDocument();
  });

  it('says why a comparison failed', async () => {
    setup({ initialPath: '/sitecore/content/Nope' });
    compare();
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't compare: /sitecore/content/Nope isn't on Acme · Dev or Acme · QA.");
  });

  it('starts again from a new path on Enter', async () => {
    const { calls } = setup();
    fireEvent.change(screen.getByLabelText('Compare from'), { target: { value: `${R}/Home` } });
    fireEvent.keyDown(screen.getByLabelText('Compare from'), { key: 'Enter' });
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect((calls[0] as any).params.body.query).toContain(`"${R}/Home"`);
  });
});
