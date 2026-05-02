import { useCallback, useState } from 'react';
import { SUBMIT_URL } from '../config';
import type { PanelVerdict, RunState, SubmissionResponse } from '../types';

const INITIAL: RunState = {
  status: 'idle',
  repoUrl: null,
  startedAt: null,
  finishedAt: null,
  response: null,
  errorMessage: null,
  failedRound1: false,
  failureSummary: null,
};

// abstainReason is client-derived from revisionRootHash (see types.ts). The
// backend deliberately does not put it on the wire, so we tag each round-2
// revision once here rather than recomputing in every render.
function normalizePanel(panel: PanelVerdict | null): PanelVerdict | null {
  if (!panel) return null;
  return {
    ...panel,
    round2Revisions: panel.round2Revisions.map((r) => {
      if (r.revised) return r;
      return {
        ...r,
        abstainReason: r.revisionRootHash === null ? 'failure' : 'held',
      };
    }),
  };
}

function summarizeFailures(response: SubmissionResponse): string | null {
  if (response.failures.length === 0) return null;
  return response.failures
    .map((f) => `${f.judgeId}: ${f.error}`)
    .join(' • ');
}

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
      failedRound1: false,
      failureSummary: null,
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

      const raw = parsed as SubmissionResponse;
      // Tag client-derived abstainReason once so downstream renders don't
      // recompute. failedRound1 is true when intake skipped the aggregator
      // because <3 round-1 verdicts succeeded — that's the hard re-submit
      // signal the dashboard surfaces in the run-summary line.
      const response: SubmissionResponse = {
        ...raw,
        panelVerdict: normalizePanel(raw.panelVerdict),
      };
      const failedRound1 = response.panelVerdict === null && response.verdicts.length < 3;
      setRun({
        status: 'complete',
        repoUrl,
        startedAt: Date.now(),
        finishedAt: Date.now(),
        response,
        errorMessage: null,
        failedRound1,
        failureSummary: summarizeFailures(response),
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
