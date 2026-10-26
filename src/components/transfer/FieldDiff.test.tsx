import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FieldDiff } from '@/components/transfer/FieldDiff';
import type { Env } from '@/lib/sdk';
import { fakeClient, fieldDiffReply } from '@/test/fakeClient';

const DEV: Env = { id: 'd', name: 'Acme · Dev', contextId: 'ctx-dev' };
const QA: Env = { id: 'q', name: 'Acme · QA', contextId: 'ctx-qa' };
const HOME = '/sitecore/content/Acme/Home';
const LONG = `<r>${'<d><r s:ds="{11111111-2222-3333-4444-555555555555}" /></d>\n'.repeat(200)}</r>`;

const SOURCE = { Title: 'Welcome', Text: LONG, Summary: '', Teaser: 'Hi', Image: '<image />' };
const TARGET = { Title: 'Welcome back', Text: '<p>Old</p>', Summary: 'Short', Image: '<image />', Legacy: 'x' };

// `null`: the item isn't on that side.
function setup(source: Record<string, string> | null = SOURCE, target: Record<string, string> | null = TARGET) {
  const { client } = fakeClient({
    'xmc.authoring.graphql': fieldDiffReply({ 'ctx-dev': source ? { [HOME]: source } : {}, 'ctx-qa': target ? { [HOME]: target } : {} }),
  });
  render(<FieldDiff client={client} source={DEV} target={QA} itemPath={HOME} />);
}
const listed = () => screen.queryAllByRole('button', { name: /^Show values of / }).map((b) => b.getAttribute('aria-label')!.slice('Show values of '.length));
// Opens a field's values and returns one side's block.
const value = (field: string, side: string) => {
  fireEvent.click(screen.getByRole('button', { name: `Show values of ${field}` }));
  return within(screen.getByRole('button', { name: `Hide values of ${field}` }).closest('li')!).getByRole('group', { name: side });
};

describe('FieldDiff', () => {
  it('reads the fields, then lists the changed ones in order', async () => {
    setup();
    expect(screen.getByRole('status')).toHaveTextContent('Reading fields…');
    expect(await screen.findByText(`${DEV.name} compared with ${QA.name}: default language, latest version. Revision and updated dates are left out.`)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: `Changes to ${HOME} on ${QA.name}` })).toBeInTheDocument();
    expect(listed()).toEqual(['Title', 'Text', 'Summary', 'Teaser', 'Legacy']);
    expect(screen.queryByText('No field values differ.')).not.toBeInTheDocument();
  });

  it('Show values shows the full value on each side, (empty) and what a side lacks', async () => {
    setup();
    const show = await screen.findByRole('button', { name: 'Show values of Text' });
    expect(show).toHaveAttribute('aria-expanded', 'false');
    expect(show).toHaveTextContent('Show values');
    fireEvent.click(show);
    expect(show).toHaveAttribute('aria-expanded', 'true');
    expect(show).toHaveTextContent('Hide values');
    const values = document.getElementById(show.getAttribute('aria-controls')!)!;
    // The whole value, not cut short.
    expect(within(values).getByRole('group', { name: 'Acme · Dev' }).querySelector('pre')!.textContent).toBe(LONG);
    expect(within(values).getByRole('group', { name: 'Acme · QA' })).toHaveTextContent('<p>Old</p>');

    expect(value('Summary', 'Acme · Dev')).toHaveTextContent('(empty)');
    expect(value('Teaser', 'Acme · QA')).toHaveTextContent('Not on Acme · QA');
    expect(value('Legacy', 'Acme · Dev')).toHaveTextContent('Not on Acme · Dev');

    fireEvent.click(show);
    expect(document.getElementById(show.getAttribute('aria-controls')!)).toBeNull();
  });

  it('Show all fields adds the unchanged ones after the changed, each with its one value', async () => {
    setup();
    const all = await screen.findByRole('button', { name: 'Show all fields (6)' });
    expect(all).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(all);
    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(listed()).toEqual(['Title', 'Text', 'Summary', 'Teaser', 'Legacy', 'Image']);
    expect(value('Image', 'Both')).toHaveTextContent('<image />');
    fireEvent.click(all);
    expect(listed()).not.toContain('Image');
  });

  it('says when no field values differ', async () => {
    setup({ Title: 'A' }, { Title: 'A' });
    expect(await screen.findByText('No field values differ.')).toHaveAttribute('role', 'status');
    expect(listed()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Show all fields (1)' }));
    expect(listed()).toEqual(['Title']);
  });

  it('says why it could not read the fields', async () => {
    setup(SOURCE, null);
    expect(await screen.findByRole('alert')).toHaveTextContent(`Couldn't read the fields: ${HOME} isn't on Acme · QA.`);
  });
});
