import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SelectionQueue } from '@/components/transfer/SelectionQueue';
import { newTree } from '@/lib/queue';
import type { DataTree } from '@/lib/transfer';

const TREES = [newTree('/a'), newTree('/b')];

function setup(trees = TREES, disabled?: boolean) {
  const onChange = vi.fn();
  render(<SelectionQueue trees={trees} onChange={onChange} disabled={disabled} />);
  return onChange;
}

describe('SelectionQueue', () => {
  it('shows the empty message and a zero count', () => {
    setup([]);
    expect(screen.getByText('Pick items from the tree or paste a path.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Selected 0' })).toBeInTheDocument();
  });

  it('shows the count next to the heading', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Selected 2' })).toBeInTheDocument();
  });

  it('shows each item as a card with its name, mono path and defaults', () => {
    setup([newTree('/sitecore/content/Acme/Home')]);
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('/sitecore/content/Acme/Home')).toHaveClass('font-mono');
    const scope = screen.getByRole('radiogroup', { name: 'Include for /sitecore/content/Acme/Home' });
    expect(within(scope).getByRole('radio', { name: '+ Everything below' })).toBeChecked();
    expect(screen.getByText('If it exists')).toBeInTheDocument();
    expect(screen.getByLabelText('If /sitecore/content/Acme/Home exists')).toHaveTextContent('Replace it and everything below');
  });

  it('removes a row', () => {
    const onChange = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Remove /a' }));
    expect(onChange).toHaveBeenCalledWith([TREES[1]]);
  });

  it('clears all rows', () => {
    const onChange = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('adds a typed path on Enter and ignores one already queued', () => {
    const onChange = setup();
    const input = screen.getByLabelText('Add by path');
    expect(input).toHaveAttribute('placeholder', '/sitecore/content/…');
    fireEvent.change(input, { target: { value: '/c' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith([...TREES, newTree('/c')]);
    expect(input).toHaveValue('');

    onChange.mockClear();
    fireEvent.change(input, { target: { value: '/a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('changes scope and merge on one row', () => {
    const onChange = setup();
    const scope = screen.getByRole('radiogroup', { name: 'Include for /a' });
    fireEvent.click(within(scope).getByRole('radio', { name: 'This item' }));
    expect(onChange).toHaveBeenLastCalledWith([{ ...TREES[0], scope: 'SingleItem', mergeStrategy: 'OverrideExistingItem' }, TREES[1]]);

    fireEvent.keyDown(screen.getByLabelText('If /b exists'), { key: 'Enter' });
    fireEvent.click(screen.getByRole('option', { name: "Keep what's there" }));
    expect(onChange).toHaveBeenLastCalledWith([TREES[0], { ...TREES[1], mergeStrategy: 'KeepExistingItem' }]);
  });

  it('+ Children moves a row off "Replace it and everything below" and no longer offers it', () => {
    const onChange = setup();
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Include for /a' })).getByRole('radio', { name: '+ Children' }));
    expect(onChange).toHaveBeenLastCalledWith([{ ...TREES[0], scope: 'ItemAndChildren', mergeStrategy: 'OverrideExistingItem' }, TREES[1]]);
  });

  it('a + Children row offers every merge option except replacing everything below', () => {
    setup([{ itemPath: '/a', scope: 'ItemAndChildren', mergeStrategy: 'OverrideExistingItem' }]);
    expect(within(screen.getByRole('radiogroup', { name: 'Include for /a' })).getByRole('radio', { name: '+ Children' })).toBeChecked();
    fireEvent.keyDown(screen.getByLabelText('If /a exists'), { key: 'Enter' });
    expect(screen.getByLabelText('If /a exists')).toHaveTextContent('Replace it and its children');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Replace it and its children', "Keep what's there"]);
  });

  it('a single item offers every merge option except replacing everything below', () => {
    setup([{ itemPath: '/a', scope: 'SingleItem', mergeStrategy: 'OverrideExistingItem' }]);
    fireEvent.keyDown(screen.getByLabelText('If /a exists'), { key: 'Enter' });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Replace this item only', "Keep what's there"]);
  });

  it('imports a JSON list file', async () => {
    const onChange = setup();
    const file = new File(['[{ "path": "/d" }]'], 'queue.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('Import JSON file'), { target: { files: [file] } });
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith([...TREES, newTree('/d')]));
  });

  it('saves the list as content-transfer-list-<date>.json, in a shape Import list reads back', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 19, 9, 30) });
    const createObjectURL = vi.fn(() => 'blob:list');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const saved: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download);
    });
    const trees: DataTree[] = [
      newTree('/a'),
      { itemPath: '/b', scope: 'ItemAndChildren', mergeStrategy: 'KeepExistingItem' },
      { itemPath: '/c', scope: 'SingleItem', mergeStrategy: 'OverrideExistingItem' },
    ];
    const onChange = setup(trees);
    fireEvent.click(screen.getByRole('button', { name: 'Save list' }));
    expect(saved).toEqual(['content-transfer-list-2026-11-19.json']);
    const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0];
    expect(blob.type).toBe('application/json');

    // Loading the saved file into an empty list gives the same rows.
    vi.useRealTimers();
    cleanup();
    const reload = setup([]);
    const file = new File([await blob.text()], saved[0], { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('Import JSON file'), { target: { files: [file] } });
    await vi.waitFor(() => expect(reload).toHaveBeenCalledWith(trees));
    expect(onChange).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('Save list is off while the list is empty', () => {
    setup([]);
    expect(screen.getByRole('button', { name: 'Save list' })).toBeDisabled();
  });

  it('loads a Sitecore CLI module file and says what it skipped or approximated', async () => {
    const onChange = setup([]);
    const module = {
      namespace: 'Project',
      items: {
        includes: [
          { name: 'templates', path: '/sitecore/templates/Project', allowedPushOperations: 'CreateAndUpdate' },
          { name: 'content', path: '/sitecore/content/Acme', rules: [{ path: 'Data', scope: 'Ignored' }] },
          { name: 'media', path: '/sitecore/media library/Acme', scope: 'DescendantsOnly' },
          { name: 'old', path: '/sitecore/content/Old', scope: 'Ignored' },
          { name: 'core', path: '/sitecore/system/Acme', database: 'core' },
        ],
      },
    };
    const file = new File([JSON.stringify(module)], 'Project.module.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('Import JSON file'), { target: { files: [file] } });
    await vi.waitFor(() =>
      expect(onChange).toHaveBeenCalledWith([
        { itemPath: '/sitecore/templates/Project', scope: 'ItemAndDescendants', mergeStrategy: 'OverrideExistingItem' },
        newTree('/sitecore/content/Acme'),
        newTree('/sitecore/media library/Acme'),
      ]),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Loaded 3 items from Project.module.json. Skipped 2 (ignored, not in master or not valid). 1 had rules, so its whole tree was added. 1 was descendants only, so it was added as + Everything below, which also brings the item itself.',
    );
  });

  it('shows why a module file with nothing to load was refused, and no status', async () => {
    const onChange = setup();
    const file = new File(['{"items":{"includes":[{"name":"a","path":"/a","scope":"Ignored"}]}}'], 'Project.module.json');
    fireEvent.change(screen.getByLabelText('Import JSON file'), { target: { files: [file] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('No items to load from Project.module.json. Skipped 1 (ignored, not in master or not valid).');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a plain list file shows no status, and the next load or Clear all removes an old one', async () => {
    setup();
    const load = (text: string, name: string) =>
      fireEvent.change(screen.getByLabelText('Import JSON file'), { target: { files: [new File([text], name)] } });
    load('{"items":{"includes":[{"name":"a","path":"/m"}]}}', 'Project.module.json');
    expect(await screen.findByRole('status')).toHaveTextContent('Loaded 1 item from Project.module.json.');
    load('[{ "path": "/d" }]', 'queue.json');
    await vi.waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    load('{"items":{"includes":[{"name":"a","path":"/m"}]}}', 'Project.module.json');
    await screen.findByRole('status');
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the error for an invalid JSON file', async () => {
    const onChange = setup();
    const file = new File(['not json'], 'queue.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('Import JSON file'), { target: { files: [file] } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/JSON/);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disables every control when disabled, including each row of the scope control', () => {
    setup(TREES, true);
    expect(screen.getByLabelText('Add by path')).toBeDisabled();
    for (const name of ['Add', 'Import list', 'Save list', 'Clear all', 'Remove /a', 'Remove /b']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    expect(screen.getAllByRole('radio')).toHaveLength(6);
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    expect(screen.getByLabelText('If /a exists')).toBeDisabled();
    expect(screen.getByLabelText('If /b exists')).toBeDisabled();
  });
});
