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
};

export type AgentState = 'idle' | 'working' | 'errored';
