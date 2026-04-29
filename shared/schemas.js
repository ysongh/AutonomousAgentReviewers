const { z } = require('zod');

const SubmissionRecord = z.object({
  submissionId: z.string().uuid(),
  repoUrl: z.string().url(),
  repoName: z.string(),
  repoDescription: z.string().nullable(),
  readme: z.string(),
  fileTree: z.array(z.string()),
  fetchedAt: z.string(),
});

const JudgeVerdict = z.object({
  agentId: z.string(),
  submissionId: z.string().uuid(),
  score: z.number().min(0).max(10),
  reasoning: z.string(),
  evidence: z.array(z.string()),
  producedAt: z.string(),
});

// Round-2 output from a judge after seeing peers. Either the judge revised
// (revised=true with new score + reason) or held (revised=false with neither).
// The conditional invariant is enforced via refine — Claude's tool input_schema
// can't express "required iff" cleanly, so the LLM is prompted to populate or
// omit per the rule and zod is the enforcer. Invariant violation = revise call
// failed = aggregator counts the judge as abstained-due-to-failure.
const RevisedVerdict = z
  .object({
    agentId: z.string(),
    submissionId: z.string().uuid(),
    originalVerdictRootHash: z.string(),
    revised: z.boolean(),
    revisedScore: z.number().int().min(0).max(10).optional(),
    revisionReasoning: z.string().optional(),
    producedAt: z.string(),
  })
  .refine(
    (v) =>
      v.revised
        ? v.revisedScore !== undefined && v.revisionReasoning !== undefined
        : v.revisedScore === undefined && v.revisionReasoning === undefined,
    {
      message:
        'revisedScore and revisionReasoning must both be present iff revised=true',
    },
  );

// Aggregator's final artifact. round2Revisions[i].revisionRootHash is nullable:
// null means that judge's /revise call failed (HTTP, 0G, LLM, or zod) and the
// aggregator treated them as abstained-due-to-failure. The reason code lives in
// the aggregator's log entries, not in the on-chain panel verdict.
const PanelVerdict = z.object({
  submissionId: z.string().uuid(),
  submissionRootHash: z.string(),
  round1Verdicts: z.array(
    z.object({
      agentId: z.string(),
      score: z.number().min(0).max(10),
      reasoning: z.string(),
      evidence: z.array(z.string()),
      verdictRootHash: z.string(),
    }),
  ),
  round2Revisions: z.array(
    z.object({
      agentId: z.string(),
      revised: z.boolean(),
      revisedScore: z.number().int().min(0).max(10).optional(),
      revisionReasoning: z.string().optional(),
      revisionRootHash: z.string().nullable(),
    }),
  ),
  finalScores: z.object({
    technical: z.number().min(0).max(10),
    originality: z.number().min(0).max(10),
    skeptic: z.number().min(0).max(10),
  }),
  weightedAggregate: z.number().min(0).max(10),
  spread: z.number().min(0).max(10),
  dissent: z.boolean(),
  dissentSummary: z.string(),
  producedAt: z.string(),
});

module.exports = { SubmissionRecord, JudgeVerdict, RevisedVerdict, PanelVerdict };
