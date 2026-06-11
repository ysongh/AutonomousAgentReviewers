const { uploadJSON, downloadJSON } = require('aar-shared/og-storage');
const { callJudge } = require('aar-shared/claude');
const { SubmissionRecord, JudgeVerdict, RevisedVerdict, DemoVerdict } = require('aar-shared/schemas');
const { AGENT_IDS } = require('aar-shared/config');
const { EVENTS, startTimer } = require('aar-shared/logger');
const {
  SYSTEM,
  buildUserPrompt,
  VERDICT_TOOL_SCHEMA,
  SYSTEM_REVISE,
  buildRevisePrompt,
  REVISE_TOOL_SCHEMA,
} = require('./prompt');

const AGENT_ID = AGENT_IDS.judgeSkeptic;

async function judge({ submissionRootHash, submissionId }, { logger, signer }) {
  if (!submissionRootHash || !submissionId) {
    throw new Error('submissionRootHash and submissionId are required');
  }
  if (!signer) throw new Error('judge-skeptic handler requires a signer');

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

  const { rootHash: verdictRootHash } = await uploadJSON(verdict, signer, { logger, submissionId });
  return { verdictRootHash };
}

async function revise(
  { submissionId, originalVerdictRootHash, peerVerdictRootHashes, demoVerdictRootHash },
  { logger, signer },
) {
  if (!submissionId) throw new Error('submissionId is required');
  if (!originalVerdictRootHash) throw new Error('originalVerdictRootHash is required');
  if (!Array.isArray(peerVerdictRootHashes) || peerVerdictRootHashes.length === 0) {
    throw new Error('peerVerdictRootHashes must be a non-empty array');
  }
  if (!signer) throw new Error('judge-skeptic revise handler requires a signer');

  const reviseTimer = startTimer();
  logger.info({
    event: EVENTS.REVISE_CALL_START,
    submissionId,
    rootHash: originalVerdictRootHash,
    peerCount: peerVerdictRootHashes.length,
  });

  // Download own + peers + (optionally) the cross-modal demo verdict in one go.
  const [ownRaw, ...restRaws] = await Promise.all([
    downloadJSON(originalVerdictRootHash, { logger, submissionId }),
    ...peerVerdictRootHashes.map((h) => downloadJSON(h, { logger, submissionId })),
    ...(demoVerdictRootHash ? [downloadJSON(demoVerdictRootHash, { logger, submissionId })] : []),
  ]);
  const peerRaws = restRaws.slice(0, peerVerdictRootHashes.length);
  const demoRaw = demoVerdictRootHash ? restRaws[restRaws.length - 1] : null;

  const ownVerdict = JudgeVerdict.parse(ownRaw);
  if (ownVerdict.submissionId !== submissionId) {
    throw new Error(
      `own-verdict submissionId mismatch: revise got ${submissionId}, record has ${ownVerdict.submissionId}`,
    );
  }
  if (ownVerdict.agentId !== AGENT_ID) {
    throw new Error(
      `own-verdict agentId mismatch: this judge is ${AGENT_ID}, record has ${ownVerdict.agentId}`,
    );
  }

  const peerVerdicts = peerRaws.map((raw) => JudgeVerdict.parse(raw));
  for (const pv of peerVerdicts) {
    if (pv.submissionId !== submissionId) {
      throw new Error(
        `peer-verdict submissionId mismatch: revise got ${submissionId}, record has ${pv.submissionId}`,
      );
    }
    if (pv.agentId === AGENT_ID) {
      throw new Error(`peer-verdict collision: peer record has my own agentId ${AGENT_ID}`);
    }
  }

  // Cross-modal evidence (optional): the demo-video judge's DemoVerdict. Same
  // cross-wire checks as the peers, but it is NOT a peer — it never revises and
  // it carries a different schema, so it is validated + threaded separately.
  let demoVerdict = null;
  if (demoRaw) {
    demoVerdict = DemoVerdict.parse(demoRaw);
    if (demoVerdict.submissionId !== submissionId) {
      throw new Error(
        `cross-modal demo verdict submissionId mismatch: revise got ${submissionId}, record has ${demoVerdict.submissionId}`,
      );
    }
    if (demoVerdict.agentId !== AGENT_IDS.judgeDemo) {
      throw new Error(
        `cross-modal demo verdict agentId mismatch: expected ${AGENT_IDS.judgeDemo}, got ${demoVerdict.agentId}`,
      );
    }
  }

  const claudeTimer = startTimer();
  logger.info({
    event: EVENTS.CLAUDE_REVISE_START,
    submissionId,
    ownScore: ownVerdict.score,
    peerScores: peerVerdicts.map((p) => p.score),
    crossModal: !!demoVerdict, // log signal that demo evidence was delivered
  });
  const { input, usage, model } = await callJudge({
    system: SYSTEM_REVISE,
    user: buildRevisePrompt({ ownVerdict, peerVerdicts, demoVerdict }),
    schema: REVISE_TOOL_SCHEMA,
    toolName: 'revise_verdict',
    toolDescription: 'Hold or revise your round-1 verdict after seeing peer verdicts.',
  });
  logger.info({
    event: EVENTS.CLAUDE_REVISE_COMPLETE,
    submissionId,
    model,
    usage,
    revised: input.revised,
    durationMs: claudeTimer(),
  });

  const revisedVerdict = RevisedVerdict.parse({
    agentId: AGENT_ID,
    submissionId,
    originalVerdictRootHash,
    revised: input.revised,
    ...(input.revised
      ? { revisedScore: input.revisedScore, revisionReasoning: input.revisionReasoning }
      : {}),
    producedAt: new Date().toISOString(),
  });

  const { rootHash: revisionRootHash } = await uploadJSON(revisedVerdict, signer, {
    logger,
    submissionId,
  });

  logger.info({
    event: EVENTS.REVISE_CALL_COMPLETE,
    submissionId,
    rootHash: revisionRootHash,
    revised: revisedVerdict.revised,
    revisedScore: revisedVerdict.revisedScore,
    durationMs: reviseTimer(),
  });

  return { revisionRootHash };
}

module.exports = { judge, revise, AGENT_ID };
