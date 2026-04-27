const crypto = require('crypto');
const { uploadJSON, downloadJSON } = require('aar-shared/og-storage');
const { fetchRepoMetadata } = require('aar-shared/github');
const { SubmissionRecord, JudgeVerdict } = require('aar-shared/schemas');
const { AGENT_IDS, JUDGE_URLS } = require('aar-shared/config');
const { EVENTS, startTimer } = require('aar-shared/logger');

const AGENT_ID = AGENT_IDS.intake;

const JUDGES = [
  { judgeId: AGENT_IDS.judgeTechnical, url: `${JUDGE_URLS.technical}/judge` },
  { judgeId: AGENT_IDS.judgeOriginality, url: `${JUDGE_URLS.originality}/judge` },
  { judgeId: AGENT_IDS.judgeSkeptic, url: `${JUDGE_URLS.skeptic}/judge` },
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

async function intake({ repoUrl }, logger) {
  if (!repoUrl) throw new Error('repoUrl is required');

  const submissionId = crypto.randomUUID();
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
    await uploadJSON(submission, { logger, submissionId });

  const settled = await Promise.allSettled(
    JUDGES.map((j) => callOneJudge(j, { submissionRootHash, submissionId }, logger)),
  );

  const verdicts = [];
  const failures = [];
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    const { judgeId } = JUDGES[i];
    if (result.status === 'fulfilled') {
      verdicts.push({
        judgeId,
        verdictRootHash: result.value.verdictRootHash,
        verdict: result.value.verdict,
      });
    } else {
      const errMsg = result.reason?.message || String(result.reason);
      logger.error({ event: EVENTS.ERROR, submissionId, judgeId, error: errMsg });
      failures.push({ judgeId, error: errMsg });
    }
  }

  return { submissionId, submissionRootHash, verdicts, failures };
}

module.exports = { intake, AGENT_ID };
