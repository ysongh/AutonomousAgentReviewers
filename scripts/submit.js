#!/usr/bin/env node
// Usage: node scripts/submit.js <github-repo-url>
// POSTs the URL to intake (:4001/submit) and prints all judge verdicts.

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

  const {
    submissionId,
    submissionRootHash,
    verdicts = [],
    failures = [],
    panelVerdictRootHash = null,
    panelVerdict = null,
  } = parsed;

  console.log('\n=== PIPELINE COMPLETE in', elapsed, 's ===');
  console.log('submissionId:       ', submissionId);
  console.log('submissionRootHash: ', submissionRootHash);
  console.log('verdicts:           ', verdicts.length, '/ 3');
  if (failures.length) console.log('failures:           ', failures.length);

  for (const entry of verdicts) {
    const { judgeId, verdictRootHash, verdict } = entry;
    console.log(`\n--- ROUND 1 [${judgeId}] ---`);
    console.log('verdictRootHash:', verdictRootHash);
    console.log('score:    ', verdict.score, '/ 10');
    console.log('reasoning:', verdict.reasoning);
    console.log('evidence:');
    for (const e of verdict.evidence) console.log('  -', e);
    console.log('producedAt:', verdict.producedAt);
  }

  if (panelVerdict) {
    console.log('\n=== ROUND 2 (DELIBERATION) ===');
    for (const r of panelVerdict.round2Revisions) {
      const tag = r.revisionRootHash === null ? 'ABSTAIN-DUE-TO-FAILURE' : (r.revised ? 'REVISED' : 'HELD');
      console.log(`\n--- ROUND 2 [${r.agentId}] — ${tag} ---`);
      if (r.revisionRootHash) console.log('revisionRootHash:', r.revisionRootHash);
      else console.log('revisionRootHash: (none — judge revise call failed; see logs)');
      if (r.revised) {
        console.log('revisedScore:    ', r.revisedScore, '/ 10');
        console.log('revisionReasoning:', r.revisionReasoning);
      }
    }

    console.log('\n=== PANEL VERDICT ===');
    console.log('panelVerdictRootHash:', panelVerdictRootHash);
    console.log('finalScores:        ',
      `technical=${panelVerdict.finalScores.technical}`,
      `originality=${panelVerdict.finalScores.originality}`,
      `skeptic=${panelVerdict.finalScores.skeptic}`);
    console.log('weightedAggregate:  ', panelVerdict.weightedAggregate.toFixed(2), '/ 10');
    console.log('spread:             ', panelVerdict.spread);
    console.log('dissent:            ', panelVerdict.dissent);
    console.log('dissentSummary:     ', panelVerdict.dissentSummary);
  } else {
    console.log('\n=== PANEL VERDICT ===');
    console.log('(no panel verdict — aggregator was skipped or failed)');
  }

  if (failures.length) {
    console.log('\n--- FAILURES ---');
    for (const f of failures) console.log(`  [${f.judgeId}] ${f.error}`);
  }

  if (verdicts.length || panelVerdictRootHash) {
    console.log('\nVerify any artifact on 0G:');
    for (const v of verdicts) {
      console.log('  node bootstrap/download.js', v.verdictRootHash, ` # round-1 ${v.judgeId}`);
    }
    if (panelVerdict) {
      for (const r of panelVerdict.round2Revisions) {
        if (r.revisionRootHash) {
          console.log('  node bootstrap/download.js', r.revisionRootHash, ` # round-2 ${r.agentId}`);
        }
      }
      console.log('  node bootstrap/download.js', panelVerdictRootHash, ` # panel verdict`);
    }
  }
}

main().catch((e) => {
  console.error('Unexpected error:', e);
  process.exit(1);
});
