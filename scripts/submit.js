#!/usr/bin/env node
// Usage: node scripts/submit.js <github-repo-url>
// POSTs the URL to intake (:4001/submit) and prints the verdict.

const INTAKE_URL = 'http://127.0.0.1:4001/submit';

async function main() {
  const repoUrl = process.argv[2];
  if (!repoUrl) {
    console.error('Usage: node scripts/submit.js <github-repo-url>');
    process.exit(1);
  }

  console.log('POST', INTAKE_URL, '->', repoUrl);
  const t0 = Date.now();

  let resp;
  try {
    resp = await fetch(INTAKE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoUrl }),
    });
  } catch (e) {
    console.error('Could not reach intake at', INTAKE_URL);
    console.error('Is start-all.sh running? Underlying error:', e.message);
    process.exit(1);
  }

  const body = await resp.text();
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    console.error('Non-JSON response from intake (HTTP', resp.status + '):');
    console.error(body);
    process.exit(1);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  if (!resp.ok) {
    console.error('Intake error (HTTP', resp.status + ') after', elapsed, 's:');
    console.error(parsed);
    process.exit(1);
  }

  const { submissionId, submissionRootHash, verdictRootHash, verdict } = parsed;

  console.log('\n=== PIPELINE COMPLETE in', elapsed, 's ===');
  console.log('submissionId:       ', submissionId);
  console.log('submissionRootHash: ', submissionRootHash);
  console.log('verdictRootHash:    ', verdictRootHash);
  console.log('\n--- VERDICT ---');
  console.log('agent:    ', verdict.agentId);
  console.log('score:    ', verdict.score, '/ 10');
  console.log('reasoning:', verdict.reasoning);
  console.log('evidence:');
  for (const e of verdict.evidence) console.log('  -', e);
  console.log('producedAt:', verdict.producedAt);
  console.log('\nVerify on 0G:  node bootstrap/download.js', verdictRootHash);
}

main().catch((e) => {
  console.error('Unexpected error:', e);
  process.exit(1);
});
