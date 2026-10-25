import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PreflightNotes, PreflightStatus } from '@/components/transfer/Preflight';
import type { Preflight } from '@/components/transfer/usePreflight';
import type { ItemCheck } from '@/lib/preflight';
import type { Definition, RelatedItem } from '@/lib/related';
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
const PAGE = '/sitecore/templates/Project/Acme/Page';
const HERO = '/sitecore/layout/Renderings/Hero';
const def = (itemPath: string, kind: Definition['kind'], usedBy = [HOME], templateOf: string[] = []): Definition => ({ itemPath, name: itemPath.split('/').pop()!, kind, usedBy, templateOf });
const withDefinitions = (extra: { definitions?: Definition[]; definitionsError?: string }, ...checks: ItemCheck[]): Preflight => ({
  status: 'done',
  checks: new Map(checks.map((c) => [c.itemPath, c])),
  ...extra,
});

function notes(preflight: Preflight | undefined, actions: { onAddParents?(): void; onRemoveNotFound?(): void; onAddRelated?(): void } = {}) {
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

describe('PreflightNotes related content', () => {
  const rel = (itemPath: string, onTarget: RelatedItem['onTarget'], usedBy = [HOME]): RelatedItem => ({ itemPath, name: itemPath.split('/').pop()!, usedBy, onTarget });
  const withRelated = (extra: { related?: RelatedItem[]; relatedError?: string }): Preflight => ({ status: 'done', checks: new Map([[HOME, ok(HOME)]]), ...extra });
  const NOTE = 'Used by your items but not in the list';

  it('lists what the items use that the target lacks, who uses it, and adds the missing ones', () => {
    const onAddRelated = vi.fn();
    notes(
      withRelated({
        related: [
          rel('/sitecore/media library/Acme/Hero', 'new', [HOME, NEWS]),
          rel('/sitecore/content/Acme/Data/Promo', 'other'),
          rel('/sitecore/content/Acme/Data/Shared', 'same'),
        ],
      }),
      { onAddRelated },
    );
    const note = screen.getByRole('note', { name: NOTE });
    expect(note).toHaveTextContent('Missing on Acme · QA, so the items that use them may show gaps:');
    expect(within(note).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Hero /sitecore/media library/Acme/Hero · used by Home, News',
      'Promo /sitecore/content/Acme/Data/Promo · used by Home · a different item has this path on Acme · QA',
    ]);
    expect(note).toHaveTextContent('1 more is already on Acme · QA (not added; it may be older there).');
    fireEvent.click(within(note).getByRole('button', { name: 'Add 1 missing item' }));
    expect(onAddRelated).toHaveBeenCalledOnce();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('offers no Add when every missing item is a different item on the target', () => {
    notes(withRelated({ related: [rel('/sitecore/content/Acme/Data/Promo', 'other')] }), { onAddRelated: vi.fn() });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('with nothing missing, mentions the related items the target already has', () => {
    notes(withRelated({ related: [rel('/a', 'same'), rel('/b', 'same')] }));
    expect(screen.getByRole('status')).toHaveTextContent('Pre-flight check: everything is in place on Acme · QA.');
    expect(screen.getByText('2 related items are already on Acme · QA.')).toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('says when the scan could not run', () => {
    notes(withRelated({ relatedError: 'HTTP 500' }));
    expect(screen.getByRole('note', { name: "Couldn't scan for related content: HTTP 500. You can still start." })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('PreflightNotes templates and renderings', () => {
  const NOTE = 'Missing on Acme · QA: templates and renderings';

  it('lists what the target lacks, by kind, with who uses it, and offers no fix', () => {
    notes(withDefinitions({ definitions: [def(PAGE, 'Template', [HOME, NEWS], [HOME, NEWS]), def(HERO, 'Rendering')] }, ok(HOME), ok(NEWS)), {
      onAddParents: vi.fn(),
      onRemoveNotFound: vi.fn(),
      onAddRelated: vi.fn(),
    });
    const note = screen.getByRole('note', { name: NOTE });
    expect(note).toHaveTextContent(
      "Items that use them won't open or render properly on Acme · QA. They usually ship with a code deployment: deploy them to Acme · QA first.",
    );
    expect(within(note).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      `Template Page ${PAGE} · used by Home, News`,
      `Rendering Hero ${HERO} · used by Home`,
    ]);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('sits right after the items not found on the source', () => {
    notes(withDefinitions({ definitions: [def(PAGE, 'Template')] }, ok(HOME, { missingParents: [ACME] }), ok(NEWS, { onSource: false })));
    expect(screen.getAllByRole('note').map((n) => n.querySelector('strong')!.textContent)).toEqual([
      'Not found on Acme · Dev',
      NOTE,
      'Missing parents on Acme · QA',
    ]);
  });

  it('says when the check could not run', () => {
    notes(withDefinitions({ definitionsError: 'HTTP 500' }, ok(HOME)));
    expect(screen.getByRole('note', { name: "Couldn't check templates and renderings: HTTP 500. You can still start." })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
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

  it("says when the item's own template is missing, after only Not on the source", () => {
    const page = [def(PAGE, 'Template', [HOME], [HOME])];
    expect(chip(withDefinitions({ definitions: page }, ok(HOME, { onSource: false })))).toBe('Not on Acme · Dev');
    expect(chip(withDefinitions({ definitions: page }, ok(HOME, { onTarget: 'other', missingParents: [ACME] })))).toBe('Template missing');
    // A missing rendering, or a template only another item is built on, is the note's to explain.
    expect(chip(withDefinitions({ definitions: [def(HERO, 'Rendering'), def(PAGE, 'Template', [HOME, NEWS], [NEWS])] }, ok(HOME)))).toBe('Exists');
  });
});
