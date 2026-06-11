const { uploadJSON, downloadJSON } = require('aar-shared/og-storage');
const { callJudge } = require('aar-shared/claude');
const { JudgeVerdict, RevisedVerdict, PanelVerdict, DemoVerdict } = require('aar-shared/schemas');
const { AGENT_IDS, JUDGE_REVISE_URLS, SUBMIT_SLOT_MS } = require('aar-shared/config');
const { EVENTS, startTimer } = require('aar-shared/logger');

const AGENT_ID = AGENT_IDS.aggregator;

// Weighting rationale (see CLAUDE.md): technical gets the largest share because
// code quality is the most empirically grounded axis. Originality is partially
// blind without web access; skeptic is intentionally biased low. Equal
// originality/skeptic weight balances the two soft axes.
//
// CONDITIONAL WEIGHTS (Phase 3): when the demo judge participated, the three
// text weights are scaled down to make room for a 0.15 demo share; without a
// demo, the original 0.4/0.3/0.3 is used UNCHANGED so a no-video run is
// byte-for-byte identical to Phase 1/2. The actual weights used are recorded in
// the PanelVerdict.weights field, making the artifact self-describing.
const WEIGHTS_NO_DEMO = { technical: 0.4, originality: 0.3, skeptic: 0.3 };
const WEIGHTS_WITH_DEMO = { technical: 0.35, originality: 0.25, skeptic: 0.25, demo: 0.15 };
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

// Download + validate the DemoVerdict the demo judge produced this run. The
// demo judge is evidence-provider-only: this verdict's score is FINAL (no
// /revise), and its claims_check flows into the three text judges' round-2
// prompts as cross-modal evidence. Cross-wire checks mirror the round-1 ones.
async function downloadDemoVerdict(demoVerdictRootHash, submissionId, logger) {
  const raw = await downloadJSON(demoVerdictRootHash, { logger, submissionId });
  const demo = DemoVerdict.parse(raw);
  if (demo.submissionId !== submissionId) {
    throw new Error(
      `demo verdict submissionId mismatch: aggregator got ${submissionId}, record has ${demo.submissionId}`,
    );
  }
  if (demo.agentId !== AGENT_IDS.judgeDemo) {
    throw new Error(
      `demo verdict agentId mismatch: expected ${AGENT_IDS.judgeDemo}, got ${demo.agentId}`,
    );
  }
  return demo;
}

// "N shown / M asserted-only / K contradicted" — the compact summary stored on
// the panel's judge-demo round1Verdicts entry in place of the full claims_check
// (whose timestamped-object shape doesn't match the text judges' string[]).
function claimsCheckSummary(demo) {
  const counts = { shown: 0, 'asserted-only': 0, contradicted: 0 };
  for (const c of demo.claims_check) {
    if (counts[c.verdict] !== undefined) counts[c.verdict] += 1;
  }
  return `${counts.shown} shown / ${counts['asserted-only']} asserted-only / ${counts.contradicted} contradicted`;
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

async function runDeliberation(round1, submissionId, logger, simulateFailure, demoVerdictRootHash) {
  const settled = await Promise.allSettled(
    JUDGE_KEYS.map((key, i) => {
      // Debug escape hatch: --simulate-revise-failure=<judge-agent-id>
      // makes the targeted judge's /revise reject before any HTTP call,
      // so the existing rejected branch below produces the same synthetic
      // abstention a real failure would. Tracked in TODO.md for removal.
      if (simulateFailure && JUDGE_AGENT_ID[key] === simulateFailure) {
        return Promise.reject(
          new Error(`simulated revise failure for ${JUDGE_AGENT_ID[key]} (--simulate-revise-failure)`),
        );
      }
      const peerKeys = JUDGE_KEYS.filter((k) => k !== key);
      const body = {
        submissionId,
        originalVerdictRootHash: round1[key].verdictRootHash,
        peerVerdictRootHashes: peerKeys.map((pk) => round1[pk].verdictRootHash),
        // Coordinated on-chain submit slot — same mechanism as round 1, so the
        // three concurrent revise uploads don't race the flow contract.
        submitDelayMs: i * SUBMIT_SLOT_MS,
        // CROSS-MODAL: the demo verdict travels as a SEPARATE field, NOT inside
        // peerVerdictRootHashes — a DemoVerdict has a different schema than a
        // JudgeVerdict, so the judge downloads + validates it independently.
        // Only the three TEXT judges revise; the demo judge gets no /revise.
        ...(demoVerdictRootHash ? { demoVerdictRootHash } : {}),
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

// finalScores for the three text judges come from round 2 (revised score if they
// revised, else their round-1 score). The demo judge does NOT revise, so its
// final score is simply its round-1 DemoVerdict score — added only when a demo
// participated.
function computeFinalScores(round1, revisions, demo) {
  const finalScores = {};
  for (const key of JUDGE_KEYS) {
    const r = revisions[key].revised;
    finalScores[key] = r.revised ? r.revisedScore : round1[key].verdict.score;
  }
  if (demo) finalScores.demo = demo.score;
  return finalScores;
}

// Weighted aggregate over exactly the keys present in `weights` (3 text keys, or
// 3 text + demo). finalScores always carries a matching value for each key.
function computeAggregate(finalScores, weights) {
  return Object.keys(weights).reduce((sum, k) => sum + finalScores[k] * weights[k], 0);
}

function computeSpread(finalScores) {
  const vals = Object.values(finalScores);
  return Math.max(...vals) - Math.min(...vals);
}

async function summarizeDissent({ round1, revisions, finalScores, demo }, submissionId, logger) {
  const lines = JUDGE_KEYS.map((key) => {
    const r1 = round1[key].verdict;
    const r2 = revisions[key].revised;
    const finalScore = finalScores[key];
    const stance = r2.revised
      ? `revised to ${r2.revisedScore} (${r2.revisionReasoning})`
      : `held at ${r1.score}`;
    return `${JUDGE_AGENT_ID[key]}: round-1 ${r1.score}, ${stance}, final ${finalScore}. Reasoning: ${r1.reasoning}`;
  });
  // The demo judge is evidence-provider-only (no revision), but its final score
  // is part of the spread, so include it in the dissent summary when present.
  if (demo) {
    lines.push(
      `${AGENT_IDS.judgeDemo}: final ${demo.score} (no revision — demo verdicts are final). Reasoning: ${demo.reasoning}`,
    );
  }

  const scoreList = JUDGE_KEYS.map((k) => `${k}=${finalScores[k]}`)
    .concat(demo ? [`demo=${finalScores.demo}`] : [])
    .join(', ');

  const system = `You summarize disagreements among AI judges on a hackathon submission. Be neutral and specific. Describe where the panel split and the substantive reason for the gap. 1-2 sentences. Do NOT recommend who is right.`;
  const user = `Final scores: ${scoreList}.

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
  { submissionId, submissionRootHash, verdictRootHashes, demoVerdictRootHash },
  { logger, signer, simulateFailure },
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

  // Download the round-1 text verdicts and (if present) the demo verdict in
  // parallel. A missing/invalid demo verdict is a hard error here — intake only
  // passes demoVerdictRootHash when its own download+validate already succeeded,
  // so a failure at this point is genuinely abnormal. (Intake degrades to
  // 3-judge mode by simply NOT passing demoVerdictRootHash.)
  const [round1, demo] = await Promise.all([
    downloadRound1(verdictRootHashes, submissionId, logger),
    demoVerdictRootHash
      ? downloadDemoVerdict(demoVerdictRootHash, submissionId, logger)
      : Promise.resolve(null),
  ]);

  const revisions = await runDeliberation(
    round1,
    submissionId,
    logger,
    simulateFailure,
    demoVerdictRootHash,
  );

  const weights = demo ? WEIGHTS_WITH_DEMO : WEIGHTS_NO_DEMO;
  const finalScores = computeFinalScores(round1, revisions, demo);
  const weightedAggregate = computeAggregate(finalScores, weights);
  const spread = computeSpread(finalScores); // across all final scores incl. demo
  const dissent = spread >= DISSENT_THRESHOLD;

  let dissentSummary;
  if (dissent) {
    dissentSummary = await summarizeDissent(
      { round1, revisions, finalScores, demo },
      submissionId,
      logger,
    );
  } else {
    dissentSummary = `Panel converged at score ${Math.round(weightedAggregate)}.`;
  }

  const panelVerdict = PanelVerdict.parse({
    submissionId,
    submissionRootHash,
    // round1Verdicts: the three text judges, plus a judge-demo entry when a demo
    // participated. The demo entry carries claimsCheckSummary instead of the
    // text judges' evidence[] (different shapes). round2Revisions stays the three
    // text judges ONLY — the demo judge never revises.
    round1Verdicts: [
      ...JUDGE_KEYS.map((key) => ({
        agentId: round1[key].verdict.agentId,
        score: round1[key].verdict.score,
        reasoning: round1[key].verdict.reasoning,
        evidence: round1[key].verdict.evidence,
        verdictRootHash: round1[key].verdictRootHash,
      })),
      ...(demo
        ? [
            {
              agentId: demo.agentId,
              score: demo.score,
              reasoning: demo.reasoning,
              claimsCheckSummary: claimsCheckSummary(demo),
              verdictRootHash: demoVerdictRootHash,
            },
          ]
        : []),
    ],
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
    weights,
    ...(demo ? { demoVerdictRootHash } : {}),
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
