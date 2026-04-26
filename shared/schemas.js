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

module.exports = { SubmissionRecord, JudgeVerdict };
