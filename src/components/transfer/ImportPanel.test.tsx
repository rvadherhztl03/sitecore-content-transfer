import { fireEvent, render, screen } from '@testing-library/react';
import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { ImportPanel } from '@/components/transfer/ImportPanel';

const meta = [{ ItemPath: '/sitecore/content/A', ItemId: 'id-a', Scope: 'SingleItem', MergeStrategy: 'LatestWin' }];

async function zipFile(name: string, withMeta = true) {
  const zip = new JSZip().file('package.raif', 'raif-bytes');
  if (withMeta) zip.file('package-metadata.json', JSON.stringify(meta));
  return new File([await zip.generateAsync({ type: 'uint8array' })], name);
}

function setup(disabled?: boolean) {
  const onPackage = vi.fn();
  render(<ImportPanel onPackage={onPackage} disabled={disabled} />);
  return { onPackage, input: screen.getByLabelText('Package file') as HTMLInputElement };
}

describe('ImportPanel', () => {
  it('lists the items of a chosen zip and reports the package', async () => {
    const { onPackage, input } = setup();
    fireEvent.change(input, { target: { files: [await zipFile('p.zip')] } });
    expect(await screen.findByText('/sitecore/content/A')).toBeInTheDocument();
    expect(screen.getByText('Single item')).toBeInTheDocument();
    expect(screen.getByText('Latest wins')).toBeInTheDocument();
    expect(screen.getByText('p.zip').parentElement).toHaveTextContent('p.zip · 1 chunk');
    expect(onPackage).toHaveBeenCalledOnce();
    const pkg = onPackage.mock.calls[0][0];
    expect(pkg.fileName).toBe('p.zip');
    expect(pkg.parts).toHaveLength(1);
  });

  it('accepts a dropped file', async () => {
    const { onPackage } = setup();
    fireEvent.drop(screen.getByText(/Drop a package/), { dataTransfer: { files: [await zipFile('d.zip')] } });
    expect(await screen.findByText('/sitecore/content/A')).toBeInTheDocument();
    expect(onPackage).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'd.zip' }));
  });

  it('says so when a package has no metadata', async () => {
    const { input } = setup();
    fireEvent.change(input, { target: { files: [new File(['raif'], 'bare.raif')] } });
    expect(await screen.findByText('No metadata in this package.')).toBeInTheDocument();
  });

  it('shows the error for an unsupported file and reports null', async () => {
    const { onPackage, input } = setup();
    fireEvent.change(input, { target: { files: [new File(['x'], 'q.txt')] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a .zip or .raif package.');
    expect(onPackage).toHaveBeenCalledWith(null);
  });

  it('drops the previous package when the next file is invalid', async () => {
    const { onPackage, input } = setup();
    fireEvent.change(input, { target: { files: [await zipFile('p.zip')] } });
    await screen.findByText('/sitecore/content/A');
    fireEvent.change(input, { target: { files: [new File(['x'], 'q.txt')] } });
    await screen.findByRole('alert');
    expect(screen.queryByText('/sitecore/content/A')).not.toBeInTheDocument();
    expect(onPackage).toHaveBeenLastCalledWith(null);
  });

  it('ignores drops and disables the input when disabled', async () => {
    const { onPackage, input } = setup(true);
    expect(input).toBeDisabled();
    fireEvent.drop(screen.getByText(/Drop a package/), { dataTransfer: { files: [await zipFile('d.zip')] } });
    expect(onPackage).not.toHaveBeenCalled();
  });
});
