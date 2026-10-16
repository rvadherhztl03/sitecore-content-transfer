import { toEnvs, type Env, type SdkClient } from '@/lib/sdk';
import { useCallback, useEffect, useState } from 'react';

type State = { envs: Env[]; loading: boolean; error: string | null };

/** The environments this app was granted, from `application.context`. Loading until the client is ready. */
export function useEnvironments(client: SdkClient | null): State & { retry(): void } {
  const [state, setState] = useState<State>({ envs: [], loading: true, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!client) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      let next: State;
      try {
        // query() resolves `{ error }` instead of throwing.
        const res = await client.query('application.context');
        if (res?.error) throw res.error;
        next = { envs: toEnvs(res?.data), loading: false, error: null };
      } catch (e) {
        next = { envs: [], loading: false, error: e instanceof Error ? e.message : String(e) };
      }
      if (alive) setState(next);
    })();
    return () => {
      alive = false;
    };
  }, [client, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
