import { useCallback, useState } from 'react';
import { SUBMIT_URL } from '../config';
import type { RunState, SubmissionResponse } from '../types';

const INITIAL: RunState = {
  status: 'idle',
  repoUrl: null,
  startedAt: null,
  finishedAt: null,
  response: null,
  errorMessage: null,
};

// Drives the lifecycle of a single submission. The UI reads `run` to decide
// whether to show the form, the activity log, or the verdict grid. The HTTP
// response carries the verdicts directly — we do not synthesize completion
// from SSE traffic, so this hook is the single source of truth for "done".
export function useSubmission() {
  const [run, setRun] = useState<RunState>(INITIAL);

  const submit = useCallback(async (repoUrl: string) => {
    setRun({
      status: 'submitting',
      repoUrl,
      startedAt: Date.now(),
      finishedAt: null,
      response: null,
      errorMessage: null,
    });

    try {
      const resp = await fetch(SUBMIT_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repoUrl }),
      });

      const text = await resp.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(`Non-JSON response from intake (HTTP ${resp.status})`);
      }

      if (!resp.ok) {
        const msg = (parsed as { error?: string })?.error ?? `HTTP ${resp.status}`;
        throw new Error(msg);
      }

      const response = parsed as SubmissionResponse;
      setRun({
        status: 'complete',
        repoUrl,
        startedAt: Date.now(),
        finishedAt: Date.now(),
        response,
        errorMessage: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRun((prev) => ({
        ...prev,
        status: 'error',
        finishedAt: Date.now(),
        errorMessage: message,
      }));
    }
  }, []);

  const reset = useCallback(() => setRun(INITIAL), []);

  return { run, submit, reset };
}
