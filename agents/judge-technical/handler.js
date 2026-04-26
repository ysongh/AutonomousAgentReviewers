const { uploadJSON, downloadJSON } = require('aar-shared/og-storage');
const { callJudge } = require('aar-shared/claude');
const { SubmissionRecord, JudgeVerdict } = require('aar-shared/schemas');
const { AGENT_IDS } = require('aar-shared/config');
const { SYSTEM, buildUserPrompt, VERDICT_TOOL_SCHEMA } = require('./prompt');

const AGENT_ID = AGENT_IDS.judgeTechnical;

async function judge({ submissionRootHash, submissionId }, logger) {
  if (!submissionRootHash || !submissionId) {
    throw new Error('submissionRootHash and submissionId are required');
  }

  logger.info({ action: 'judge.received', submissionRootHash, submissionId });

  const raw = await downloadJSON(submissionRootHash, { logger });
  const submission = SubmissionRecord.parse(raw);

  if (submission.submissionId !== submissionId) {
    throw new Error(
      `submissionId mismatch: handler got ${submissionId}, record has ${submission.submissionId}`,
    );
  }

  logger.info({ action: 'judge.calling_claude', repoName: submission.repoName });
  const { input, usage, model } = await callJudge({
    system: SYSTEM,
    user: buildUserPrompt(submission),
    schema: VERDICT_TOOL_SCHEMA,
  });
  logger.info({ action: 'judge.claude_done', model, usage });

  const verdict = JudgeVerdict.parse({
    agentId: AGENT_ID,
    submissionId: submission.submissionId,
    score: input.score,
    reasoning: input.reasoning,
    evidence: input.evidence,
    producedAt: new Date().toISOString(),
  });

  const { rootHash: verdictRootHash, txHash } = await uploadJSON(verdict, { logger });
  logger.info({ action: 'judge.verdict_uploaded', verdictRootHash, txHash, submissionId });

  return { verdictRootHash };
}

module.exports = { judge, AGENT_ID };
