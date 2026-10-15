import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PreflightNotes, PreflightStatus } from '@/components/transfer/Preflight';
import type { Preflight } from '@/components/transfer/usePreflight';
import type { ItemCheck } from '@/lib/preflight';
import type { Env } from '@/lib/sdk';

const DEV: Env = { id: 'd', name: 'Acme · Dev', contextId: 'cd' };
const QA: Env = { id: 'q', name: 'Acme · QA', contextId: 'cq' };
const ACME = '/sitecore/content/Acme';
const HOME = `${ACME}/Home`;
const NEWS = `${ACME}/News`;

const ok = (itemPath: string, patch: Partial<ItemCheck> = {}): ItemCheck => ({
  itemPath,
  onSource: true,
  onTarget: 'same',
  missingParents: [],
  otherParents: [],
  deleted: [],
  ...patch,
});
const done = (...checks: ItemCheck[]): Preflight => ({ status: 'done', checks: new Map(checks.map((c) => [c.itemPath, c])) });

function notes(preflight: Preflight | undefined, actions: { onAddParents?(): void; onRemoveNotFound?(): void } = {}) {
  return render(<PreflightNotes preflight={preflight} source={DEV} target={QA} {...actions} />);
}

describe('PreflightNotes', () => {
  it('says it is checking the target', () => {
    notes({ status: 'checking' });
    expect(screen.getByRole('status')).toHaveTextContent('Checking Acme · QA…');
  });

  it('shows nothing before a check exists', () => {
    const { container } = notes(undefined);
    expect(container).toBeEmptyDOMElement();
  });

  it('says a failed check does not stop the transfer', () => {
    notes({ status: 'failed', error: 'HTTP 500' });
    expect(screen.getByRole('note')).toHaveTextContent("Couldn't run the pre-flight check: HTTP 500. You can still start.");
  });

  it('says when everything is in place', () => {
    notes(done(ok(HOME), ok(NEWS, { onTarget: 'new' })));
    expect(screen.getByRole('status')).toHaveTextContent('Pre-flight check: everything is in place on Acme · QA.');
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('lists items missing on the source, with Remove from the list', () => {
    const onRemoveNotFound = vi.fn();
    notes(done(ok(HOME, { onSource: false }), ok(NEWS)), { onRemoveNotFound });
    const note = screen.getByRole('note', { name: 'Not found on Acme · Dev' });
    expect(note).toHaveTextContent("These paths don't exist on Acme · Dev, so nothing is copied for them.");
    expect(within(note).getByText(HOME)).toHaveClass('font-mono');
    expect(note).not.toHaveTextContent(NEWS);
    fireEvent.click(within(note).getByRole('button', { name: 'Remove from the list' }));
    expect(onRemoveNotFound).toHaveBeenCalledOnce();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('lists each missing parent once, with Add missing parents', () => {
    const onAddParents = vi.fn();
    notes(done(ok(HOME, { onTarget: 'new', missingParents: [ACME] }), ok(`${HOME}/About`, { onTarget: 'new', missingParents: [ACME, HOME] })), { onAddParents });
    const note = screen.getByRole('note', { name: 'Missing parents on Acme · QA' });
    expect(note).toHaveTextContent("Items whose parents aren't on Acme · QA transfer but don't appear in the content tree.");
    expect(within(note).getAllByRole('listitem').map((li) => li.textContent)).toEqual([ACME, HOME]);
    expect(note).toHaveTextContent("They're added as This item, keeping what's there.");
    fireEvent.click(within(note).getByRole('button', { name: 'Add missing parents' }));
    expect(onAddParents).toHaveBeenCalledOnce();
  });

  it('offers no buttons without the actions', () => {
    notes(done(ok(HOME, { onSource: false }), ok(NEWS, { missingParents: [ACME] })));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('explains a parent that is a different item on the target', () => {
    notes(done(ok(HOME, { otherParents: [ACME] })));
    const note = screen.getByRole('note', { name: 'Different parent items on Acme · QA' });
    expect(note).toHaveTextContent(`${ACME} is a different item on Acme · QA, so Home won't appear under it.`);
    expect(note).toHaveTextContent('Transfer from a parent both environments share instead.');
  });

  it('lists items where a different item already sits on the target', () => {
    notes(done(ok(HOME, { onTarget: 'other' })));
    const note = screen.getByRole('note', { name: 'A different item already exists on Acme · QA' });
    expect(note).toHaveTextContent('Copying adds a second item with the same name next to it.');
    expect(within(note).getByText(HOME)).toBeInTheDocument();
  });

  it('names what replacing everything below deletes, up to 8 per item', () => {
    const names = Array.from({ length: 10 }, (_, i) => `Page ${i + 1}`);
    notes(done(ok(HOME, { deleted: ['Old promo', 'Test page'] }), ok(NEWS, { deleted: names })));
    const note = screen.getByRole('note', { name: 'Deleted on Acme · QA' });
    expect(note).toHaveTextContent('These exist only on Acme · QA, so replacing everything below deletes them and everything under them.');
    expect(within(note).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Under Home: Old promo, Test page',
      'Under News: Page 1, Page 2, Page 3, Page 4, Page 5, Page 6, Page 7, Page 8 and 2 more',
    ]);
  });
});

describe('PreflightStatus', () => {
  const chip = (preflight: Preflight | undefined, itemPath = HOME) => {
    const { container } = render(<PreflightStatus preflight={preflight} itemPath={itemPath} source={DEV} />);
    return container.textContent;
  };

  it('shows what the target holds for the item, most serious first', () => {
    expect(chip({ status: 'checking' })).toBe('Checking…');
    expect(chip(undefined)).toBe('—');
    expect(chip({ status: 'failed', error: 'x' })).toBe('—');
    expect(chip(done(ok(NEWS)))).toBe('—');
    expect(chip(done(ok(HOME, { onSource: false, onTarget: 'other' })))).toBe('Not on Acme · Dev');
    expect(chip(done(ok(HOME, { onTarget: 'other', missingParents: [ACME] })))).toBe('Different item here');
    expect(chip(done(ok(HOME, { otherParents: [ACME], missingParents: [ACME] })))).toBe('Different parent');
    expect(chip(done(ok(HOME, { onTarget: 'new', missingParents: [ACME] })))).toBe('Parent missing');
    expect(chip(done(ok(HOME, { onTarget: 'new' })))).toBe('New');
    expect(chip(done(ok(HOME)))).toBe('Exists');
  });
});
