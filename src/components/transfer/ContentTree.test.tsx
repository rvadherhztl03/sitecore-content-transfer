import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContentTree } from '@/components/transfer/ContentTree';
import type { Env } from '@/lib/sdk';
import { fakeClient } from '@/test/fakeClient';

const ENV: Env = { id: 'r1', name: 'Dev', contextId: 'ctx-dev' };

const item = (name: string, path: string, hasChildren = false) => ({
  itemId: name,
  name,
  path,
  children: { nodes: hasChildren ? [{ itemId: 'child' }] : [] },
});
const reply = (...nodes: ReturnType<typeof item>[]) => ({ data: { data: { item: { children: { nodes } } } } });

const TREE: Record<string, ReturnType<typeof item>[]> = {
  '/sitecore': [item('content', '/sitecore/content', true), item('media library', '/sitecore/media library')],
  '/sitecore/content': [item('Home', '/sitecore/content/Home')],
};
const byPath = (params: { body: { variables: { path: string } } }) => reply(...(TREE[params.body.variables.path] ?? []));

function setup(selectedPaths: string[] = [], title?: string) {
  const onToggle = vi.fn();
  const { client, calls } = fakeClient({ 'xmc.authoring.graphql': byPath });
  const view = render(<ContentTree client={client} env={ENV} selectedPaths={selectedPaths} onToggle={onToggle} title={title} />);
  return { onToggle, calls, ...view };
}

describe('ContentTree', () => {
  it('renders the root children', async () => {
    setup();
    expect(await screen.findByText('content')).toBeInTheDocument();
    expect(screen.getByText('media library')).toBeInTheDocument();
  });

  it('shows the title as the card heading', async () => {
    setup([], 'Browse Dev');
    expect(screen.getByRole('heading', { name: 'Browse Dev' })).toBeInTheDocument();
    await screen.findByText('content');
  });

  it('has no heading without a title', async () => {
    setup();
    await screen.findByText('content');
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('searches with the new placeholder and keeps the filter label', async () => {
    setup();
    await screen.findByText('content');
    expect(screen.getByLabelText('Filter loaded items')).toHaveAttribute('placeholder', 'Search loaded items');
  });

  it('tints selected rows only', async () => {
    setup(['/sitecore/content']);
    const row = (await screen.findByRole('checkbox', { name: 'Select /sitecore/content' })).parentElement;
    expect(row).toHaveClass('bg-primary-50');
    expect(screen.getByRole('checkbox', { name: 'Select /sitecore/media library' }).parentElement).not.toHaveClass('bg-primary-50');
  });

  it('expanding loads children', async () => {
    setup();
    const expand = await screen.findByRole('button', { name: 'Expand content' });
    fireEvent.click(expand);
    expect(await screen.findByText('Home')).toBeInTheDocument();
    expect(expand).toHaveAttribute('aria-expanded', 'true');
    expect(expand).toHaveAccessibleName('Collapse content');
  });

  it("keeps Radix's scroll content a block so long names can truncate", async () => {
    const { container } = setup();
    await screen.findByText('content');
    const root = container.querySelector('[data-slot=scroll-area]');
    // jsdom has no stylesheet: assert the DOM shape and class the override selector depends on.
    expect(root?.querySelector(':scope > [data-slot=scroll-area-viewport] > div')).toBeInTheDocument();
    expect(root).toHaveClass('[&>[data-slot=scroll-area-viewport]>div]:!block');
  });

  it('shows an expand button only for nodes with children', async () => {
    setup();
    await screen.findByText('media library');
    expect(screen.queryByRole('button', { name: 'Expand media library' })).not.toBeInTheDocument();
  });

  it('ticking selects a path', async () => {
    const { onToggle, unmount } = setup();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select /sitecore/content' }));
    expect(onToggle).toHaveBeenCalledWith('/sitecore/content', true);
    unmount();

    setup(['/sitecore/content']);
    expect(await screen.findByRole('checkbox', { name: 'Select /sitecore/content' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select /sitecore/media library' })).not.toBeChecked();
  });

  it('unticking reports checked=false', async () => {
    const { onToggle } = setup(['/sitecore/content']);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select /sitecore/content' }));
    expect(onToggle).toHaveBeenCalledWith('/sitecore/content', false);
  });

  it('filter shows matching loaded items', async () => {
    setup();
    await screen.findByText('content');
    fireEvent.change(screen.getByLabelText('Filter loaded items'), { target: { value: 'med' } });
    expect(screen.getByText('media library')).toBeInTheDocument();
    expect(screen.getByText('/sitecore/media library')).toBeInTheDocument();
    expect(screen.queryByText('content')).not.toBeInTheDocument();
  });

  it('tints selected rows in the filtered list too', async () => {
    setup(['/sitecore/media library']);
    await screen.findByText('content');
    fireEvent.change(screen.getByLabelText('Filter loaded items'), { target: { value: 'med' } });
    expect(screen.getByRole('checkbox', { name: 'Select /sitecore/media library' }).parentElement).toHaveClass('bg-primary-50');
  });

  it('shows Retry on error', async () => {
    let n = 0;
    const { client } = fakeClient({
      'xmc.authoring.graphql': (p) => (n++ === 0 ? { status: 500 } : byPath(p)),
    });
    render(<ContentTree client={client} env={ENV} selectedPaths={[]} onToggle={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 500');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('content')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('falls back to a generic message when the error has no text', async () => {
    const { client } = fakeClient({ 'xmc.authoring.graphql': () => ({ data: { errors: [{ message: '' }] } }) });
    render(<ContentTree client={client} env={ENV} selectedPaths={[]} onToggle={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load items.");
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('retries a failed child without touching its siblings', async () => {
    let homeCalls = 0;
    const { client } = fakeClient({
      'xmc.authoring.graphql': (p) =>
        p.body.variables.path === '/sitecore/content' && homeCalls++ === 0 ? { status: 500 } : byPath(p),
    });
    render(<ContentTree client={client} env={ENV} selectedPaths={[]} onToggle={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Expand content' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Home')).toBeInTheDocument();
    expect(screen.getByText('media library')).toBeInTheDocument();
  });

  it('ignores a stale response after the environment changes', async () => {
    const other: Env = { id: 'r2', name: 'QA', contextId: 'ctx-qa' };
    let releaseDev!: () => void;
    const devGate = new Promise<void>((r) => (releaseDev = r));
    const { client, calls } = fakeClient({
      'xmc.authoring.graphql': async (p) => {
        if (p.query.sitecoreContextId === 'ctx-dev') {
          await devGate;
          return reply(item('dev-only', '/sitecore/dev-only'));
        }
        return reply(item('qa-only', '/sitecore/qa-only'));
      },
    });
    const props = { client, selectedPaths: [], onToggle: vi.fn() };
    const { rerender } = render(<ContentTree {...props} env={ENV} />);
    rerender(<ContentTree {...props} env={other} />);
    expect(await screen.findByText('qa-only')).toBeInTheDocument();

    releaseDev();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText('dev-only')).not.toBeInTheDocument();
    expect(screen.getByText('qa-only')).toBeInTheDocument();
  });
});
