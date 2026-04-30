const { uploadJSON, downloadJSON } = require('aar-shared/og-storage');
const { callJudge } = require('aar-shared/claude');
const { JudgeVerdict, RevisedVerdict, PanelVerdict } = require('aar-shared/schemas');
const { AGENT_IDS, JUDGE_REVISE_URLS } = require('aar-shared/config');
const { EVENTS, startTimer } = require('aar-shared/logger');

const AGENT_ID = AGENT_IDS.aggregator;

// Weighting rationale (see CLAUDE.md): technical gets the largest share
// because code quality is the most empirically grounded axis. Originality
// is partially blind without web access; skeptic is intentionally biased
// low. Equal originality/skeptic weight balances the two soft axes.
const WEIGHTS = { technical: 0.4, originality: 0.3, skeptic: 0.3 };
const DISSENT_THRESHOLD = 2;

const JUDGE_KEYS = ['technical', 'originality', 'skeptic'];
const JUDGE_AGENT_ID = {
  technical: AGENT_IDS.judgeTechnical,
  originality: AGENT_IDS.judgeOriginality,
  skeptic: AGENT_IDS.judgeSkeptic,
};

const DISSENT_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description:
        '1-2 sentences neutrally describing the disagreement among the panel: where they split and why.',
    },
  },
  required: ['summary'],
};

async function downloadRound1(verdictRootHashes, submissionId, logger) {
  const settled = await Promise.allSettled(
    JUDGE_KEYS.map((key) =>
      downloadJSON(verdictRootHashes[key], { logger, submissionId }).then((raw) => {
        const verdict = JudgeVerdict.parse(raw);
        if (verdict.submissionId !== submissionId) {
          throw new Error(
            `round-1 ${key} verdict submissionId mismatch: aggregator got ${submissionId}, record has ${verdict.submissionId}`,
          );
        }
        if (verdict.agentId !== JUDGE_AGENT_ID[key]) {
          throw new Error(
            `round-1 ${key} verdict agentId mismatch: expected ${JUDGE_AGENT_ID[key]}, got ${verdict.agentId}`,
          );
        }
        return { key, verdict, verdictRootHash: verdictRootHashes[key] };
      }),
    ),
  );

  const errors = [];
  const verdicts = {};
  for (let i = 0; i < settled.length; i++) {
    const key = JUDGE_KEYS[i];
    const r = settled[i];
    if (r.status === 'fulfilled') {
      verdicts[key] = r.value;
    } else {
      errors.push({ key, error: r.reason?.message || String(r.reason) });
    }
  }
  if (errors.length > 0) {
    const msg = errors.map((e) => `${e.key}: ${e.error}`).join('; ');
    throw new Error(`round-1 verdict download failed — ${msg}`);
  }
  return verdicts;
}

async function callRevise(judgeKey, body, submissionId, logger) {
  const url = JUDGE_REVISE_URLS[judgeKey];
  const timer = startTimer();
  logger.info({
    event: EVENTS.REVISE_CALL_START,
    submissionId,
    judgeId: JUDGE_AGENT_ID[judgeKey],
    rootHash: body.originalVerdictRootHash,
  });
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`${JUDGE_AGENT_ID[judgeKey]} /revise responded ${resp.status}: ${text}`);
  }
  const { revisionRootHash } = await resp.json();
  if (!revisionRootHash) {
    throw new Error(`${JUDGE_AGENT_ID[judgeKey]} /revise response missing revisionRootHash`);
  }
  const rawRevised = await downloadJSON(revisionRootHash, { logger, submissionId });
  const revised = RevisedVerdict.parse(rawRevised);
  if (revised.submissionId !== submissionId) {
    throw new Error(
      `${JUDGE_AGENT_ID[judgeKey]} revision submissionId mismatch: expected ${submissionId}, got ${revised.submissionId}`,
    );
  }
  if (revised.agentId !== JUDGE_AGENT_ID[judgeKey]) {
    throw new Error(
      `${JUDGE_AGENT_ID[judgeKey]} revision agentId mismatch: expected ${JUDGE_AGENT_ID[judgeKey]}, got ${revised.agentId}`,
    );
  }
  if (revised.originalVerdictRootHash !== body.originalVerdictRootHash) {
    throw new Error(
      `${JUDGE_AGENT_ID[judgeKey]} revision originalVerdictRootHash mismatch`,
    );
  }
  logger.info({
    event: EVENTS.REVISE_CALL_COMPLETE,
    submissionId,
    judgeId: JUDGE_AGENT_ID[judgeKey],
    rootHash: revisionRootHash,
    revised: revised.revised,
    revisedScore: revised.revisedScore,
    durationMs: timer(),
  });
  return { judgeKey, revisionRootHash, revised };
}

async function runDeliberation(round1, submissionId, logger) {
  const settled = await Promise.allSettled(
    JUDGE_KEYS.map((key) => {
      const peerKeys = JUDGE_KEYS.filter((k) => k !== key);
      const body = {
        submissionId,
        originalVerdictRootHash: round1[key].verdictRootHash,
        peerVerdictRootHashes: peerKeys.map((pk) => round1[pk].verdictRootHash),
      };
      return callRevise(key, body, submissionId, logger);
    }),
  );

  const revisions = {};
  for (let i = 0; i < settled.length; i++) {
    const key = JUDGE_KEYS[i];
    const r = settled[i];
    if (r.status === 'fulfilled') {
      revisions[key] = r.value;
      if (!r.value.revised.revised) {
        logger.info({
          event: EVENTS.JUDGE_ABSTAIN_BY_CHOICE,
          submissionId,
          judgeId: JUDGE_AGENT_ID[key],
        });
      }
    } else {
      const errMsg = r.reason?.message || String(r.reason);
      logger.warn({
        event: EVENTS.JUDGE_ABSTAIN_DUE_TO_FAILURE,
        submissionId,
        judgeId: JUDGE_AGENT_ID[key],
        error: errMsg,
      });
      // Synthetic in-memory abstention. revisionRootHash stays null in the
      // panel — the failure is recorded only in the log, not on-chain.
      revisions[key] = {
        judgeKey: key,
        revisionRootHash: null,
        revised: {
          agentId: JUDGE_AGENT_ID[key],
          submissionId,
          originalVerdictRootHash: round1[key].verdictRootHash,
          revised: false,
          producedAt: new Date().toISOString(),
        },
        failureReason: errMsg,
      };
    }
  }
  return revisions;
}

function computeFinalScores(round1, revisions) {
  const finalScores = {};
  for (const key of JUDGE_KEYS) {
    const r = revisions[key].revised;
    finalScores[key] = r.revised ? r.revisedScore : round1[key].verdict.score;
  }
  return finalScores;
}

function computeAggregate(finalScores) {
  return (
    finalScores.technical * WEIGHTS.technical +
    finalScores.originality * WEIGHTS.originality +
    finalScores.skeptic * WEIGHTS.skeptic
  );
}

function computeSpread(finalScores) {
  const vals = Object.values(finalScores);
  return Math.max(...vals) - Math.min(...vals);
}

async function summarizeDissent({ round1, revisions, finalScores }, submissionId, logger) {
  const lines = JUDGE_KEYS.map((key) => {
    const r1 = round1[key].verdict;
    const r2 = revisions[key].revised;
    const finalScore = finalScores[key];
    const stance = r2.revised
      ? `revised to ${r2.revisedScore} (${r2.revisionReasoning})`
      : `held at ${r1.score}`;
    return `${JUDGE_AGENT_ID[key]}: round-1 ${r1.score}, ${stance}, final ${finalScore}. Reasoning: ${r1.reasoning}`;
  });

  const system = `You summarize disagreements among AI judges on a hackathon submission. Be neutral and specific. Describe where the panel split and the substantive reason for the gap. 1-2 sentences. Do NOT recommend who is right.`;
  const user = `Final scores: technical=${finalScores.technical}, originality=${finalScores.originality}, skeptic=${finalScores.skeptic}.

Per-judge stances:
${lines.join('\n')}

Call summarize_dissent with a 1-2 sentence neutral description of the split.`;

  const claudeTimer = startTimer();
  logger.info({ event: EVENTS.CLAUDE_START, submissionId, purpose: 'dissent-summary' });
  const { input, model, usage } = await callJudge({
    system,
    user,
    schema: DISSENT_TOOL_SCHEMA,
    toolName: 'summarize_dissent',
    toolDescription: 'Return a short neutral summary of how the judges disagreed.',
    maxTokens: 512,
  });
  logger.info({
    event: EVENTS.CLAUDE_COMPLETE,
    submissionId,
    purpose: 'dissent-summary',
    model,
    usage,
    durationMs: claudeTimer(),
  });
  return input.summary;
}

async function uploadPanelWithRetry(panelVerdict, signer, submissionId, logger) {
  try {
    return await uploadJSON(panelVerdict, signer, { logger, submissionId });
  } catch (err) {
    logger.warn({
      event: EVENTS.ERROR,
      submissionId,
      error: `panel upload failed, retrying once: ${err.message}`,
    });
    return await uploadJSON(panelVerdict, signer, { logger, submissionId });
  }
}

async function aggregate(
  { submissionId, submissionRootHash, verdictRootHashes },
  { logger, signer },
) {
  if (!submissionId) throw new Error('submissionId is required');
  if (!submissionRootHash) throw new Error('submissionRootHash is required');
  if (
    !verdictRootHashes ||
    !verdictRootHashes.technical ||
    !verdictRootHashes.originality ||
    !verdictRootHashes.skeptic
  ) {
    throw new Error('verdictRootHashes must include technical, originality, skeptic');
  }
  if (!signer) throw new Error('aggregator handler requires a signer');

  const aggregateTimer = startTimer();
  logger.info({
    event: EVENTS.PANEL_AGGREGATE_START,
    submissionId,
    rootHash: submissionRootHash,
  });

  const round1 = await downloadRound1(verdictRootHashes, submissionId, logger);
  const revisions = await runDeliberation(round1, submissionId, logger);

  const finalScores = computeFinalScores(round1, revisions);
  const weightedAggregate = computeAggregate(finalScores);
  const spread = computeSpread(finalScores);
  const dissent = spread >= DISSENT_THRESHOLD;

  let dissentSummary;
  if (dissent) {
    dissentSummary = await summarizeDissent(
      { round1, revisions, finalScores },
      submissionId,
      logger,
    );
  } else {
    dissentSummary = `Panel converged at score ${Math.round(weightedAggregate)}.`;
  }

  const panelVerdict = PanelVerdict.parse({
    submissionId,
    submissionRootHash,
    round1Verdicts: JUDGE_KEYS.map((key) => ({
      agentId: round1[key].verdict.agentId,
      score: round1[key].verdict.score,
      reasoning: round1[key].verdict.reasoning,
      evidence: round1[key].verdict.evidence,
      verdictRootHash: round1[key].verdictRootHash,
    })),
    round2Revisions: JUDGE_KEYS.map((key) => {
      const r = revisions[key].revised;
      return {
        agentId: r.agentId,
        revised: r.revised,
        ...(r.revised
          ? { revisedScore: r.revisedScore, revisionReasoning: r.revisionReasoning }
          : {}),
        revisionRootHash: revisions[key].revisionRootHash,
      };
    }),
    finalScores,
    weightedAggregate,
    spread,
    dissent,
    dissentSummary,
    producedAt: new Date().toISOString(),
  });

  const { rootHash: panelVerdictRootHash } = await uploadPanelWithRetry(
    panelVerdict,
    signer,
    submissionId,
    logger,
  );

  logger.info({
    event: EVENTS.PANEL_AGGREGATE_COMPLETE,
    submissionId,
    rootHash: panelVerdictRootHash,
    weightedAggregate,
    spread,
    dissent,
    durationMs: aggregateTimer(),
  });

  return { panelVerdictRootHash, panelVerdict };
}

module.exports = { aggregate, AGENT_ID };
