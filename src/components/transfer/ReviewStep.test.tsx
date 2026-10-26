import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProdConfirm, ReviewStep, needsProdConfirm } from '@/components/transfer/ReviewStep';
import type { Preflight } from '@/components/transfer/usePreflight';
import type { ItemCheck } from '@/lib/preflight';
import type { Env } from '@/lib/sdk';
import type { DataTree } from '@/lib/transfer';
import { fakeClient, fieldDiffReply } from '@/test/fakeClient';

const DEV: Env = { id: 'd', name: 'Acme · Development', contextId: 'cd', tenantName: 'acme-dev' };
const QA: Env = { id: 'q', name: 'Acme · QA', contextId: 'cq', tenantName: 'acme-qa' };
const PROD: Env = { id: 'p', name: 'Acme · Production', contextId: 'cp', tenantName: 'acme-prod' };

const HOME: DataTree = { itemPath: '/sitecore/content/Acme/Home', scope: 'ItemAndDescendants', mergeStrategy: 'OverrideExistingTree' };
const HERO: DataTree = { itemPath: '/sitecore/media library/Acme/Hero', scope: 'SingleItem', mergeStrategy: 'OverrideExistingItem' };

function setup(props: Partial<React.ComponentProps<typeof ReviewStep>> = {}) {
  const onProdChecked = vi.fn();
  const onEdit = vi.fn();
  render(
    <ReviewStep
      mode="transfer"
      source={DEV}
      targets={[QA]}
      database="master"
      trees={[HOME, HERO]}
      prodChecked={[]}
      onProdChecked={onProdChecked}
      onEdit={onEdit}
      {...props}
    />,
  );
  return { onProdChecked, onEdit };
}

describe('needsProdConfirm', () => {
  it('is true only for a production-looking target', () => {
    expect(needsProdConfirm(PROD)).toBe(true);
    expect(needsProdConfirm(QA)).toBe(false);
    expect(needsProdConfirm(undefined)).toBe(false);
  });
});

describe('ProdConfirm', () => {
  it('announces the callout and labels the checkbox', () => {
    const onChange = vi.fn();
    render(<ProdConfirm target={PROD} checked={false} onChange={onChange} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Acme · Production looks like a production environment.');
    const box = screen.getByRole('checkbox', { name: 'I understand this writes to Acme · Production' });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('shows the checked state', () => {
    render(<ProdConfirm target={PROD} checked onChange={() => {}} />);
    expect(screen.getByRole('checkbox')).toBeChecked();
  });
});

describe('ReviewStep', () => {
  it('shows the heading, both environment names and the database', () => {
    setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Ready to transfer' })).toBeInTheDocument();
    expect(screen.getByText('Nothing has been written yet. Check the route and items, then start.')).toBeInTheDocument();
    const route = screen.getByRole('region', { name: 'Route' });
    expect(within(route).getByText('From')).toBeInTheDocument();
    expect(within(route).getByText('Acme · Development')).toBeInTheDocument();
    expect(within(route).getByText('To')).toBeInTheDocument();
    expect(within(route).getByText('Acme · QA')).toBeInTheDocument();
    expect(within(route).getByText(/acme-dev · reads from master/)).toBeInTheDocument();
    expect(within(route).getByText(/acme-qa · writes to master/)).toBeInTheDocument();
  });

  it('reads from master on the From card and names the chosen database only on the To card', () => {
    setup({ database: 'web' });
    const route = screen.getByRole('region', { name: 'Route' });
    const card = (label: string) => within(route).getByText(label).closest('div')!;
    expect(card('From')).toHaveTextContent('acme-dev · reads from master');
    expect(card('From')).not.toHaveTextContent('web');
    expect(card('To')).toHaveTextContent('acme-qa · writes to web');
  });

  it('lists each path with its name, long labels and a column named for the target', () => {
    setup();
    expect(screen.getByRole('columnheader', { name: 'If it exists on Acme · QA' })).toBeInTheDocument();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Home')).toBeInTheDocument();
    expect(within(rows[0]).getByText('/sitecore/content/Acme/Home')).toHaveClass('font-mono');
    expect(within(rows[0]).getByText('Item + everything below')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Replace it and everything below')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Hero')).toBeInTheDocument();
    expect(within(rows[1]).getByText('This item only')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Replace this item only')).toBeInTheDocument();
  });

  it('scrolls the table sideways instead of overflowing', () => {
    setup();
    expect(screen.getByRole('table').parentElement).toHaveClass('overflow-x-auto');
  });

  it('warns for one tree replacement', () => {
    setup();
    expect(screen.getByText('1 item replaces everything below it on Acme · QA.')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(/^1 item replaces everything below it on Acme · QA\.$/);
  });

  it('warns for several tree replacements', () => {
    setup({ trees: [HOME, { ...HERO, mergeStrategy: 'OverrideExistingTree' }] });
    expect(screen.getByText('2 items replace everything below them on Acme · QA.')).toBeInTheDocument();
  });

  it('shows no tree warning without OverrideExistingTree', () => {
    setup({ trees: [HERO, { ...HOME, mergeStrategy: 'KeepExistingItem' }] });
    expect(screen.queryByText(/replaces? everything below/)).not.toBeInTheDocument();
  });

  it('shows the cancel note for the target', () => {
    setup();
    expect(
      screen.getByText(
        'Large trees can take a few minutes. You can cancel until the import into Acme · QA starts; after that the target finishes on its own.',
      ),
    ).toBeInTheDocument();
  });

  it('shows no production confirmation for a non-production target', () => {
    setup();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('asks to confirm a production target and reports the tick', () => {
    const { onProdChecked } = setup({ targets: [PROD] });
    expect(screen.getByText('Acme · Production looks like a production environment.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'I understand this writes to Acme · Production' }));
    expect(onProdChecked).toHaveBeenCalledWith(PROD, true);
  });

  it('shows From only, with no warnings, confirmation or note, in export mode', () => {
    setup({ mode: 'export', targets: [PROD] });
    expect(screen.getByRole('heading', { level: 1, name: 'Ready to export' })).toBeInTheDocument();
    expect(screen.getByText('Check the items, then create the package.')).toBeInTheDocument();
    const route = screen.getByRole('region', { name: 'Route' });
    expect(within(route).getByText('Acme · Development')).toBeInTheDocument();
    expect(within(route).queryByText('To')).not.toBeInTheDocument();
    expect(screen.queryByText(/replaces? everything below/)).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByText(/Large trees can take/)).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'If it exists' })).toBeInTheDocument();
  });

  it('calls onEdit from the Edit button', () => {
    const { onEdit } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('keeps long names and paths reachable with a title', () => {
    const path = `/sitecore/content/${'Very-Long-Segment/'.repeat(8)}Leaf`;
    setup({ trees: [{ ...HOME, itemPath: path }] });
    expect(screen.getByText(path)).toHaveAttribute('title', path);
  });
});

describe('ReviewStep field changes', () => {
  const KEEP: DataTree = { itemPath: '/sitecore/content/Acme/Keep', scope: 'SingleItem', mergeStrategy: 'KeepExistingItem' };
  const NEW: DataTree = { itemPath: '/sitecore/content/Acme/New', scope: 'SingleItem', mergeStrategy: 'OverrideExistingItem' };
  const check = (itemPath: string, onTarget: ItemCheck['onTarget']): [string, ItemCheck] => [
    itemPath,
    { itemPath, onSource: true, onTarget, missingParents: [], otherParents: [], deleted: [] },
  ];
  const preflight: Preflight = {
    status: 'done',
    checks: new Map([check(HOME.itemPath, 'same'), check(HERO.itemPath, 'same'), check(KEEP.itemPath, 'same'), check(NEW.itemPath, 'new')]),
  };
  const { client } = fakeClient({
    'xmc.authoring.graphql': fieldDiffReply({ cd: { [HERO.itemPath]: { Alt: 'Hero' } }, cq: { [HERO.itemPath]: { Alt: 'Old hero' } } }),
  });
  const toggles = () => screen.queryAllByRole('button', { name: /^Show changes to / }).map((b) => b.getAttribute('aria-label'));

  it('offers Show changes only on the same item being overwritten, and only with a client', () => {
    const { unmount } = render(
      <ReviewStep mode="transfer" source={DEV} targets={[QA]} database="master" trees={[HOME, HERO, KEEP, NEW]} prodChecked={[]} onProdChecked={() => {}} onEdit={() => {}} preflights={{ [QA.id]: preflight }} />,
    );
    expect(toggles()).toEqual([]);
    unmount();
    setup({ trees: [HOME, HERO, KEEP, NEW], preflights: { [QA.id]: preflight }, client });
    expect(toggles()).toEqual([`Show changes to ${HOME.itemPath}`, `Show changes to ${HERO.itemPath}`]);
  });

  it('opens the diff in a full-width row right after the item', async () => {
    setup({ trees: [HOME, HERO, KEEP, NEW], preflights: { [QA.id]: preflight }, client });
    const show = screen.getByRole('button', { name: `Show changes to ${HERO.itemPath}` });
    fireEvent.click(show);
    expect(show).toHaveAttribute('aria-expanded', 'true');
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(6);
    const cell = within(rows[3]).getByRole('cell');
    expect(cell).toHaveAttribute('colspan', '4');
    expect(within(cell).getByRole('group', { name: `Changes to ${HERO.itemPath} on ${QA.name}` })).toBeInTheDocument();
    expect(await within(cell).findByRole('button', { name: 'Show values of Alt' })).toBeInTheDocument();
    fireEvent.click(show);
    expect(screen.getAllByRole('row')).toHaveLength(5);
  });
});

describe('ReviewStep with several targets', () => {
  const UAT: Env = { id: 'uat', name: 'Acme · UAT', contextId: 'cu', tenantName: 'acme-uat' };
  const PROD2: Env = { id: 'prod', name: 'Acme · Production', contextId: 'cp', tenantName: 'acme-prod' };
  const same = (itemPath: string): Preflight => ({
    status: 'done',
    checks: new Map([[itemPath, { itemPath, onSource: true, onTarget: 'same', missingParents: [], otherParents: [], deleted: [] }]]),
  });

  it('shows every target on the route, a column each, and their checks', () => {
    setup({ targets: [QA, UAT], preflights: { [QA.id]: { status: 'checking' }, [UAT.id]: { status: 'failed', error: 'Boom' } } });
    const route = screen.getByRole('region', { name: 'Route' });
    expect(within(route).getByText('Acme · QA')).toBeInTheDocument();
    expect(within(route).getByText('Acme · UAT')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'On Acme · QA' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'On Acme · UAT' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'If it exists' })).toBeInTheDocument();
    expect(screen.getByText('Checking Acme · QA…')).toBeInTheDocument();
    expect(screen.getByText("Couldn't run the pre-flight check on Acme · UAT: Boom. You can still start.")).toBeInTheDocument();
    expect(screen.getByText('1 item replaces everything below it on Acme · QA and Acme · UAT.')).toBeInTheDocument();
  });

  it('gives the targets their order, and says what only concerns the source once', () => {
    const missing: Preflight = {
      status: 'done',
      checks: new Map([[HERO.itemPath, { itemPath: HERO.itemPath, onSource: false, onTarget: 'new', missingParents: [], otherParents: [], deleted: [] }]]),
    };
    setup({ targets: [QA, UAT], trees: [HERO], preflights: { [QA.id]: missing, [UAT.id]: missing } });
    const route = screen.getByRole('region', { name: 'Route' });
    expect(within(route).getByText('Then to')).toBeInTheDocument();
    expect(screen.getAllByRole('note', { name: 'Not found on Acme · Development' })).toHaveLength(1);
  });

  it('asks to confirm each production target', () => {
    const { onProdChecked } = setup({ targets: [QA, PROD2], prodChecked: [] });
    expect(screen.getAllByRole('checkbox', { name: /^I understand this writes to/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('checkbox', { name: 'I understand this writes to Acme · Production' }));
    expect(onProdChecked).toHaveBeenCalledWith(PROD2, true);
  });

  it('offers Show changes per target, named for it', () => {
    const { client } = fakeClient({});
    setup({ targets: [QA, UAT], trees: [HERO], preflights: { [QA.id]: same(HERO.itemPath), [UAT.id]: { status: 'checking' } }, client });
    expect(screen.getAllByRole('button', { name: /^Show changes/ }).map((b) => b.getAttribute('aria-label'))).toEqual([
      `Show changes to ${HERO.itemPath} on Acme · QA`,
    ]);
  });
});
