// download-video.js — Phase E cont'd: retrieve the piece, verify byte-identity,
// and test plain-HTTP gateway streaming (for future dashboard <video src=…>).
//
// 1. SDK download by PieceCID (synapse.storage.download). If it fails right
//    after upload, poll to measure propagation delay until first success.
// 2. Write downloaded.mp4, sha256-compare against the original.
// 3. Gateway check: HTTP GET the retrievalUrl with a Range header to confirm
//    plain HTTP + byte-range support (what <video> needs to stream/seek).
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { makeSynapse, calibration } from './client.js';

const here = new URL('./', import.meta.url);
const meta = JSON.parse(readFileSync(new URL('./upload-result.json', here), 'utf8'));
console.log('PieceCID    :', meta.pieceCid);
console.log('Orig sha256 :', meta.sha256);
console.log('retrievalUrl:', meta.retrievalUrl);
console.log('filbeam dom :', calibration.filbeam?.retrievalDomain ?? '(none)');

const { synapse } = makeSynapse();

// --- 1. SDK download, polling for propagation if needed ----------------------
const POLL_MS = 5000;
const MAX_WAIT_MS = 180000;
const start = Date.now();
let bytes = null;
let attempt = 0;
while (bytes == null) {
  attempt++;
  try {
    const t0 = Date.now();
    bytes = await synapse.storage.download({ pieceCid: meta.pieceCid });
    const dlMs = Date.now() - t0;
    const propagationMs = Date.now() - start - dlMs;
    console.log(`\n✅ SDK download OK on attempt ${attempt}`);
    console.log(`   propagation delay (until first retrievable): ~${(propagationMs / 1000).toFixed(1)}s`);
    console.log(`   download wall-clock: ${(dlMs / 1000).toFixed(1)}s, ${bytes.length} bytes`);
  } catch (e) {
    const waited = Date.now() - start;
    if (waited > MAX_WAIT_MS) throw new Error(`Piece not retrievable after ${(waited / 1000).toFixed(0)}s: ${e.message}`);
    process.stdout.write(`   attempt ${attempt} not ready (${e.message.slice(0, 60)}…), retrying in ${POLL_MS / 1000}s\n`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

// --- 2. byte-identity check --------------------------------------------------
writeFileSync(new URL('./downloaded.mp4', here), bytes);
const dlSha = createHash('sha256').update(bytes).digest('hex');
console.log('\nDownloaded sha256:', dlSha);
console.log('Byte-identical   :', dlSha === meta.sha256 ? 'YES ✅' : 'NO ❌');
if (dlSha !== meta.sha256) throw new Error('sha256 mismatch — retrieved bytes differ from original.');

// --- 3. gateway HTTP check ---------------------------------------------------
if (!meta.retrievalUrl) {
  console.log('\nNo retrievalUrl recorded — skipping gateway check.');
} else {
  console.log('\n=== Gateway HTTP check ===');
  console.log('URL:', meta.retrievalUrl);
  // Range request: the key capability for <video> streaming/seeking.
  const t0 = Date.now();
  const res = await fetch(meta.retrievalUrl, { headers: { Range: 'bytes=0-1023' } });
  const buf = new Uint8Array(await res.arrayBuffer());
  console.log('  HTTP status     :', res.status, res.statusText);
  console.log('  content-type    :', res.headers.get('content-type'));
  console.log('  content-length  :', res.headers.get('content-length'));
  console.log('  accept-ranges   :', res.headers.get('accept-ranges'));
  console.log('  content-range   :', res.headers.get('content-range'));
  console.log('  bytes returned  :', buf.length, `(asked for 1024; ${res.status === 206 ? 'partial 206 ✅ range supported' : 'full 200 — range may be ignored'})`);
  console.log('  first-1KB matches original:', Buffer.from(buf.subarray(0, 1024)).equals(Buffer.from(new Uint8Array(readFileSync(new URL(`./${meta.file}`, here))).subarray(0, buf.length))) ? 'YES ✅' : 'NO');
  console.log(`  gateway fetch wall-clock: ${(Date.now() - t0) / 1000}s`);
  console.log('\n  => <video src> viability:', res.ok && (res.status === 206 || res.headers.get('accept-ranges') === 'bytes') ? 'plain HTTP + range OK ✅' : 'check headers above ⚠️');
}
