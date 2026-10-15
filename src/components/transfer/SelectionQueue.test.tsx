import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SelectionQueue } from '@/components/transfer/SelectionQueue';
import { newTree } from '@/lib/queue';

const TREES = [newTree('/a'), newTree('/b')];

function setup(trees = TREES) {
  const onChange = vi.fn();
  render(<SelectionQueue trees={trees} onChange={onChange} />);
  return onChange;
}

describe('SelectionQueue', () => {
  it('shows the empty message and a zero count', () => {
    setup([]);
    expect(screen.getByText('Pick items from the tree or paste a path.')).toBeInTheDocument();
    expect(screen.getByText('Selected (0)')).toBeInTheDocument();
  });

  it('removes a row', () => {
    const onChange = setup();
    expect(screen.getByText('Selected (2)')).toBeInTheDocument();
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
    const input = screen.getByLabelText('Add path');
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
    fireEvent.keyDown(screen.getByLabelText('Scope for /a'), { key: 'Enter' });
    fireEvent.click(screen.getByRole('option', { name: 'This item' }));
    expect(onChange).toHaveBeenLastCalledWith([{ ...TREES[0], scope: 'SingleItem' }, TREES[1]]);

    fireEvent.keyDown(screen.getByLabelText('Merge for /b'), { key: 'Enter' });
    fireEvent.click(screen.getByRole('option', { name: 'Keep the newer one' }));
    expect(onChange).toHaveBeenLastCalledWith([TREES[0], { ...TREES[1], mergeStrategy: 'LatestWin' }]);
  });

  it('imports a JSON queue file', async () => {
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
});
