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

export type SubmissionResponse = {
  submissionId: string;
  submissionRootHash: string;
  verdicts: VerdictEntry[];
  failures: Failure[];
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
