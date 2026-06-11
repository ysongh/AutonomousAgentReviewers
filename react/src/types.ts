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

// Mirrors SubmissionRecord in shared/schemas.js. The dashboard only reads the
// two Phase 2 video fields (via /verify on the submissionRootHash, to recover
// the playable retrieval URL — it never lands on the /submit response). Both
// are null for video-less submissions, so existing parsing is unaffected.
export type SubmissionRecord = {
  submissionId: string;
  repoUrl: string;
  repoName: string;
  repoDescription: string | null;
  readme: string;
  fileTree: string[];
  fetchedAt: string;
  demoVideoPieceCid: string | null;
  demoVideoRetrievalUrl: string | null;
};

// Mirrors DemoVerdict in shared/schemas.js — the demo judge's artifact on 0G.
// Its evidence/claims_check are timestamped objects, NOT the text judges'
// string[]. The demo judge never revises (score final by design), so there is
// no RevisedVerdict counterpart.
export type DemoEvidence = {
  timestamp: string; // "MM:SS"
  observation: string;
};

export type ClaimVerdict = 'shown' | 'asserted-only' | 'contradicted';

export type ClaimCheck = {
  claim: string;
  verdict: ClaimVerdict;
  timestamp: string | null; // "MM:SS" or null
};

export type DemoVerdict = {
  agentId: string; // "judge-demo"
  submissionId: string;
  score: number;
  reasoning: string;
  evidence: DemoEvidence[];
  claims_check: ClaimCheck[];
  videoPieceCid: string;
  producedAt: string;
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
    // Optional: the judge-demo round1Verdicts entry carries a
    // claimsCheckSummary count string INSTEAD of evidence[] (its evidence is
    // timestamped objects, not the text judges' string[]). Phase 3 additive.
    evidence?: string[];
    claimsCheckSummary?: string;
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
    // Present iff a demo participated; equals the demo's round-1 score (the
    // demo judge never revises). Phase 3 additive — absent on no-video runs.
    demo?: number;
  };
  weightedAggregate: number;
  spread: number;
  dissent: boolean;
  dissentSummary: string;
  producedAt: string;
  // Phase 3 additions, all OPTIONAL (a no-video run is byte-identical to
  // Phase 1/2). `weights` is the self-describing record of the weights
  // actually used: 0.35/0.25/0.25/0.15 with a demo, 0.4/0.3/0.3 without.
  weights?: {
    technical: number;
    originality: number;
    skeptic: number;
    demo?: number;
  };
  demoVerdictRootHash?: string;
};

export type SubmissionResponse = {
  submissionId: string;
  submissionRootHash: string;
  verdicts: VerdictEntry[];
  failures: Failure[];
  panelVerdictRootHash: string | null;
  panelVerdict: PanelVerdict | null;
  // Phase 3 demo fields — present on the response ONLY when a video was
  // submitted (intake omits all of them on a video-less run, so existing
  // parsing is byte-for-byte unchanged). Mutually informative:
  //   - success:  demoVerdict + demoVerdictRootHash set.
  //   - degraded: demoVerdict null + demoVideoError (transcode/upload failed).
  //   - review failed: demoVerdict null + demoVerdictError.
  demoVerdict?: DemoVerdict | null;
  demoVerdictRootHash?: string | null;
  demoVideoError?: string;
  demoVerdictError?: string;
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
