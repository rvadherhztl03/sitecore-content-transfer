// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Preflight } from '@/components/transfer/usePreflight';
import type { Run } from '@/components/transfer/useRun';
import type { ItemCheck } from '@/lib/preflight';
import { buildReport, type ReportInput } from '@/lib/report';
import type { DataTree } from '@/lib/transfer';

const DEV = { id: 'd', name: 'Dev', contextId: 'ctx-dev' };
const QA = { id: 'q', name: 'QA', contextId: 'ctx-qa' };
const PROD = { id: 'p', name: 'Prod <live>', contextId: 'ctx-prod' };
const HOME = '/sitecore/content/Acme/Home';
const NEWS = '/sitecore/content/Acme/News';
const TREES: DataTree[] = [
  { itemPath: HOME, scope: 'ItemAndDescendants', mergeStrategy: 'OverrideExistingTree' },
  { itemPath: NEWS, scope: 'ItemAndChildren', mergeStrategy: 'OverrideExistingItem' },
];
const OK: Omit<ItemCheck, 'itemPath'> = { onSource: true, onTarget: 'same', missingParents: [], otherParents: [], deleted: [] };

const done: Preflight = {
  status: 'done',
  checks: new Map([
    [HOME, { itemPath: HOME, ...OK, deleted: ['Old page'] }],
    [NEWS, { itemPath: NEWS, ...OK, onTarget: 'new', missingParents: ['/sitecore/content/Acme'] }],
  ]),
  related: [{ itemPath: '/sitecore/media library/Logo', name: 'Logo', usedBy: [HOME], onTarget: 'new' }],
  definitions: [{ itemPath: '/sitecore/layout/Renderings/Hero', name: 'Hero', kind: 'Rendering', usedBy: [NEWS], templateOf: [] }],
};

const RUN: Run = {
  source: DEV,
  targets: [QA],
  steps: [
    { label: 'Create job on Dev', status: 'done', ms: 2000 },
    { label: 'Import into master', status: 'fail', ms: 65_000 },
    { label: 'Verify', status: 'pending' },
  ],
  progress: 50,
  logs: [
    { text: 'Creating transfer job on Dev.', type: 'info', time: '14:32:01' },
    { text: 'Import failed: <bad> & "worse"', type: 'error', time: '14:33:06' },
  ],
  running: false,
  result: 'fail',
  tookMs: 67_000,
};

const report = (over: Partial<ReportInput> = {}) =>
  buildReport({ mode: 'transfer', source: DEV, targets: [QA], trees: TREES, at: new Date(2026, 10, 19, 14, 32), ...over });
// The report's text, as a reader sees it.
const text = (html: string) =>
  html
    .replace(/<style>[\s\S]*<\/style>/, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

describe('buildReport', () => {
  it('is one HTML document with its styles inline and no external resources', () => {
    const html = report();
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<style>');
    expect(html).not.toMatch(/<link|<script|src=/);
  });

  it('has the title, when it was made, the route and the list in plain labels', () => {
    const t = text(report({ targets: [QA, PROD] }));
    expect(t).toContain('Transfer report');
    expect(t).toContain(`Generated ${new Date(2026, 10, 19, 14, 32).toLocaleString()}`);
    expect(t).toContain('Route: Dev → QA, Prod <live>');
    expect(t).toContain('Items (2)');
    expect(t).toContain(`${HOME} Item + everything below Replace it and everything below`);
    expect(t).toContain(`${NEWS} Item + its children Replace it and its children`);
  });

  it('names only the source for an export', () => {
    const t = text(report({ mode: 'export', targets: [] }));
    expect(t).toContain('Export report');
    expect(t).toContain('Route: Dev ');
    expect(t).not.toContain('Pre-flight');
  });

  it("has each target's pre-flight check: items, related items not in the list, and missing templates and renderings", () => {
    const t = text(report({ preflights: { q: done } }));
    expect(t).toContain('Pre-flight check on QA');
    expect(t).toContain(`${HOME} Exists Old page`);
    expect(t).toContain(`${NEWS} Parent missing /sitecore/content/Acme`);
    expect(t).toContain('Used by your items but not in the list');
    expect(t).toContain('Logo /sitecore/media library/Logo Home Missing');
    expect(t).toContain('Missing on QA: templates and renderings');
    expect(t).toContain('Rendering Hero /sitecore/layout/Renderings/Hero News');
  });

  it('says when a check is still running, failed, or a scan within it failed', () => {
    const scanFailed: Preflight = { status: 'done', checks: new Map(), relatedError: 'Timeout', definitionsError: 'Nope' };
    const t = text(
      report({ targets: [QA, PROD, DEV], preflights: { q: { status: 'checking' }, p: { status: 'failed', error: 'Access denied' }, d: scanFailed } }),
    );
    expect(t).toContain('Pre-flight check on QA Still checking when this report was made.');
    // With a run, the results are the ones captured at Start.
    expect(text(report({ preflights: { q: { status: 'checking' } }, run: RUN }))).toContain('Pre-flight check on QA Still checking when the transfer started.');
    expect(t).toContain("Couldn't check Prod <live>: Access denied");
    expect(t).toContain("Couldn't scan for related content: Timeout");
    expect(t).toContain("Couldn't check templates and renderings: Nope");
  });

  it('tolerates extra fields on a pre-flight result', () => {
    const extra = { ...done, somethingNew: { nested: true } } as Preflight;
    expect(text(report({ preflights: { q: extra } }))).toContain(`${HOME} Exists`);
  });

  it('has the languages the target lacks, locked items and items not approved on the source', () => {
    const t = text(
      report({
        preflights: {
          q: {
            ...done,
            languages: [{ code: 'fr-FR', label: 'French (fr-FR)', body: { languageCode: 'fr', regionCode: 'FR' } }],
            locked: [{ itemPath: HOME, lockedBy: 'sitecore\\anna' }],
            unapproved: [{ itemPath: NEWS, state: 'Draft' }],
          },
        },
      }),
    );
    expect(t).toContain("Languages QA doesn't have French (fr-FR)");
    expect(t).toContain(`Locked on QA Item Locked by ${HOME} sitecore\\anna`);
    expect(t).toContain(`Not approved on Dev Item Workflow state ${NEWS} Draft`);
  });

  it('says when the language, lock or workflow check failed', () => {
    const failed: Preflight = { ...done, languagesError: 'No languages', lockedError: 'Bad lock', unapprovedError: 'Bad workflow' };
    const t = text(report({ preflights: { q: failed } }));
    expect(t).toContain("Couldn't compare languages: No languages");
    expect(t).toContain("Couldn't check locks: Bad lock");
    expect(t).toContain("Couldn't check workflow: Bad workflow");
  });

  it('has the run: its result, each step with status and duration, and the full log', () => {
    const t = text(report({ run: RUN }));
    expect(t).toContain('Run Failed · took 1 min 7 s');
    expect(t).toContain('Create job on Dev Done 2 s');
    expect(t).toContain('Import into master Failed 1 min 5 s');
    expect(t).toContain('Verify Not started');
    expect(t).toContain('14:32:01 Creating transfer job on Dev.');
    expect(t).toContain('14:33:06 Import failed: <bad> & "worse"');
  });

  it('leaves the run out before one starts', () => {
    expect(text(report())).not.toContain('Activity log');
  });

  it('escapes every value', () => {
    const evil = `/sitecore/content/<script>alert("x")</script>&'`;
    const html = report({
      source: { ...DEV, name: '<img src=x onerror=alert(1)>' },
      targets: [PROD],
      trees: [{ itemPath: evil, scope: 'SingleItem', mergeStrategy: 'KeepExistingItem' }],
      preflights: { p: { status: 'failed', error: '<b>bold</b>' } },
      run: { ...RUN, steps: [{ label: '<i>step</i>', status: 'done' }] },
    });
    expect(html).not.toMatch(/<script|<img|<b>|<i>/);
    expect(html).toContain('/sitecore/content/&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
