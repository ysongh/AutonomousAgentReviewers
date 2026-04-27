const crypto = require('crypto');
const { uploadJSON, downloadJSON } = require('aar-shared/og-storage');
const { fetchRepoMetadata } = require('aar-shared/github');
const { SubmissionRecord, JudgeVerdict } = require('aar-shared/schemas');
const { PORTS, AGENT_IDS } = require('aar-shared/config');
const { EVENTS, startTimer } = require('aar-shared/logger');

const AGENT_ID = AGENT_IDS.intake;
const JUDGE_URL = `http://127.0.0.1:${PORTS['judge-technical']}/judge`;

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

  const judgeTimer = startTimer();
  logger.info({
    event: EVENTS.JUDGE_CALL_START,
    submissionId,
    judgeId: AGENT_IDS.judgeTechnical,
    rootHash: submissionRootHash,
  });
  const judgeResp = await fetch(JUDGE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ submissionRootHash, submissionId }),
  });
  if (!judgeResp.ok) {
    const text = await judgeResp.text().catch(() => '');
    throw new Error(`judge-technical responded ${judgeResp.status}: ${text}`);
  }
  const { verdictRootHash } = await judgeResp.json();
  if (!verdictRootHash) throw new Error('judge-technical response missing verdictRootHash');
  logger.info({
    event: EVENTS.JUDGE_CALL_COMPLETE,
    submissionId,
    judgeId: AGENT_IDS.judgeTechnical,
    rootHash: verdictRootHash,
    durationMs: judgeTimer(),
  });

  const rawVerdict = await downloadJSON(verdictRootHash, { logger, submissionId });
  const verdict = JudgeVerdict.parse(rawVerdict);

  if (verdict.submissionId !== submissionId) {
    throw new Error(
      `verdict.submissionId mismatch: expected ${submissionId}, got ${verdict.submissionId}`,
    );
  }

  return { submissionId, submissionRootHash, verdictRootHash, verdict };
}

module.exports = { intake, AGENT_ID };
