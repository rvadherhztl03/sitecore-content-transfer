import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SelectionQueue } from '@/components/transfer/SelectionQueue';
import { newTree } from '@/lib/queue';

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
    for (const name of ['Add', 'Import list', 'Clear all', 'Remove /a', 'Remove /b']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    expect(screen.getAllByRole('radio')).toHaveLength(6);
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    expect(screen.getByLabelText('If /a exists')).toBeDisabled();
    expect(screen.getByLabelText('If /b exists')).toBeDisabled();
  });
});
