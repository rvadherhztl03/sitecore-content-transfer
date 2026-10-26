import { Flow } from '@/components/transfer/Flow';
import { Home, type Screen } from '@/components/transfer/Home';
import { InstallFlow } from '@/components/transfer/InstallFlow';
import { AppHeader } from '@/components/transfer/Layout';
import type { SdkClient } from '@/lib/sdk';
import { useEnvironments } from '@/utils/hooks/useEnvironments';
import { useState } from 'react';

/** The full-screen app: Home, or one of the flows. Going Home drops the flow, so the next open starts fresh. */
export function App({ client }: { client: SdkClient | null }) {
  const { envs, loading, error, retry } = useEnvironments(client);
  const [screen, setScreen] = useState<Screen | 'home'>('home');
  const home = () => setScreen('home');
  // The flows capture their defaults when they mount, so they only mount once the environments are in.
  const ready = !!client && !loading && !error;
  // Environments reloading under an open flow: back to Home, so the flow remounts with the new list.
  if (screen !== 'home' && !ready) setScreen('home');

  if (client && ready && screen !== 'home') {
    return screen === 'install' ? (
      <InstallFlow client={client} envs={envs} onHome={home} />
    ) : (
      <Flow client={client} mode={screen} envs={envs} onHome={home} />
    );
  }

  return (
    <div className="bg-muted flex min-h-screen flex-col">
      {/* A chip saying "0 environments connected" would read as a success. */}
      <AppHeader envCount={ready && envs.length > 0 ? envs.length : undefined} />
      <Home envs={envs} loading={loading} error={error} onRetry={retry} onOpen={setScreen} />
    </div>
  );
}
