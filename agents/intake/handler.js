const crypto = require('crypto');
const { uploadJSON, downloadJSON } = require('aar-shared/og-storage');
const { fetchRepoMetadata } = require('aar-shared/github');
const { SubmissionRecord, JudgeVerdict } = require('aar-shared/schemas');
const { PORTS, AGENT_IDS } = require('aar-shared/config');

const AGENT_ID = AGENT_IDS.intake;
const JUDGE_URL = `http://127.0.0.1:${PORTS['judge-technical']}/judge`;

async function intake({ repoUrl }, logger) {
  if (!repoUrl) throw new Error('repoUrl is required');

  const submissionId = crypto.randomUUID();
  logger.info({ action: 'intake.received', repoUrl, submissionId });

  const meta = await fetchRepoMetadata(repoUrl);
  logger.info({
    action: 'intake.github_fetched',
    repoName: meta.repoName,
    readmeBytes: meta.readme.length,
    treeEntries: meta.fileTree.length,
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

  const { rootHash: submissionRootHash, txHash: subTxHash } =
    await uploadJSON(submission, { logger });
  logger.info({
    action: 'intake.submission_uploaded',
    submissionRootHash,
    txHash: subTxHash,
    submissionId,
  });

  logger.info({ action: 'intake.calling_judge', url: JUDGE_URL, submissionRootHash });
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
  logger.info({ action: 'intake.judge_done', verdictRootHash });

  const rawVerdict = await downloadJSON(verdictRootHash, { logger });
  const verdict = JudgeVerdict.parse(rawVerdict);

  if (verdict.submissionId !== submissionId) {
    throw new Error(
      `verdict.submissionId mismatch: expected ${submissionId}, got ${verdict.submissionId}`,
    );
  }

  logger.info({
    action: 'intake.verdict_returned',
    submissionId,
    submissionRootHash,
    verdictRootHash,
    score: verdict.score,
  });

  return { submissionId, submissionRootHash, verdictRootHash, verdict };
}

module.exports = { intake, AGENT_ID };
