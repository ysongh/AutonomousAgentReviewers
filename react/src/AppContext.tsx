import { createContext, useContext, type ReactNode } from 'react';
import { useEventStream } from './hooks/useEventStream';
import { useSubmission } from './hooks/useSubmission';
import type { LogEvent, RunState } from './types';

type AppCtx = {
  events: LogEvent[];
  connected: boolean;
  run: RunState;
  submit: (repoUrl: string) => Promise<void>;
  reset: () => void;
};

const AppContext = createContext<AppCtx | null>(null);

// Lives above <Routes> so the SSE connection and run state survive
// navigation between pages.
export function AppProvider({ children }: { children: ReactNode }) {
  const { events, connected } = useEventStream();
  const { run, submit, reset } = useSubmission();
  return (
    <AppContext.Provider value={{ events, connected, run, submit, reset }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppCtx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
