// src/components/MigrationDashboard.test.tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import MigrationDashboard from './MigrationDashboard';

vi.mock('@/src/utils/migrationService', () => {
  return {
    MigrationService: class {
      private config: any;
      private callbacks: any;
      constructor(config: any, callbacks: any) {
        this.config = config;
        this.callbacks = callbacks;
      }
      async runMigration() {
        // Simulate some callback fires immediately
        this.callbacks.onLog('Mock initiate', 'info');
        this.callbacks.onStepChange(0, 'running');
        this.callbacks.onProgress(15);
        this.callbacks.onStepChange(0, 'done');
        this.callbacks.onLog('Mock success', 'success');
        this.callbacks.onProgress(100);
        return true;
      }
      async runPackageDownloadFlow() {
        this.callbacks.onLog('Mock initiate download', 'info');
        this.callbacks.onStepChange(0, 'running');
        this.callbacks.onProgress(30);
        this.callbacks.onStepChange(0, 'done');
        this.callbacks.onLog('Mock status completed', 'success');
        this.callbacks.onProgress(100);
        return true;
      }
      async runPackageImportFlow(fileBuffer: ArrayBuffer) {
        this.callbacks.onLog('Mock upload package', 'info');
        this.callbacks.onStepChange(0, 'running');
        this.callbacks.onProgress(25);
        this.callbacks.onStepChange(0, 'done');
        this.callbacks.onLog('Mock consume target', 'success');
        this.callbacks.onProgress(100);
        return true;
      }
    }
  };
});

describe('MigrationDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the dashboard with correct title and settings', () => {
    render(<MigrationDashboard title="Sitecore Sync Test" />);
    
    // Check main title
    expect(screen.getByText('Sitecore Sync Test')).toBeInTheDocument();
    
    // Check initial environment settings labels
    expect(screen.getByText('📡 Connection Credentials')).toBeInTheDocument();
    expect(screen.getByText('Demo Mode')).toBeInTheDocument();
    
    // Check default item path
    expect(screen.getByDisplayValue('/sitecore/content/Home')).toBeInTheDocument();
  });

  it('allows adding and removing content tree configurations', () => {
    render(<MigrationDashboard />);
    
    // Click Add Path
    const addButton = screen.getByText('+ Add Path');
    fireEvent.click(addButton);
    
    // Check that we now have two item path inputs
    const inputs = screen.getAllByDisplayValue(/\/sitecore\/content\//);
    expect(inputs.length).toBe(2);

    // Click remove button on the second tree row
    const removeButtons = screen.getAllByRole('button', { name: '×' });
    fireEvent.click(removeButtons[1]);

    // Check we are back to one
    const inputsAfter = screen.getAllByDisplayValue(/\/sitecore\/content\//);
    expect(inputsAfter.length).toBe(1);
  });

  it('toggles demo mode status', () => {
    render(<MigrationDashboard />);
    
    // Secret inputs should be visible initially because demo mode defaults to false
    expect(screen.getAllByPlaceholderText(/OAuth Client Secret\.\.\./).length).toBe(2);

    const checkbox = screen.getAllByRole('checkbox')[0];
    expect(checkbox).not.toBeChecked(); // defaults to false
    
    // Toggle demo mode on
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    
    // Secret inputs should now be hidden (0 found)
    expect(screen.queryAllByPlaceholderText(/OAuth Client Secret\.\.\./).length).toBe(0);
  });

  it('triggers migration and prints logs to console on run click', async () => {
    render(<MigrationDashboard />);
    
    const runButton = screen.getByRole('button', { name: /Run Transfer/ });
    
    await act(async () => {
      fireEvent.click(runButton);
    });

    // Verify progress update
    expect(screen.getByText('100%')).toBeInTheDocument();
    
    // Verify custom mocked logs appeared in console container
    expect(screen.getByText('Mock initiate')).toBeInTheDocument();
    expect(screen.getByText('Mock success')).toBeInTheDocument();
  });

  it('triggers package download on download click', async () => {
    render(<MigrationDashboard />);
    
    const downloadButton = screen.getByRole('button', { name: /Download Package/ });
    
    await act(async () => {
      fireEvent.click(downloadButton);
    });

    // Verify progress update
    expect(screen.getByText('100%')).toBeInTheDocument();
    
    // Verify custom mocked logs for download appeared
    expect(screen.getByText(/Package generated and downloaded successfully/)).toBeInTheDocument();
  });

  it('triggers package import on file upload and click', async () => {
    render(<MigrationDashboard />);
    
    // Simulate selecting a file containing paths
    const file = new File(['prefix /sitecore/content/Home/Item1 suffix'], 'test-package.raif', { type: 'application/octet-stream' });
    const input = document.getElementById('package-file-upload') as HTMLInputElement;
    
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    // Check that verify button appeared
    const verifyButton = screen.getByRole('button', { name: /Verify Package Items/ });
    expect(verifyButton).toBeInTheDocument();

    // Click verify
    await act(async () => {
      fireEvent.click(verifyButton);
    });

    // Check that import button appeared
    const importButton = screen.getByRole('button', { name: /Import to Target/ });
    expect(importButton).toBeInTheDocument();

    // Verify parsed package paths panel appeared
    expect(screen.getByText(/Verified Package Contents/)).toBeInTheDocument();
    expect(screen.getAllByText(/Home\/Item1/)[0]).toBeInTheDocument();

    // Get proceed button from modal
    const proceedButton = screen.getByRole('button', { name: /Proceed to Import/ });
    expect(proceedButton).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(proceedButton);
    });

    // Verify progress update
    expect(screen.getByText('100%')).toBeInTheDocument();
    
    // Verify custom mocked logs for upload/import appeared
    expect(screen.getByText(/Package imported successfully/)).toBeInTheDocument();
  });

  it('handles LocalStorage credentials persistence lifecycle', async () => {
    // Setup initial empty localStorage mock
    const localStorageMock = (() => {
      let store: Record<string, string> = {};
      return {
        getItem: (key: string) => store[key] || null,
        setItem: (key: string, value: string) => { store[key] = value.toString(); },
        removeItem: (key: string) => { delete store[key]; },
        clear: () => { store = {}; }
      };
    })();
    Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true });

    render(<MigrationDashboard />);

    // 1. Initial State: Save button is present, disabled initially since consent checkbox is unchecked
    const saveBtn = screen.getByRole('button', { name: /Save Credentials/ });
    expect(saveBtn).toBeDisabled();

    // 2. Check consent checkbox to enable the Save button
    const consentCheckbox = screen.getByLabelText(/I consent to saving these credentials locally/);
    fireEvent.click(consentCheckbox);
    expect(saveBtn).not.toBeDisabled();

    // Fill out hosts/credentials
    const srcHostInput = screen.getByPlaceholderText('https://source-cm-host.com');
    fireEvent.change(srcHostInput, { target: { value: 'https://src-custom.com' } });

    // 3. Click Save Credentials
    fireEvent.click(saveBtn);

    // Verify localStorage has been written
    const stored = JSON.parse(window.localStorage.getItem('sitecore_sync_credentials') || '{}');
    expect(stored.sourceHost).toBe('https://src-custom.com');

    // Button should be hidden, showing "Credentials saved & active" status message
    expect(screen.queryByRole('button', { name: /Save Credentials/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Credentials saved & active/)).toBeInTheDocument();

    // 4. Modify host inputs -> "Update My Credentials" CTA should appear
    fireEvent.change(srcHostInput, { target: { value: 'https://src-modified.com' } });
    const updateBtn = screen.getByRole('button', { name: /Update My Credentials/ });
    expect(updateBtn).toBeInTheDocument();

    // 5. Click Update Credentials
    fireEvent.click(updateBtn);
    expect(screen.queryByRole('button', { name: /Update My Credentials/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Credentials saved & active/)).toBeInTheDocument();

    const storedUpdated = JSON.parse(window.localStorage.getItem('sitecore_sync_credentials') || '{}');
    expect(storedUpdated.sourceHost).toBe('https://src-modified.com');
  });

  it('swaps source and target connection credentials when Swap button is clicked', () => {
    render(<MigrationDashboard />);

    const srcHostInput = screen.getByPlaceholderText('https://source-cm-host.com');
    const tgtHostInput = screen.getByPlaceholderText('https://target-cm-host.com');

    // Set initial values
    fireEvent.change(srcHostInput, { target: { value: 'https://source-initial.com' } });
    fireEvent.change(tgtHostInput, { target: { value: 'https://target-initial.com' } });

    // Click Swap button
    const swapBtn = screen.getByRole('button', { name: /Swap/ });
    fireEvent.click(swapBtn);

    // Verify values are swapped
    expect(srcHostInput).toHaveValue('https://target-initial.com');
    expect(tgtHostInput).toHaveValue('https://source-initial.com');
  });
});
