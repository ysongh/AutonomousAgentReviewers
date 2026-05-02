// Mirrors the canonical SSE shape from shared/logger.js. Keep field names
// identical to what the agents emit — no client-side renaming.
export type LogEvent = {
  timestamp: string;
  agentId: string;
  event: string;
  submissionId?: string;
  rootHash?: string;
  durationMs?: number;
  error?: string;
  // Pino's own metadata fields and any extra context the call site adds.
  level?: number;
  name?: string;
  [key: string]: unknown;
};

// Mirrors JudgeVerdict in shared/schemas.js.
export type Verdict = {
  agentId: string;
  submissionId: string;
  score: number;
  reasoning: string;
  evidence: string[];
  producedAt: string;
};

export type VerdictEntry = {
  judgeId: string;
  verdictRootHash: string;
  verdict: Verdict;
};

export type Failure = {
  judgeId: string;
  error: string;
};

// Mirrors RevisedVerdict in shared/schemas.js. revisedScore + revisionReasoning
// are present iff revised=true (zod-refine on the server side).
export type RevisedVerdict = {
  agentId: string;
  submissionId: string;
  originalVerdictRootHash: string;
  revised: boolean;
  revisedScore?: number;
  revisionReasoning?: string;
  producedAt: string;
};

// Mirrors PanelVerdict in shared/schemas.js. revisionRootHash is null when the
// judge's /revise call failed and the aggregator counted them as
// abstain-due-to-failure.
//
// abstainReason is CLIENT-DERIVED, not on the wire. The on-chain panel verdict
// records the outcome only (`revised: false`, no score); the cause lives in
// the aggregator's log (`judge-abstain-by-choice` vs
// `judge-abstain-due-to-failure`). Since the dashboard doesn't read the log
// retroactively, we infer the reason from `revisionRootHash`: null means the
// revise call failed (forced abstain), non-null means the judge chose to hold.
// Normalized once in useSubmission so downstream components don't recompute.
export type PanelVerdict = {
  submissionId: string;
  submissionRootHash: string;
  round1Verdicts: Array<{
    agentId: string;
    score: number;
    reasoning: string;
    evidence: string[];
    verdictRootHash: string;
  }>;
  round2Revisions: Array<{
    agentId: string;
    revised: boolean;
    revisedScore?: number;
    revisionReasoning?: string;
    revisionRootHash: string | null;
    abstainReason?: 'held' | 'failure';
  }>;
  finalScores: {
    technical: number;
    originality: number;
    skeptic: number;
  };
  weightedAggregate: number;
  spread: number;
  dissent: boolean;
  dissentSummary: string;
  producedAt: string;
};

export type SubmissionResponse = {
  submissionId: string;
  submissionRootHash: string;
  verdicts: VerdictEntry[];
  failures: Failure[];
  panelVerdictRootHash: string | null;
  panelVerdict: PanelVerdict | null;
};

export type RunStatus = 'idle' | 'submitting' | 'complete' | 'error';

export type RunState = {
  status: RunStatus;
  repoUrl: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  response: SubmissionResponse | null;
  errorMessage: string | null;
  // Derived in useSubmission once the response lands. failedRound1 is true
  // when intake skipped aggregation because <3 round-1 verdicts succeeded
  // (panelVerdict will also be null in that case). failureSummary is a
  // human-readable one-liner pulled from `response.failures` for the
  // RunSummary component to render on the round-1-race path.
  failedRound1: boolean;
  failureSummary: string | null;
};

export type AgentState = 'idle' | 'working' | 'errored';
