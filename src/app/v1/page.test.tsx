import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import V1Page from '@/app/v1/page';

// The dashboard itself is covered by its own tests; here it only has to show up with the v1 title.
vi.mock('@/components/MigrationDashboard', () => ({ default: ({ title }: { title: string }) => <h1>{title}</h1> }));

const open = (search = '') => {
  window.history.replaceState(null, '', `/v1${search}`);
  render(<V1Page />);
};
const back = () => screen.getByRole('link', { name: 'Back to version 2' });

describe('/v1', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('shows the classic dashboard inside the scoped v1 wrapper', () => {
    open();
    const heading = screen.getByRole('heading', { name: 'Content Transfer v1 (classic)' });
    expect(heading.closest('.v1-app')).not.toBeNull();
    expect(screen.getByText('Content Transfer v1 (classic): connects with client credentials')).toBeInTheDocument();
  });

  it('goes back to the full-screen app by default', () => {
    open();
    expect(back()).toHaveAttribute('href', '/fullscreen-extension');
  });

  it('goes back to the extension page that opened it', () => {
    open('?back=%2Fstandalone-extension');
    expect(back()).toHaveAttribute('href', '/standalone-extension');
  });

  it('ignores a back link that is not a plain app path', () => {
    open('?back=https%3A%2F%2Fevil.example');
    expect(back()).toHaveAttribute('href', '/fullscreen-extension');
    open('?back=%2F%2Fevil.example');
    expect(screen.getAllByRole('link', { name: 'Back to version 2' }).at(-1)).toHaveAttribute('href', '/fullscreen-extension');
  });
});
