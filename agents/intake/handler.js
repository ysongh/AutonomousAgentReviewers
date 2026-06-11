const crypto = require('crypto');
const fs = require('fs');
const { uploadJSON, downloadJSON } = require('aar-shared/og-storage');
const { uploadVideo } = require('aar-shared/filecoin-storage');
const { fetchRepoMetadata } = require('aar-shared/github');
const { SubmissionRecord, JudgeVerdict, PanelVerdict, DemoVerdict } = require('aar-shared/schemas');
const { AGENT_IDS, JUDGE_URLS, AGGREGATOR_URL, JUDGE_DEMO_URL, SUBMIT_SLOT_MS } = require('aar-shared/config');
const { EVENTS, startTimer } = require('aar-shared/logger');
const { transcodeVideo } = require('./transcode');

const AGENT_ID = AGENT_IDS.intake;

const JUDGES = [
  { judgeId: AGENT_IDS.judgeTechnical, key: 'technical', url: `${JUDGE_URLS.technical}/judge` },
  { judgeId: AGENT_IDS.judgeOriginality, key: 'originality', url: `${JUDGE_URLS.originality}/judge` },
  { judgeId: AGENT_IDS.judgeSkeptic, key: 'skeptic', url: `${JUDGE_URLS.skeptic}/judge` },
];

async function callOneJudge(
  { judgeId, url },
  { submissionRootHash, submissionId, submitDelayMs },
  logger,
) {
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
    // submitDelayMs is the coordinated on-chain slot offset (see SUBMIT_SLOT_MS)
    // that serializes the three judges' concurrent flow.submit calls.
    body: JSON.stringify({ submissionRootHash, submissionId, submitDelayMs }),
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
  { submissionId, submissionRootHash, verdictRootHashes, demoVerdictRootHash },
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
    // demoVerdictRootHash is OPTIONAL — present only when a demo review
    // succeeded. Its absence puts the aggregator in 3-judge mode (the demo
    // judge never blocks the panel).
    body: JSON.stringify({
      submissionId,
      submissionRootHash,
      verdictRootHashes,
      ...(demoVerdictRootHash ? { demoVerdictRootHash } : {}),
    }),
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

// Transcode (ONE attempt) then upload (ONE internal retry) the demo video.
// Returns the Filecoin upload result, or THROWS on persistent failure — the
// caller catches and degrades the submission to no-video. The transcoded temp
// file is cleaned here regardless of outcome (the input is cleaned by index.js).
async function prepareVideo(videoPath, submissionId, logger) {
  const transTimer = startTimer();
  logger.info({ event: EVENTS.VIDEO_TRANSCODE_START, submissionId });
  let transcoded;
  try {
    transcoded = await transcodeVideo(videoPath); // ONE attempt — no retry
  } catch (err) {
    throw new Error(`transcode failed: ${err.message}`);
  }
  logger.info({
    event: EVENTS.VIDEO_TRANSCODE_COMPLETE,
    submissionId,
    inputBytes: transcoded.inputBytes,
    outputBytes: transcoded.outputBytes,
    durationMs: transTimer(),
  });

  try {
    const fcTimer = startTimer();
    logger.info({ event: EVENTS.FILECOIN_UPLOAD_START, submissionId });
    const r = await uploadVideo(transcoded.outputPath, { logger, submissionId }); // ONE internal retry
    logger.info({
      event: EVENTS.FILECOIN_UPLOAD_COMPLETE,
      submissionId,
      pieceCid: r.pieceCid,
      sizeBytes: r.sizeBytes,
      uploadMs: r.uploadMs,
      attempts: r.attempts,
      durationMs: fcTimer(),
    });
    return r;
  } finally {
    fs.rmSync(transcoded.outputPath, { force: true });
  }
}

async function intake({ repoUrl, videoPath }, { logger, signer }) {
  if (!repoUrl) throw new Error('repoUrl is required');
  if (!signer) throw new Error('intake requires a signer');

  const submissionId = crypto.randomUUID();
  logger.info({ event: EVENTS.SUBMISSION_STARTED, submissionId, repoUrl });
  logger.info({ event: EVENTS.SUBMISSION_RECEIVED, submissionId, repoUrl, hasVideo: !!videoPath });

  // Kick off transcode + Filecoin upload IMMEDIATELY (before the GitHub fetch)
  // so its latency overlaps the repo fetch. We still AWAIT it just before
  // uploading the SubmissionRecord — the record is immutable once on 0G, so both
  // video fields must be set before that write.
  let videoPromise = null;
  if (videoPath) {
    videoPromise = prepareVideo(videoPath, submissionId, logger);
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

  // Await the video here so the record is immutable with both video fields set.
  // Null for video-less submissions — the pipeline then behaves byte-for-byte as
  // before. VIDEO NEVER BLOCKS THE PANEL: if transcode failed or both upload
  // attempts failed, we degrade to no-video (null fields on the record) and
  // surface demoVideoError on the response only. The submission still produces a
  // full 3-judge panel.
  let video = null;
  let demoVideoError = null;
  if (videoPromise) {
    try {
      video = await videoPromise;
    } catch (err) {
      logger.warn({ event: EVENTS.VIDEO_DEGRADED, submissionId, error: err.message });
      demoVideoError = err.message;
      video = null;
    }
  }

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

  // Assign each judge a distinct on-chain submit slot (index * SUBMIT_SLOT_MS) so
  // only one flow.submit is in flight at a time — the Claude calls still run
  // concurrently; only the on-chain write is staggered.
  const settled = await Promise.allSettled(
    JUDGES.map((j, i) =>
      callOneJudge(
        j,
        { submissionRootHash, submissionId, submitDelayMs: i * SUBMIT_SLOT_MS },
        logger,
      ),
    ),
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

  // DEMO REVIEW — runs AFTER round 1 and BEFORE round 2 so the demo evidence can
  // feed the text judges' deliberation (Phase 3 re-sequencing). Only when the
  // submission actually carries a stored video. NEVER blocks the panel: any
  // failure leaves demoVerdictRootHash null (the aggregator stays in 3-judge
  // mode) and surfaces demoVerdictError on the response. Runs even when round 1
  // is short — the demo verdict is still a useful artifact to return.
  let demoVerdict;
  let demoVerdictRootHash = null;
  let demoVerdictError = null;
  if (video) {
    try {
      const r = await callDemoJudge(
        { submissionId, submissionRootHash, videoPieceCid: video.pieceCid },
        logger,
      );
      demoVerdict = r.demoVerdict;
      demoVerdictRootHash = r.demoVerdictRootHash;
    } catch (err) {
      logger.error({
        event: EVENTS.ERROR,
        submissionId,
        error: `demo judge failed: ${err.message}`,
      });
      demoVerdict = null;
      demoVerdictError = err.message;
    }
  }

  let panelVerdictRootHash = null;
  let panelVerdict = null;
  if (verdicts.length === JUDGES.length) {
    try {
      const result = await callAggregator(
        { submissionId, submissionRootHash, verdictRootHashes, demoVerdictRootHash },
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

  // Demo fields appear on the response ONLY when a video was submitted (with or
  // without a video, video-less submissions stay byte-for-byte unchanged):
  //   - degraded (transcode/upload failed): demoVerdict null + demoVideoError.
  //   - review failed: demoVerdict null + demoVerdictError.
  //   - success: demoVerdict + demoVerdictRootHash.
  if (videoPath) {
    response.demoVerdict = demoVerdict ?? null;
    response.demoVerdictRootHash = demoVerdictRootHash;
    if (demoVideoError) response.demoVideoError = demoVideoError;
    if (demoVerdictError) response.demoVerdictError = demoVerdictError;
  }

  return response;
}

module.exports = { intake, AGENT_ID };
