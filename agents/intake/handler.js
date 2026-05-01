const crypto = require('crypto');
const { uploadJSON, downloadJSON } = require('aar-shared/og-storage');
const { fetchRepoMetadata } = require('aar-shared/github');
const { SubmissionRecord, JudgeVerdict, PanelVerdict } = require('aar-shared/schemas');
const { AGENT_IDS, JUDGE_URLS, AGGREGATOR_URL } = require('aar-shared/config');
const { EVENTS, startTimer } = require('aar-shared/logger');

const AGENT_ID = AGENT_IDS.intake;

const JUDGES = [
  { judgeId: AGENT_IDS.judgeTechnical, key: 'technical', url: `${JUDGE_URLS.technical}/judge` },
  { judgeId: AGENT_IDS.judgeOriginality, key: 'originality', url: `${JUDGE_URLS.originality}/judge` },
  { judgeId: AGENT_IDS.judgeSkeptic, key: 'skeptic', url: `${JUDGE_URLS.skeptic}/judge` },
];

async function callOneJudge({ judgeId, url }, { submissionRootHash, submissionId }, logger) {
  const timer = startTimer();
  logger.info({
    event: EVENTS.JUDGE_CALL_START,
    submissionId,
    judgeId,
    rootHash: submissionRootHash,
  });

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ submissionRootHash, submissionId }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`${judgeId} responded ${resp.status}: ${text}`);
  }
  const { verdictRootHash } = await resp.json();
  if (!verdictRootHash) throw new Error(`${judgeId} response missing verdictRootHash`);

  const rawVerdict = await downloadJSON(verdictRootHash, { logger, submissionId });
  const verdict = JudgeVerdict.parse(rawVerdict);
  if (verdict.submissionId !== submissionId) {
    throw new Error(
      `${judgeId} verdict.submissionId mismatch: expected ${submissionId}, got ${verdict.submissionId}`,
    );
  }

  logger.info({
    event: EVENTS.JUDGE_CALL_COMPLETE,
    submissionId,
    judgeId,
    rootHash: verdictRootHash,
    score: verdict.score,
    durationMs: timer(),
  });

  return { judgeId, verdictRootHash, verdict };
}

async function callAggregator(
  { submissionId, submissionRootHash, verdictRootHashes },
  logger,
) {
  const timer = startTimer();
  logger.info({
    event: EVENTS.PANEL_AGGREGATE_START,
    submissionId,
    rootHash: submissionRootHash,
  });
  const resp = await fetch(`${AGGREGATOR_URL}/aggregate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ submissionId, submissionRootHash, verdictRootHashes }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`aggregator responded ${resp.status}: ${text}`);
  }
  const { panelVerdictRootHash, panelVerdict } = await resp.json();
  if (!panelVerdictRootHash || !panelVerdict) {
    throw new Error('aggregator response missing panelVerdictRootHash or panelVerdict');
  }
  PanelVerdict.parse(panelVerdict);
  if (panelVerdict.submissionId !== submissionId) {
    throw new Error(
      `panel verdict submissionId mismatch: expected ${submissionId}, got ${panelVerdict.submissionId}`,
    );
  }
  logger.info({
    event: EVENTS.PANEL_AGGREGATE_COMPLETE,
    submissionId,
    rootHash: panelVerdictRootHash,
    weightedAggregate: panelVerdict.weightedAggregate,
    spread: panelVerdict.spread,
    dissent: panelVerdict.dissent,
    durationMs: timer(),
  });
  return { panelVerdictRootHash, panelVerdict };
}

async function intake({ repoUrl }, { logger, signer }) {
  if (!repoUrl) throw new Error('repoUrl is required');
  if (!signer) throw new Error('intake requires a signer');

  const submissionId = crypto.randomUUID();
  logger.info({ event: EVENTS.SUBMISSION_STARTED, submissionId, repoUrl });
  logger.info({ event: EVENTS.SUBMISSION_RECEIVED, submissionId, repoUrl });

  const ghTimer = startTimer();
  logger.info({ event: EVENTS.GITHUB_FETCH_START, submissionId, repoUrl });
  const meta = await fetchRepoMetadata(repoUrl);
  logger.info({
    event: EVENTS.GITHUB_FETCH_COMPLETE,
    submissionId,
    repoName: meta.repoName,
    readmeBytes: meta.readme.length,
    treeEntries: meta.fileTree.length,
    durationMs: ghTimer(),
  });

  const submission = SubmissionRecord.parse({
    submissionId,
    repoUrl,
    repoName: meta.repoName,
    repoDescription: meta.repoDescription,
    readme: meta.readme,
    fileTree: meta.fileTree,
    fetchedAt: new Date().toISOString(),
  });

  const { rootHash: submissionRootHash } =
    await uploadJSON(submission, signer, { logger, submissionId });

  const settled = await Promise.allSettled(
    JUDGES.map((j) => callOneJudge(j, { submissionRootHash, submissionId }, logger)),
  );

  const verdicts = [];
  const failures = [];
  const verdictRootHashes = {};
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    const { judgeId, key } = JUDGES[i];
    if (result.status === 'fulfilled') {
      verdicts.push({
        judgeId,
        verdictRootHash: result.value.verdictRootHash,
        verdict: result.value.verdict,
      });
      verdictRootHashes[key] = result.value.verdictRootHash;
    } else {
      const errMsg = result.reason?.message || String(result.reason);
      logger.error({ event: EVENTS.ERROR, submissionId, judgeId, error: errMsg });
      failures.push({ judgeId, error: errMsg });
    }
  }

  let panelVerdictRootHash = null;
  let panelVerdict = null;
  if (verdicts.length === JUDGES.length) {
    try {
      const result = await callAggregator(
        { submissionId, submissionRootHash, verdictRootHashes },
        logger,
      );
      panelVerdictRootHash = result.panelVerdictRootHash;
      panelVerdict = result.panelVerdict;
    } catch (err) {
      logger.error({
        event: EVENTS.ERROR,
        submissionId,
        error: `aggregator call failed: ${err.message}`,
      });
      failures.push({ judgeId: AGENT_IDS.aggregator, error: err.message });
    }
  } else {
    logger.warn({
      event: EVENTS.ERROR,
      submissionId,
      error: `skipping aggregator: only ${verdicts.length}/${JUDGES.length} round-1 verdicts succeeded`,
    });
  }

  return {
    submissionId,
    submissionRootHash,
    verdicts,
    failures,
    panelVerdictRootHash,
    panelVerdict,
  };
}

module.exports = { intake, AGENT_ID };
