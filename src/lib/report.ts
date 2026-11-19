import { formatDuration } from '@/components/transfer/RunView';
import type { Preflight } from '@/components/transfer/usePreflight';
import type { Run } from '@/components/transfer/useRun';
import { SCOPES, labelOf, mergesFor, nameOf } from '@/lib/queue';
import type { Env } from '@/lib/sdk';
import type { DataTree, StepStatus } from '@/lib/transfer';

export type ReportInput = {
  mode: 'transfer' | 'export';
  source: Env;
  targets: Env[];
  trees: DataTree[];
  /** Each target's pre-flight result, by target id. */
  preflights?: Record<string, Preflight>;
  run?: Run | null;
  at?: Date;
};

// Markup built with `html` escapes every interpolated value; nested `html` fragments and arrays of them go in as is.
class Safe {
  constructor(readonly text: string) {}
}
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const render = (v: unknown): string =>
  v instanceof Safe ? v.text : Array.isArray(v) ? v.map(render).join('') : v === undefined || v === null || v === false ? '' : String(v).replace(/[&<>"']/g, (c) => ESC[c]);
const html = (strings: TemplateStringsArray, ...values: unknown[]) => new Safe(strings.reduce((out, s, i) => out + render(values[i - 1]) + s));

const CSS = `
body { font: 14px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #1f1f2b; margin: 0 auto; max-width: 1000px; padding: 32px 24px; }
h1 { font-size: 24px; margin: 0 0 4px; } h2 { font-size: 18px; margin: 32px 0 8px; } h3 { font-size: 15px; margin: 20px 0 6px; }
p { margin: 4px 0; } .muted { color: #6b6b7b; } .path { font-family: ui-monospace, Menlo, monospace; font-size: 12px; overflow-wrap: anywhere; }
table { border-collapse: collapse; width: 100%; margin: 8px 0; } th, td { border: 1px solid #e2e2ea; padding: 6px 10px; text-align: left; vertical-align: top; }
th { background: #f6f6f9; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #6b6b7b; }
ol.log { list-style: none; padding: 12px 16px; margin: 8px 0; background: #14141a; color: #e8e8ef; border-radius: 8px; font: 12px/1.6 ui-monospace, Menlo, monospace; }
.warning { color: #b25e09; } .error, .fail { color: #c4161c; } .success, .done { color: #1b7f3b; } ol.log .warning { color: #f5b14c; } ol.log .error { color: #ff7a7a; } ol.log .success { color: #6fdc8c; }
`;

const STATUS: Record<StepStatus, string> = { pending: 'Not started', running: 'Running', done: 'Done', fail: 'Failed' };
const ON_TARGET = { new: 'Missing', same: 'Already there', other: 'Different item here' } as const;

// The item's status on the target, most serious first: the same words as the Review step's On <target> column.
function statusOf(p: Extract<Preflight, { status: 'done' }>, itemPath: string, source: Env): string {
  const c = p.checks.get(itemPath);
  if (!c) return '—';
  if (!c.onSource) return `Not on ${source.name}`;
  if (p.definitions?.some((d) => d.templateOf.includes(itemPath))) return 'Template missing';
  if (c.onTarget === 'other') return 'Different item here';
  if (c.otherParents.length) return 'Different parent';
  if (c.missingParents.length) return 'Parent missing';
  return c.onTarget === 'new' ? 'New' : 'Exists';
}

const usedBy = (paths: string[]) => paths.map(nameOf).join(', ');

function preflightSection(p: Preflight | undefined, source: Env, target: Env, trees: DataTree[]) {
  const head = html`<h2>Pre-flight check on ${target.name}</h2>`;
  if (p?.status === 'checking') return html`${head}<p class="muted">Still checking when this report was made.</p>`;
  if (p?.status === 'failed') return html`${head}<p class="error">Couldn't check ${target.name}: ${p.error}</p>`;
  // Only what the result is known to hold is read, so a result with more in it still reports.
  if (p?.status !== 'done') return html`${head}<p class="muted">Not checked.</p>`;
  return html`${head}
<table><thead><tr><th>Item</th><th>On ${target.name}</th><th>Parents missing</th><th>Different parents</th><th>Deleted below it</th></tr></thead><tbody>
${trees.map((t) => {
  const c = p.checks.get(t.itemPath);
  return html`<tr><td class="path">${t.itemPath}</td><td>${statusOf(p, t.itemPath, source)}</td><td class="path">${c?.missingParents.join(', ')}</td><td class="path">${c?.otherParents.join(', ')}</td><td>${c?.deleted.join(', ')}</td></tr>\n`;
})}</tbody></table>
<h3>Used by your items but not in the list</h3>
${
  p.related
    ? p.related.length
      ? html`<table><thead><tr><th>Item</th><th>Used by</th><th>On ${target.name}</th></tr></thead><tbody>
${p.related.map((r) => html`<tr><td><strong>${r.name}</strong><br><span class="path">${r.itemPath}</span></td><td>${usedBy(r.usedBy)}</td><td>${ON_TARGET[r.onTarget]}</td></tr>\n`)}</tbody></table>`
      : html`<p class="muted">None.</p>`
    : html`<p class="warning">Couldn't scan for related content: ${p.relatedError ?? 'unknown error'}</p>`
}
<h3>Missing on ${target.name}: templates and renderings</h3>
${
  p.definitions
    ? p.definitions.length
      ? html`<table><thead><tr><th>Kind</th><th>Item</th><th>Used by</th></tr></thead><tbody>
${p.definitions.map((d) => html`<tr><td>${d.kind}</td><td><strong>${d.name}</strong><br><span class="path">${d.itemPath}</span></td><td>${usedBy(d.usedBy)}</td></tr>\n`)}</tbody></table>`
      : html`<p class="muted">None.</p>`
    : html`<p class="warning">Couldn't check templates and renderings: ${p.definitionsError ?? 'unknown error'}</p>`
}`;
}

function runSection(run: Run) {
  const result = run.result === 'success' ? 'Complete' : run.result === 'fail' ? 'Failed' : 'In progress';
  return html`<h2>Run</h2>
<p><strong class="${run.result === 'success' ? 'success' : run.result === 'fail' ? 'fail' : ''}">${result}</strong>${run.tookMs !== undefined ? html` · took ${formatDuration(run.tookMs)}` : ''}</p>
<table><thead><tr><th>Step</th><th>Status</th><th>Took</th></tr></thead><tbody>
${run.steps.map((s) => html`<tr><td>${s.label}</td><td class="${s.status}">${STATUS[s.status]}</td><td>${s.ms !== undefined ? formatDuration(s.ms) : ''}</td></tr>\n`)}</tbody></table>
<h3>Activity log</h3>
${run.logs.length ? html`<ol class="log">${run.logs.map((l) => html`<li class="${l.type}">${l.time}  ${l.text}</li>\n`)}</ol>` : html`<p class="muted">Nothing logged.</p>`}`;
}

/** A self-contained HTML report of the route, the list, each target's pre-flight check and, once started, the run. */
export function buildReport({ mode, source, targets, trees, preflights, run, at = new Date() }: ReportInput): string {
  const title = mode === 'transfer' ? 'Transfer report' : 'Export report';
  const route = mode === 'transfer' ? `${source.name} → ${targets.map((t) => t.name).join(', ')}` : source.name;
  return html`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}: ${route}</title><style>${new Safe(CSS)}</style></head>
<body>
<h1>${title}</h1>
<p class="muted">Generated ${at.toLocaleString()}</p>
<p><strong>Route:</strong> ${route}</p>
<h2>Items (${trees.length})</h2>
<table><thead><tr><th>Path</th><th>Includes</th><th>If it exists</th></tr></thead><tbody>
${trees.map((t) => html`<tr><td class="path">${t.itemPath}</td><td>${labelOf(SCOPES, t.scope, true)}</td><td>${labelOf(mergesFor(t.scope), t.mergeStrategy, true)}</td></tr>\n`)}</tbody></table>
${preflights ? targets.map((t) => preflightSection(preflights[t.id], source, t, trees)) : ''}
${run ? runSection(run) : ''}
</body></html>
`.text;
}
