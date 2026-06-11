const crypto = require('crypto');
const { uploadJSON, downloadJSON } = require('aar-shared/og-storage');
const { uploadVideo } = require('aar-shared/filecoin-storage');
const { fetchRepoMetadata } = require('aar-shared/github');
const { SubmissionRecord, JudgeVerdict, PanelVerdict, DemoVerdict } = require('aar-shared/schemas');
const { AGENT_IDS, JUDGE_URLS, AGGREGATOR_URL, JUDGE_DEMO_URL } = require('aar-shared/config');
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

// Calls judge-demo /review and returns the validated DemoVerdict + its root
// hash. Used only when the submission carries a video. The demo judge NEVER
// blocks the panel — the caller wraps this in try/catch and degrades to
// demoVerdict:null on any failure.
async function callDemoJudge({ submissionId, submissionRootHash, videoPieceCid }, logger) {
  const timer = startTimer();
  logger.info({ event: EVENTS.DEMO_REVIEW_START, submissionId, rootHash: submissionRootHash });

  const resp = await fetch(`${JUDGE_DEMO_URL}/review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ submissionRootHash, submissionId }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`judge-demo responded ${resp.status}: ${text}`);
  }
  const { demoVerdictRootHash } = await resp.json();
  if (!demoVerdictRootHash) throw new Error('judge-demo response missing demoVerdictRootHash');

  const rawVerdict = await downloadJSON(demoVerdictRootHash, { logger, submissionId });
  const demoVerdict = DemoVerdict.parse(rawVerdict);
  if (demoVerdict.submissionId !== submissionId) {
    throw new Error(
      `demo verdict submissionId mismatch: expected ${submissionId}, got ${demoVerdict.submissionId}`,
    );
  }
  if (demoVerdict.videoPieceCid !== videoPieceCid) {
    throw new Error(
      `demo verdict videoPieceCid mismatch: expected ${videoPieceCid}, got ${demoVerdict.videoPieceCid}`,
    );
  }

  logger.info({
    event: EVENTS.DEMO_REVIEW_COMPLETE,
    submissionId,
    rootHash: demoVerdictRootHash,
    score: demoVerdict.score,
    durationMs: timer(),
  });
  return { demoVerdictRootHash, demoVerdict };
}

async function intake({ repoUrl, videoPath }, { logger, signer }) {
  if (!repoUrl) throw new Error('repoUrl is required');
  if (!signer) throw new Error('intake requires a signer');

  const submissionId = crypto.randomUUID();
  logger.info({ event: EVENTS.SUBMISSION_STARTED, submissionId, repoUrl });
  logger.info({ event: EVENTS.SUBMISSION_RECEIVED, submissionId, repoUrl, hasVideo: !!videoPath });

  // Kick off the Filecoin Warm Storage upload IMMEDIATELY (before the GitHub
  // fetch) so its ~90-150s latency overlaps the repo fetch. We still AWAIT it
  // just before uploading the SubmissionRecord — the record is immutable once
  // on 0G, so both video fields must be set before that write. uploadMs is
  // logged to measure the real cost of putting Filecoin on the submit path.
  let videoUploadPromise = null;
  if (videoPath) {
    const fcTimer = startTimer();
    logger.info({ event: EVENTS.FILECOIN_UPLOAD_START, submissionId });
    videoUploadPromise = uploadVideo(videoPath, { logger }).then((r) => {
      logger.info({
        event: EVENTS.FILECOIN_UPLOAD_COMPLETE,
        submissionId,
        pieceCid: r.pieceCid,
        sizeBytes: r.sizeBytes,
        uploadMs: r.uploadMs,
        durationMs: fcTimer(),
      });
      return r;
    });
  }

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

  // Await the Filecoin upload here so the record is immutable with both video
  // fields set. Null for video-less submissions — the pipeline then behaves
  // byte-for-byte as before.
  const video = videoUploadPromise ? await videoUploadPromise : null;

  const submission = SubmissionRecord.parse({
    submissionId,
    repoUrl,
    repoName: meta.repoName,
    repoDescription: meta.repoDescription,
    readme: meta.readme,
    fileTree: meta.fileTree,
    fetchedAt: new Date().toISOString(),
    demoVideoPieceCid: video ? video.pieceCid : null,
    demoVideoRetrievalUrl: video ? video.retrievalUrl : null,
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

  const response = {
    submissionId,
    submissionRootHash,
    verdicts,
    failures,
    panelVerdictRootHash,
    panelVerdict,
  };

  // Demo judge runs AFTER the panel and NEVER blocks it. Only when the
  // submission carried a video. Any failure degrades to demoVerdict:null +
  // demoVerdictError — the panel result above is untouched. Video-less
  // submissions get no demo fields at all (byte-for-byte unchanged response).
  if (video) {
    try {
      const { demoVerdictRootHash, demoVerdict } = await callDemoJudge(
        { submissionId, submissionRootHash, videoPieceCid: video.pieceCid },
        logger,
      );
      response.demoVerdict = demoVerdict;
      response.demoVerdictRootHash = demoVerdictRootHash;
    } catch (err) {
      logger.error({
        event: EVENTS.ERROR,
        submissionId,
        error: `demo judge failed: ${err.message}`,
      });
      response.demoVerdict = null;
      response.demoVerdictError = err.message;
    }
  }

  return response;
}

module.exports = { intake, AGENT_ID };
