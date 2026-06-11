#!/usr/bin/env node
// Usage: node scripts/submit.js <github-repo-url> [--video <path-to.mp4>]
// POSTs the URL to intake (:4001/submit) and prints all judge verdicts. With
// --video, sends multipart form-data so intake stores the clip on Filecoin and
// runs the demo judge; without it, sends JSON exactly as before.

const fs = require('fs');
const path = require('path');

const INTAKE_URL = 'http://127.0.0.1:4001/submit';

function parseArgs(argv) {
  const args = { repoUrl: null, videoPath: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--video') {
      args.videoPath = argv[++i];
    } else if (!args.repoUrl) {
      args.repoUrl = argv[i];
    }
  }
  return args;
}

async function main() {
  const { repoUrl, videoPath } = parseArgs(process.argv);
  if (!repoUrl) {
    console.error('Usage: node scripts/submit.js <github-repo-url> [--video <path-to.mp4>]');
    process.exit(1);
  }
  if (videoPath && !fs.existsSync(videoPath)) {
    console.error('Video file not found:', videoPath);
    process.exit(1);
  }

  console.log('POST', INTAKE_URL, '->', repoUrl, videoPath ? `(+ video ${path.basename(videoPath)})` : '');
  const t0 = Date.now();

  let request;
  if (videoPath) {
    // Multipart: openAsBlob streams the file from disk (no full-buffer in the
    // CLI). fetch sets the multipart content-type + boundary from the FormData.
    const form = new FormData();
    form.append('repoUrl', repoUrl);
    form.append('video', await fs.openAsBlob(videoPath), path.basename(videoPath));
    request = { method: 'POST', body: form };
  } else {
    request = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoUrl }),
    };
  }

  let resp;
  try {
    resp = await fetch(INTAKE_URL, request);
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
    demoVerdict = undefined,
    demoVerdictRootHash = null,
    demoVerdictError = null,
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

  if (demoVerdict !== undefined) {
    console.log('\n=== DEMO VERDICT (judge-demo) ===');
    if (demoVerdict === null) {
      console.log('(demo judge failed — panel above is unaffected)');
      if (demoVerdictError) console.log('error:', demoVerdictError);
    } else {
      console.log('demoVerdictRootHash:', demoVerdictRootHash);
      console.log('score:    ', demoVerdict.score, '/ 10');
      console.log('reasoning:', demoVerdict.reasoning);
      console.log('videoPieceCid:', demoVerdict.videoPieceCid);
      console.log('evidence:');
      for (const e of demoVerdict.evidence) console.log(`  - [${e.timestamp}] ${e.observation}`);
      console.log('claims_check:');
      for (const c of demoVerdict.claims_check) {
        console.log(`  - [${c.verdict}]${c.timestamp ? ` @${c.timestamp}` : ''} ${c.claim}`);
      }
    }
  }

  if (failures.length) {
    console.log('\n--- FAILURES ---');
    for (const f of failures) console.log(`  [${f.judgeId}] ${f.error}`);
  }

  if (verdicts.length || panelVerdictRootHash || demoVerdictRootHash) {
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
    if (demoVerdictRootHash) {
      console.log('  node bootstrap/download.js', demoVerdictRootHash, ` # demo verdict`);
    }
  }
}

main().catch((e) => {
  console.error('Unexpected error:', e);
  process.exit(1);
});
