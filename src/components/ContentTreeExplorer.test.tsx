// src/components/ContentTreeExplorer.test.tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ContentTreeExplorer from './ContentTreeExplorer';

describe('ContentTreeExplorer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('renders the root node sitecore correctly', () => {
    render(
      <ContentTreeExplorer
        sourceHost="https://dev.sitecore.com"
        sourceClientId="client-id"
        sourceClientSecret="secret"
        sourceAuthority="https://auth.com"
        selectedPaths={[]}
        onSelectionChange={() => {}}
        isMigrating={false}
        demoMode={true}
      />
    );

    expect(screen.getByText(/sitecore/)).toBeInTheDocument();
  });

  it('expands the root node and displays fetched child nodes', async () => {
    // Mock the children API response
    const mockChildren = [
      { id: 'content', name: 'content', path: '/sitecore/content', hasChildren: true },
      { id: 'media', name: 'media library', path: '/sitecore/media library', hasChildren: false }
    ];

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockChildren)
    });

    render(
      <ContentTreeExplorer
        sourceHost="https://dev.sitecore.com"
        sourceClientId="client-id"
        sourceClientSecret="secret"
        sourceAuthority="https://auth.com"
        selectedPaths={[]}
        onSelectionChange={() => {}}
        isMigrating={false}
        demoMode={true}
      />
    );

    // Initial state: child nodes not visible
    expect(screen.queryByText(/media library/)).not.toBeInTheDocument();

    // Click on the expand chevron button (rendered as ▶)
    const expandButton = screen.getByText('▶');
    
    await act(async () => {
      fireEvent.click(expandButton);
    });

    // Children should now be rendered
    expect(screen.getByText(/content/)).toBeInTheDocument();
    expect(screen.getByText(/media library/)).toBeInTheDocument();
    
    // Check if proxy was called with correct parameters
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/migrate/children',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          sourceHost: 'https://dev.sitecore.com',
          sourceClientId: 'demo-client-id',
          sourceClientSecret: 'demo-client-secret',
          sourceAuthority: 'https://auth-demo.sitecorecloud.io',
          sourceAudience: 'https://api.sitecorecloud.io',
          parentId: '/sitecore'
        })
      })
    );
  });

  it('toggles selection when checking/unchecking checkboxes', async () => {
    const handleSelectionChange = vi.fn();

    render(
      <ContentTreeExplorer
        sourceHost="https://dev.sitecore.com"
        sourceClientId="client-id"
        sourceClientSecret="secret"
        sourceAuthority="https://auth.com"
        selectedPaths={['/sitecore']}
        onSelectionChange={handleSelectionChange}
        isMigrating={false}
        demoMode={true}
      />
    );

    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeChecked();

    // Uncheck root
    fireEvent.click(checkbox);
    expect(handleSelectionChange).toHaveBeenCalledWith([]);
  });
});
