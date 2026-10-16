import { ActionBar, AppHeader, PageHeading } from '@/components/transfer/Layout';
import { EnvBadge, EnvironmentCards } from '@/components/transfer/EnvironmentCards';
import { Segmented } from '@/components/transfer/Segmented';
import { Stepper } from '@/components/transfer/Stepper';
import type { Env } from '@/lib/sdk';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const DEV: Env = { id: 'dev', name: 'Acme · Development', contextId: 'c1', tenantName: 'acme-dev' };
const LONG: Env = { id: 'qa', name: 'petsuppliesplus / devpetsuppliesplus-qa', contextId: 'c2', tenantName: 'devpetsuppliesplus-qa' };
const PROD: Env = { id: 'prod', name: 'Acme · Production', contextId: 'c3', tenantName: 'acme-prod' };
const STAGING: Env = { id: 'stg', name: 'petsuppliesplus / staging', contextId: 'c5' };
const PLAIN: Env = { id: 'sbx', name: 'Sandbox', contextId: 'c4' };

describe('AppHeader', () => {
  it('calls onHome from the logo and title button', () => {
    const onHome = vi.fn();
    render(<AppHeader onHome={onHome} />);
    expect(screen.getByText('Content Transfer')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Content Transfer/ }));
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it('shows the environment chip with the right plural, and the crumb', () => {
    const { rerender } = render(<AppHeader onHome={vi.fn()} envCount={3} crumb="New transfer" />);
    expect(screen.getByText('3 environments connected')).toBeInTheDocument();
    expect(screen.getByText('New transfer')).toBeInTheDocument();
    rerender(<AppHeader onHome={vi.fn()} envCount={1} />);
    expect(screen.getByText('1 environment connected')).toBeInTheDocument();
    expect(screen.queryByText('New transfer')).not.toBeInTheDocument();
  });

  it('disables the brand button, keeping its name, without onHome', () => {
    render(<AppHeader crumb="New transfer" />);
    expect(screen.getByRole('button', { name: 'Content Transfer' })).toBeDisabled();
  });

  it('shows Cancel only when onCancel is given', () => {
    const onCancel = vi.fn();
    const { rerender } = render(<AppHeader onHome={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.queryByText(/connected/)).not.toBeInTheDocument();
    rerender(<AppHeader onHome={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('ActionBar and PageHeading', () => {
  it('renders the summary and actions inside a footer', () => {
    render(
      <ActionBar summary={<strong>2 items</strong>}>
        <button type="button">Continue</button>
      </ActionBar>,
    );
    const footer = screen.getByRole('contentinfo');
    expect(footer.tagName).toBe('FOOTER');
    expect(footer).toHaveTextContent('2 items');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
  });

  it('renders the title as h1 with an optional sub line', () => {
    const { rerender } = render(<PageHeading title="Where is the content going?" sub="Pick one." />);
    expect(screen.getByRole('heading', { level: 1, name: 'Where is the content going?' })).toBeInTheDocument();
    expect(screen.getByText('Pick one.')).toBeInTheDocument();
    rerender(<PageHeading title="Only a title" />);
    expect(screen.queryByText('Pick one.')).not.toBeInTheDocument();
  });
});

const STEPS = [
  { label: 'Route', hint: 'Dev → QA · master' },
  { label: 'Content', hint: '2 items selected' },
  { label: 'Review', hint: "Confirm what's written" },
];

describe('Stepper', () => {
  it('makes a done step a button that goes back to it', () => {
    const onGo = vi.fn();
    render(<Stepper steps={STEPS} current={1} onGo={onGo} />);
    const done = screen.getByRole('button', { name: /Route/ });
    expect(done).toHaveTextContent('Dev → QA · master');
    fireEvent.click(done);
    expect(onGo).toHaveBeenCalledWith(0);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('marks the current step and leaves the rest inert', () => {
    render(<Stepper steps={STEPS} current={1} onGo={vi.fn()} />);
    const current = screen.getByText('Content').closest('li');
    expect(current).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Review').closest('li')).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('navigation', { name: 'Transfer steps' })).toBeInTheDocument();
  });

  it('emphasises done and current labels and mutes future ones', () => {
    render(<Stepper steps={STEPS} current={1} onGo={vi.fn()} />);
    expect(screen.getByText('Route')).toHaveClass('font-semibold');
    expect(screen.getByText('Content')).toHaveClass('font-semibold');
    expect(screen.getByText('Review')).toHaveClass('font-medium', 'text-neutral-fg');
  });

  it('announces a done step as completed, as a button and when locked', () => {
    const { unmount } = render(<Stepper steps={STEPS} current={1} onGo={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^Completed:\s*Route/ })).toBeInTheDocument();
    unmount();
    render(<Stepper steps={STEPS} current={1} locked onGo={vi.fn()} />);
    expect(screen.getByText('Completed:', { exact: false })).toHaveClass('sr-only');
  });

  it('renders no step buttons while locked', () => {
    render(<Stepper steps={STEPS} current={2} locked onGo={vi.fn()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Dev → QA · master')).toBeInTheDocument();
    expect(screen.getByText('Review').closest('li')).toHaveAttribute('aria-current', 'step');
  });
});

describe('EnvironmentCards', () => {
  const setup = (props: Partial<React.ComponentProps<typeof EnvironmentCards>> = {}) => {
    const onChange = vi.fn();
    render(<EnvironmentCards legend="From" name="from" envs={[DEV, LONG, PROD]} onChange={onChange} {...props} />);
    return onChange;
  };

  it('renders a radio per environment under the legend and reports a pick', () => {
    const onChange = setup({ value: 'dev' });
    expect(screen.getByRole('group', { name: 'From' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: /Acme · Development/ })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /Acme · Production/ }));
    expect(onChange).toHaveBeenCalledWith('prod');
  });

  it("shows each environment's own type as its badge", () => {
    setup();
    expect(screen.getByText('Prod')).toBeInTheDocument();
    expect(screen.getByText('QA')).toBeInTheDocument();
    expect(screen.getByText('Dev')).toBeInTheDocument();
    expect(screen.queryByText('Test')).not.toBeInTheDocument();
  });

  it('never marks the disabled environment as selected', () => {
    setup({ value: 'dev', disabledId: 'dev', disabledReason: 'Already the source' });
    expect(screen.getAllByRole('radio').filter((r) => (r as HTMLInputElement).checked)).toHaveLength(0);
  });

  it('disables the excluded environment and shows the reason instead of its tenant', () => {
    setup({ disabledId: 'dev', disabledReason: 'Already the source' });
    const radio = screen.getByRole('radio', { name: /Acme · Development/ });
    expect(radio).toBeDisabled();
    expect(screen.getByText('Already the source')).toBeInTheDocument();
    expect(screen.queryByText('acme-dev')).not.toBeInTheDocument();
    expect(screen.getByText('acme-prod')).toBeInTheDocument();
  });

  it('renders a long name in full with a matching title', () => {
    setup();
    const name = screen.getByText('petsuppliesplus / devpetsuppliesplus-qa');
    expect(name).toHaveAttribute('title', 'petsuppliesplus / devpetsuppliesplus-qa');
    expect(screen.getByText('devpetsuppliesplus-qa')).toBeInTheDocument();
  });
});

describe('EnvBadge', () => {
  it.each([
    [PROD, 'Prod'],
    [LONG, 'QA'],
    [DEV, 'Dev'],
    [STAGING, 'Staging'],
  ])('labels %j as %s', (env, label) => {
    render(<EnvBadge env={env} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('keeps the warning tone for prod and uses the neutral tone for every other type', () => {
    const { rerender } = render(<EnvBadge env={PROD} />);
    expect(screen.getByText('Prod')).toHaveClass('bg-warning-50', 'text-warning-600');
    for (const [env, label] of [[LONG, 'QA'], [DEV, 'Dev'], [STAGING, 'Staging']] as const) {
      rerender(<EnvBadge env={env} />);
      expect(screen.getByText(label)).toHaveClass('bg-neutral-bg', 'text-neutral-fg');
    }
  });

  it('renders nothing when the kind is unknown', () => {
    const { container } = render(<EnvBadge env={PLAIN} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('Segmented', () => {
  const OPTIONS = [
    { value: 'master', label: 'master' },
    { value: 'web', label: 'web' },
  ];

  it('is a labelled radiogroup whose aria-checked follows the value', () => {
    const { rerender } = render(<Segmented label="Write into database" value="master" options={OPTIONS} onChange={vi.fn()} />);
    expect(screen.getByRole('radiogroup', { name: 'Write into database' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'master' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'web' })).toHaveAttribute('aria-checked', 'false');
    rerender(<Segmented label="Write into database" value="web" options={OPTIONS} onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'web' })).toHaveAttribute('aria-checked', 'true');
  });

  it('reports the clicked option', () => {
    const onChange = vi.fn();
    render(<Segmented label="Database" value="master" options={OPTIONS} onChange={onChange} size="sm" />);
    fireEvent.click(screen.getByRole('radio', { name: 'web' }));
    expect(onChange).toHaveBeenCalledWith('web');
  });

  it('disables every option when disabled', () => {
    const onChange = vi.fn();
    render(<Segmented label="Database" value="master" options={OPTIONS} onChange={onChange} disabled />);
    const radios = screen.getAllByRole('radio');
    radios.forEach((r) => expect(r).toBeDisabled());
    fireEvent.click(radios[1]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('makes only the checked option a tab stop', () => {
    render(<Segmented label="Database" value="web" options={OPTIONS} onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'web' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'master' })).toHaveAttribute('tabindex', '-1');
  });

  it('moves selection and focus with the arrow keys, wrapping at both ends', () => {
    const onChange = vi.fn();
    render(<Segmented label="Database" value="master" options={OPTIONS} onChange={onChange} />);
    const master = screen.getByRole('radio', { name: 'master' });
    const web = screen.getByRole('radio', { name: 'web' });
    master.focus();
    fireEvent.keyDown(master, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('web');
    expect(web).toHaveFocus();
    fireEvent.keyDown(web, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith('master');
    expect(master).toHaveFocus();
    fireEvent.keyDown(master, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('web');
    fireEvent.keyDown(web, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith('master');
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it('ignores other keys', () => {
    const onChange = vi.fn();
    render(<Segmented label="Database" value="master" options={OPTIONS} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('radio', { name: 'master' }), { key: 'Tab' });
    expect(onChange).not.toHaveBeenCalled();
  });
});
