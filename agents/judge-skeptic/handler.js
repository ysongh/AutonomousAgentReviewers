const { uploadJSON, downloadJSON } = require('aar-shared/og-storage');
const { callJudge } = require('aar-shared/claude');
const { SubmissionRecord, JudgeVerdict } = require('aar-shared/schemas');
const { AGENT_IDS } = require('aar-shared/config');
const { EVENTS, startTimer } = require('aar-shared/logger');
const { SYSTEM, buildUserPrompt, VERDICT_TOOL_SCHEMA } = require('./prompt');

const AGENT_ID = AGENT_IDS.judgeSkeptic;

async function judge({ submissionRootHash, submissionId }, logger) {
  if (!submissionRootHash || !submissionId) {
    throw new Error('submissionRootHash and submissionId are required');
  }

  logger.info({
    event: EVENTS.SUBMISSION_RECEIVED,
    submissionId,
    rootHash: submissionRootHash,
  });

  const raw = await downloadJSON(submissionRootHash, { logger, submissionId });
  const submission = SubmissionRecord.parse(raw);

  if (submission.submissionId !== submissionId) {
    throw new Error(
      `submissionId mismatch: handler got ${submissionId}, record has ${submission.submissionId}`,
    );
  }

  const claudeTimer = startTimer();
  logger.info({
    event: EVENTS.CLAUDE_START,
    submissionId,
    repoName: submission.repoName,
  });
  const { input, usage, model } = await callJudge({
    system: SYSTEM,
    user: buildUserPrompt(submission),
    schema: VERDICT_TOOL_SCHEMA,
  });
  logger.info({
    event: EVENTS.CLAUDE_COMPLETE,
    submissionId,
    model,
    usage,
    durationMs: claudeTimer(),
  });

  const verdict = JudgeVerdict.parse({
    agentId: AGENT_ID,
    submissionId: submission.submissionId,
    score: input.score,
    reasoning: input.reasoning,
    evidence: input.evidence,
    producedAt: new Date().toISOString(),
  });

  const { rootHash: verdictRootHash } = await uploadJSON(verdict, { logger, submissionId });
  return { verdictRootHash };
}

module.exports = { judge, AGENT_ID };
