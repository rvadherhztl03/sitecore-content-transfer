// @vitest-environment node
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { LEGACY_SLICE, buildPackage, readPackage, type ChunkData, type PackageItem } from '@/lib/package';

const CHUNKS: ChunkData[] = [
  { chunkSet: 0, index: 0, isMedia: false, data: new Blob(['aa']) },
  { chunkSet: 0, index: 1, isMedia: true, data: new Blob(['bbb']) },
];
const ITEMS: PackageItem[] = [{ path: '/a', id: '{A}', scope: 'SingleItem', mergeStrategy: 'KeepExistingItem' }];
const LEGACY_META = [{ ItemPath: '/a', ItemId: '{A}', Scope: 'SingleItem', MergeStrategy: 'KeepExistingItem' }];

async function zipOf(files: Record<string, string | Uint8Array>, name: string) {
  const zip = new JSZip();
  for (const [k, v] of Object.entries(files)) zip.file(k, v);
  return new File([await zip.generateAsync({ type: 'uint8array' })], name);
}

const texts = (chunks: { data: Blob }[]) => Promise.all(chunks.map((c) => c.data.text()));

describe('package', () => {
  it('buildPackage writes legacy metadata, raif and chunk map', async () => {
    const zip = await JSZip.loadAsync(await (await buildPackage(CHUNKS, ITEMS)).arrayBuffer());
    expect(JSON.parse(await zip.file('package-metadata.json')!.async('text'))).toEqual(LEGACY_META);
    expect(await zip.file('package.raif')!.async('text')).toBe('aabbb');
    expect(JSON.parse(await zip.file('package-chunks.json')!.async('text'))).toEqual([
      { chunkSet: 0, index: 0, isMedia: false, offset: 0, length: 2 },
      { chunkSet: 0, index: 1, isMedia: true, offset: 2, length: 3 },
    ]);
  });

  it('readPackage round-trips a new package', async () => {
    const { items, parts } = await readPackage(new File([await buildPackage(CHUNKS, ITEMS)], 'p.zip'));
    expect(items).toEqual(ITEMS);
    expect(parts).toHaveLength(1);
    expect(await texts(parts[0].chunks)).toEqual(['aa', 'bbb']);
    expect(parts[0].chunks.map((c) => c.isMedia)).toEqual([false, true]);
  });

  it('readPackage splits chunk sets into parts', async () => {
    const chunks = [...CHUNKS, { chunkSet: 1, index: 0, isMedia: false, data: new Blob(['c']) }];
    const { parts } = await readPackage(new File([await buildPackage(chunks, ITEMS)], 'p.zip'));
    expect(parts).toHaveLength(2);
    expect(await texts(parts[0].chunks)).toEqual(['aa', 'bbb']);
    expect(await texts(parts[1].chunks)).toEqual(['c']);
  });

  it('readPackage reads a legacy zip in 1 MB slices', async () => {
    const file = await zipOf(
      { 'package-metadata.json': JSON.stringify(LEGACY_META), 'package.raif': new Uint8Array(2.5 * LEGACY_SLICE) },
      'old.zip',
    );
    const { items, parts } = await readPackage(file);
    expect(items).toEqual(ITEMS);
    expect(parts).toHaveLength(1);
    expect(parts[0].chunks.map((c) => c.data.size)).toEqual([1048576, 1048576, 524288]);
    expect(parts[0].chunks.every((c) => c.isMedia === false)).toBe(true);
  });

  it('readPackage slices a .raif without reading it', async () => {
    class Unreadable extends Blob {
      name = 'x.raif';
      arrayBuffer(): Promise<ArrayBuffer> {
        throw new Error('read the whole file');
      }
      text(): Promise<string> {
        throw new Error('read the whole file');
      }
    }
    const { items, parts } = await readPackage(new Unreadable([new Uint8Array(1.5 * LEGACY_SLICE)]));
    expect(items).toEqual([]);
    expect(parts).toHaveLength(1);
    expect(parts[0].chunks.map((c) => c.data.size)).toEqual([1048576, 524288]);
  });

  it('readPackage rejects a zip without package.raif', async () => {
    const file = await zipOf({ 'package-metadata.json': JSON.stringify(LEGACY_META) }, 'p.zip');
    await expect(readPackage(file)).rejects.toThrow('This package has no package.raif.');
  });

  it('readPackage rejects other file types', async () => {
    await expect(readPackage(new File(['x'], 'q.txt'))).rejects.toThrow('Choose a .zip or .raif package.');
  });
});
