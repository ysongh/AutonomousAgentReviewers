#!/usr/bin/env node
// Sequentially submits a list of candidate repos to the running pipeline
// and curates a demo case library. Reads URLs from scripts/demo-case-urls.txt
// (one per line, # for comments) and writes one JSONL record per submission
// to scripts/demo-case-results.jsonl. Sequential — never concurrent —
// because we don't want to fight the cross-submitter race during curation.

const fs = require('fs');
const path = require('path');

const INTAKE_URL = 'http://127.0.0.1:4001/submit';
const URLS_FILE = path.join(__dirname, 'demo-case-urls.txt');
const RESULTS_FILE = path.join(__dirname, 'demo-case-results.jsonl');
const PER_SUBMISSION_TIMEOUT_MS = 180_000;

function readUrls() {
  const raw = fs.readFileSync(URLS_FILE, 'utf8');
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

function shortRepo(url) {
  // Best-effort owner/repo for log lines; falls back to the full URL.
  const m = url.match(/github\.com[:/]+([^/]+)\/([^/?#]+?)(?:\.git)?$/i);
  return m ? `${m[1]}/${m[2]}` : url;
}

function summarise(repoUrl, parsed) {
  const verdicts = parsed.verdicts || [];
  const failures = parsed.failures || [];
  const panel = parsed.panelVerdict;
  const panelHash = parsed.panelVerdictRootHash;

  if (!panel) {
    return {
      repo: shortRepo(repoUrl),
      panelHash: null,
      aggregate: null,
      dissent: null,
      revisions: 0,
      abstentions: 0,
      failures: failures.length,
      note: verdicts.length < 3 ? 'round-1-race' : 'no-panel',
    };
  }

  const revs = panel.round2Revisions || [];
  const revisions = revs.filter((r) => r.revised === true).length;
  const abstentions = revs.filter((r) => r.revised === false).length;

  return {
    repo: shortRepo(repoUrl),
    panelHash,
    aggregate: panel.weightedAggregate,
    dissent: panel.dissent,
    revisions,
    abstentions,
    failures: failures.length,
    note: null,
  };
}

function fmtLine(s) {
  const agg = s.aggregate === null ? 'n/a' : s.aggregate.toFixed(2);
  const dissent = s.dissent === null ? 'n/a' : String(s.dissent);
  const tail = s.note ? ` [${s.note}]` : '';
  return (
    `${s.repo}: panelHash=${s.panelHash || 'null'} ` +
    `aggregate=${agg} dissent=${dissent} ` +
    `revisions=${s.revisions} abstentions=${s.abstentions} ` +
    `failures=${s.failures}${tail}`
  );
}

async function submitOne(repoUrl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PER_SUBMISSION_TIMEOUT_MS);

  const t0 = Date.now();
  try {
    const resp = await fetch(INTAKE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoUrl }),
      signal: ctrl.signal,
    });
    const elapsedMs = Date.now() - t0;
    const text = await resp.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        ok: false,
        elapsedMs,
        httpStatus: resp.status,
        error: `non-JSON response (HTTP ${resp.status}): ${text.slice(0, 400)}`,
      };
    }
    if (!resp.ok) {
      return {
        ok: false,
        elapsedMs,
        httpStatus: resp.status,
        error: `intake returned HTTP ${resp.status}`,
        body: parsed,
      };
    }
    return { ok: true, elapsedMs, httpStatus: resp.status, body: parsed };
  } catch (e) {
    return {
      ok: false,
      elapsedMs: Date.now() - t0,
      httpStatus: null,
      error: e.name === 'AbortError' ? 'timeout' : (e.message || String(e)),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const urls = readUrls();
  if (!urls.length) {
    console.error('No URLs to submit. Check', URLS_FILE);
    process.exit(1);
  }

  // Truncate prior results — fresh curation pass per run.
  fs.writeFileSync(RESULTS_FILE, '');

  console.log(`# demo-cases curation pass — ${urls.length} repos, sequential`);
  console.log(`# results -> ${RESULTS_FILE}\n`);

  const summaries = [];

  for (let i = 0; i < urls.length; i++) {
    const repoUrl = urls[i];
    const tag = `[${i + 1}/${urls.length}] ${shortRepo(repoUrl)}`;
    process.stdout.write(`${tag} submitting...\n`);

    const result = await submitOne(repoUrl);

    let summary;
    let record;
    if (!result.ok) {
      summary = {
        repo: shortRepo(repoUrl),
        panelHash: null,
        aggregate: null,
        dissent: null,
        revisions: 0,
        abstentions: 0,
        failures: 0,
        note: result.error || `http-${result.httpStatus}`,
      };
      record = {
        repoUrl,
        ok: false,
        elapsedMs: result.elapsedMs,
        httpStatus: result.httpStatus,
        error: result.error,
        body: result.body || null,
        summary,
      };
    } else {
      summary = summarise(repoUrl, result.body);
      record = {
        repoUrl,
        ok: true,
        elapsedMs: result.elapsedMs,
        httpStatus: result.httpStatus,
        submissionId: result.body.submissionId,
        submissionRootHash: result.body.submissionRootHash,
        verdicts: result.body.verdicts || [],
        failures: result.body.failures || [],
        panelVerdictRootHash: result.body.panelVerdictRootHash || null,
        panelVerdict: result.body.panelVerdict || null,
        summary,
      };
    }

    fs.appendFileSync(RESULTS_FILE, JSON.stringify(record) + '\n');
    summaries.push(summary);

    const elapsedS = (result.elapsedMs / 1000).toFixed(1);
    console.log(`${tag} done in ${elapsedS}s — ${fmtLine(summary)}\n`);
  }

  console.log('=== SUMMARY ===');
  for (const s of summaries) console.log(fmtLine(s));
}

main().catch((e) => {
  console.error('Unexpected error:', e);
  process.exit(1);
});
