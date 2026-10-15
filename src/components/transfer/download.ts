/** Saves `blob` as a file named `fileName`. */
export function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking right after click() can drop the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Today as YYYY-MM-DD, in local time. */
export const localDate = (d = new Date()) => [d.getFullYear(), d.getMonth() + 1, d.getDate()].map(pad).join('-');

/** The file name for a backup of `target` taken now: backup-<target>-YYYY-MM-DD-HHmm.zip. */
export const backupName = (target: string, d = new Date()) => `backup-${target}-${localDate(d)}-${pad(d.getHours())}${pad(d.getMinutes())}.zip`;
