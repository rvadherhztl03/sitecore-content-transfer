/* eslint-disable @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '@/components/transfer/App';
import { fakeClient, type FakeReply } from '@/test/fakeClient';

const ONE_ENV = 'Grant this app access to another environment in Cloud Portal to transfer between environments.';
const MISSING = 'Missing an environment? Grant this app access to it in Cloud Portal, then reopen the app.';

type Handler = (params: any) => FakeReply | Promise<FakeReply>;

const ENTRIES = [
  { tenantId: 'dev', tenantDisplayName: 'Acme · Development', tenantName: 'acme-dev' },
  { tenantId: 'qa', tenantDisplayName: 'Acme · QA', tenantName: 'acme-qa' },
  { tenantId: 'prod', tenantDisplayName: 'Acme · Production', tenantName: 'acme-prod' },
];
const context = (n: number) => ({
  data: { resourceAccess: ENTRIES.slice(0, n).map((e) => ({ ...e, resourceId: 'r', context: { preview: `ctx-${e.tenantId}` } })) },
});

function setup(ctx: Handler = () => context(3)) {
  const { client } = fakeClient({ 'application.context': ctx });
  return render(<App client={client} />);
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const start = () => screen.findByRole('heading', { name: 'What would you like to do?' });

describe('App', () => {
  it('lists the environments with badges and the connected chip', async () => {
    setup();
    expect(await screen.findByText('3 environments connected')).toBeInTheDocument();
    const list = within(screen.getByRole('list', { name: 'Environments' }));
    expect(list.getAllByRole('listitem')).toHaveLength(3);
    expect(list.getByText('Acme · Development')).toBeInTheDocument();
    expect(list.getByText('acme-dev')).toBeInTheDocument();
    expect(list.getByText('Dev')).toBeInTheDocument();
    expect(list.getByText('Test')).toBeInTheDocument();
    expect(list.getByText('Production')).toBeInTheDocument();
    expect(screen.getByText(MISSING)).toBeInTheDocument();
    expect(screen.queryByText(ONE_ENV)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start a transfer' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Content Transfer' })).toBeDisabled();
  });

  it('shows skeletons and disables the actions while loading, including with no client yet', () => {
    render(<App client={null} />);
    expect(screen.getByRole('heading', { name: 'What would you like to do?' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading environments' })).toBeInTheDocument();
    for (const name of ['Start a transfer', 'Create a package', 'Install a package']) expect(screen.getByRole('button', { name })).toBeDisabled();
    expect(screen.queryByText(/environments? connected/)).not.toBeInTheDocument();
    expect(screen.queryByText(ONE_ENV)).not.toBeInTheDocument();
  });

  it('opens Route for a transfer, and Cancel returns Home', async () => {
    setup();
    await start();
    click('Start a transfer');
    expect(await screen.findByRole('heading', { name: 'Where is the content going?' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'What would you like to do?' })).not.toBeInTheDocument();
    click('Cancel');
    expect(await start()).toBeInTheDocument();
    expect(screen.getByText('3 environments connected')).toBeInTheDocument();
  });

  it('drops the flow when going Home: the next open starts fresh', async () => {
    setup();
    await start();
    click('Start a transfer');
    const from = () => within(screen.getByRole('group', { name: 'From' }));
    fireEvent.click(await from().findByRole('radio', { name: /Production/ }));
    expect(from().getByRole('radio', { name: /Production/ })).toBeChecked();
    click('Cancel');
    await start();
    click('Start a transfer');
    expect(await from().findByRole('radio', { name: /Development/ })).toBeChecked();
    expect(from().getByRole('radio', { name: /Production/ })).not.toBeChecked();
  });

  it('opens export Route with only From', async () => {
    setup();
    await start();
    click('Create a package');
    expect(await screen.findByRole('heading', { name: 'Where is the content coming from?' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'From' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'To' })).not.toBeInTheDocument();
  });

  it('opens Install', async () => {
    setup();
    await start();
    click('Install a package');
    expect(await screen.findByRole('group', { name: 'Install into' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'What would you like to do?' })).not.toBeInTheDocument();
    click('Cancel');
    expect(await start()).toBeInTheDocument();
  });

  it('blocks the transfer with one environment but still offers export and install', async () => {
    setup(() => context(1));
    expect(await screen.findByText(ONE_ENV)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start a transfer' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Create a package' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Install a package' })).toBeEnabled();
    expect(screen.getByText('1 environment connected')).toBeInTheDocument();
    expect(screen.getByText(MISSING)).toBeInTheDocument();
    click('Create a package');
    expect(await screen.findByRole('group', { name: 'From' })).toBeInTheDocument();
  });

  it('with no environments shows the access note, no chip, and disables every action', async () => {
    setup(() => context(0));
    expect(await screen.findByText(MISSING)).toBeInTheDocument();
    expect(screen.getByText(ONE_ENV)).toBeInTheDocument();
    expect(screen.queryByText(/environments? connected/)).not.toBeInTheDocument();
    for (const name of ['Start a transfer', 'Create a package', 'Install a package']) expect(screen.getByRole('button', { name })).toBeDisabled();
  });

  it('shows a Retry alert when the context fails, and Retry reloads', async () => {
    let calls = 0;
    setup(() => {
      if (calls++ === 0) throw new Error('no context');
      return context(3);
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('no context');
    expect(screen.queryByText(/environments? connected/)).not.toBeInTheDocument();
    for (const name of ['Start a transfer', 'Create a package', 'Install a package']) expect(screen.getByRole('button', { name })).toBeDisabled();
    click('Retry');
    expect(await screen.findByText('3 environments connected')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start a transfer' })).toBeEnabled();
  });
});
