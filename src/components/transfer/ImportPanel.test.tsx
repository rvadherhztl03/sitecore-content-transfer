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

// Two chunks (the second one media), 4 + 6 bytes of raif.
async function chunkedZip(name: string) {
  const chunks = [
    { chunkSet: 0, index: 0, isMedia: false, offset: 0, length: 4 },
    { chunkSet: 0, index: 1, isMedia: true, offset: 4, length: 6 },
  ];
  const zip = new JSZip().file('package.raif', 'raif-bytes').file('package-chunks.json', JSON.stringify(chunks));
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
    expect(screen.getByText('This item only')).toBeInTheDocument();
    expect(screen.getByText('Keep the newer one')).toBeInTheDocument();
    expect(screen.getByText("What's inside")).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'If it exists' })).toBeInTheDocument();
    expect(screen.getByText('p.zip')).toHaveClass('font-mono');
    expect(screen.getByText(/1 chunk · 0 media/)).toBeInTheDocument();
    expect(onPackage).toHaveBeenCalledTimes(2);
    const pkg = onPackage.mock.lastCall![0];
    expect(pkg.fileName).toBe('p.zip');
    expect(pkg.parts).toHaveLength(1);
  });

  it('reports null while a replacement is parsing, then the new package', async () => {
    const { onPackage, input } = setup();
    fireEvent.change(input, { target: { files: [await zipFile('p.zip')] } });
    await screen.findByText('p.zip');
    onPackage.mockClear();
    fireEvent.change(input, { target: { files: [await zipFile('r.zip')] } });
    // Synchronously, before the file is read: nothing is loaded.
    expect(onPackage).toHaveBeenCalledOnce();
    expect(onPackage).toHaveBeenCalledWith(null);
    await screen.findByText('r.zip');
    expect(onPackage).toHaveBeenCalledTimes(2);
    expect(onPackage).toHaveBeenLastCalledWith(expect.objectContaining({ fileName: 'r.zip' }));
  });

  it('accepts a dropped file', async () => {
    const { onPackage } = setup();
    fireEvent.drop(screen.getByText(/Drop a .zip or .raif here/), { dataTransfer: { files: [await zipFile('d.zip')] } });
    expect(await screen.findByText('/sitecore/content/A')).toBeInTheDocument();
    expect(onPackage).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'd.zip' }));
  });

  it('shows the drop zone copy before anything is loaded', () => {
    setup();
    expect(screen.getByText('Drop a .zip or .raif here, or browse')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Replace' })).not.toBeInTheDocument();
  });

  it('shows the size, chunk and media counts on the file card', async () => {
    const { onPackage, input } = setup();
    const file = await chunkedZip('c.zip');
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText(/ · 2 chunks · 1 media$/)).toBeInTheDocument();
    expect(onPackage).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'c.zip', size: file.size }));
  });

  it('formats the size with one decimal', async () => {
    const { input } = setup();
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(1536)], 'big.raif')] } });
    expect(await screen.findByText('1.5 KB · 1 chunk · 0 media')).toBeInTheDocument();
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(512)], 'small.raif')] } });
    expect(await screen.findByText('512 B · 1 chunk · 0 media')).toBeInTheDocument();
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(3 * 1024 * 1024)], 'huge.raif')] } });
    expect(await screen.findByText('3.0 MB · 3 chunks · 0 media')).toBeInTheDocument();
  });

  it('Replace opens the file chooser', async () => {
    const { input } = setup();
    fireEvent.change(input, { target: { files: [await zipFile('p.zip')] } });
    const click = vi.spyOn(input, 'click');
    fireEvent.click(await screen.findByRole('button', { name: 'Replace' }));
    expect(click).toHaveBeenCalledOnce();
  });

  it('says so when a package has no metadata', async () => {
    const { input } = setup();
    fireEvent.change(input, { target: { files: [new File(['raif'], 'bare.raif')] } });
    expect(await screen.findByText('No metadata in this package.')).toBeInTheDocument();
    expect(screen.queryByText("What's inside")).not.toBeInTheDocument();
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
    fireEvent.drop(screen.getByText(/Drop a .zip or .raif here/), { dataTransfer: { files: [await zipFile('d.zip')] } });
    expect(onPackage).not.toHaveBeenCalled();
  });
});
