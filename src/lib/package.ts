import JSZip from 'jszip';

export type PackageItem = { path: string; id: string; scope: string; mergeStrategy: string };
export type ChunkData = { chunkSet: number; index: number; isMedia: boolean; data: Blob };
export type PackagePart = { chunks: { data: Blob; isMedia: boolean }[] };
type ChunkEntry = { chunkSet: number; index: number; isMedia: boolean; offset: number; length: number };
type LegacyItem = { ItemPath: string; ItemId: string; Scope: string; MergeStrategy: string };

// Packages without a chunk map (old zips, bare .raif) are uploaded in slices of this size.
export const LEGACY_SLICE = 1024 * 1024;

export async function buildPackage(chunks: ChunkData[], items: PackageItem[]): Promise<Blob> {
  const sorted = [...chunks].sort((a, b) => a.chunkSet - b.chunkSet || a.index - b.index);
  let offset = 0;
  const map: ChunkEntry[] = sorted.map(({ chunkSet, index, isMedia, data }) => {
    const entry = { chunkSet, index, isMedia, offset, length: data.size };
    offset += data.size;
    return entry;
  });
  const meta: LegacyItem[] = items.map((i) => ({ ItemPath: i.path, ItemId: i.id, Scope: i.scope, MergeStrategy: i.mergeStrategy }));

  const zip = new JSZip();
  zip.file('package-metadata.json', JSON.stringify(meta, null, 2));
  // JSZip can't read a Blob without FileReader (absent in Node), so hand it bytes.
  zip.file('package.raif', await new Blob(sorted.map((c) => c.data)).arrayBuffer());
  zip.file('package-chunks.json', JSON.stringify(map, null, 2));
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}

const slices = (raif: Blob) =>
  Array.from({ length: Math.ceil(raif.size / LEGACY_SLICE) }, (_, i) => ({
    data: raif.slice(i * LEGACY_SLICE, (i + 1) * LEGACY_SLICE),
    isMedia: false,
  }));

export async function readPackage(file: Blob & { name: string }): Promise<{ items: PackageItem[]; parts: PackagePart[] }> {
  const pkg = await unpack(file);
  // Nothing to upload: importing would complete a never-saved chunk set or report success for nothing.
  if (pkg.parts.every((p) => !p.chunks.length)) throw new Error('This package is empty.');
  return pkg;
}

async function unpack(file: Blob & { name: string }): Promise<{ items: PackageItem[]; parts: PackagePart[] }> {
  const name = file.name.toLowerCase();
  // Never read a bare .raif: it can be large, and slices are all the upload needs.
  if (name.endsWith('.raif')) return { items: [], parts: [{ chunks: slices(file) }] };
  if (!name.endsWith('.zip')) throw new Error('Choose a .zip or .raif package.');

  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const raifEntry = zip.file('package.raif');
  if (!raifEntry) throw new Error('This package has no package.raif.');
  const raif = await raifEntry.async('blob');

  const metaEntry = zip.file('package-metadata.json');
  const meta: LegacyItem[] = metaEntry ? JSON.parse(await metaEntry.async('text')) : [];
  const items = meta.map((m) => ({ path: m.ItemPath, id: m.ItemId, scope: m.Scope, mergeStrategy: m.MergeStrategy }));

  const mapEntry = zip.file('package-chunks.json');
  if (!mapEntry) return { items, parts: [{ chunks: slices(raif) }] };
  const parts = new Map<number, PackagePart>();
  for (const e of JSON.parse(await mapEntry.async('text')) as ChunkEntry[]) {
    if (!parts.has(e.chunkSet)) parts.set(e.chunkSet, { chunks: [] });
    parts.get(e.chunkSet)!.chunks.push({ data: raif.slice(e.offset, e.offset + e.length), isMedia: e.isMedia });
  }
  return { items, parts: [...parts.values()] };
}
