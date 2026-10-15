import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProdConfirm, ReviewStep, needsProdConfirm } from '@/components/transfer/ReviewStep';
import type { Env } from '@/lib/sdk';
import type { DataTree } from '@/lib/transfer';

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
      target={QA}
      database="master"
      trees={[HOME, HERO]}
      prodChecked={false}
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
    expect(within(route).getByText(/acme-dev · master/)).toBeInTheDocument();
    expect(within(route).getByText(/acme-qa · writes to master/)).toBeInTheDocument();
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
    const { onProdChecked } = setup({ target: PROD });
    expect(screen.getByText('Acme · Production looks like a production environment.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'I understand this writes to Acme · Production' }));
    expect(onProdChecked).toHaveBeenCalledWith(true);
  });

  it('shows From only, with no warnings, confirmation or note, in export mode', () => {
    setup({ mode: 'export', target: PROD });
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
