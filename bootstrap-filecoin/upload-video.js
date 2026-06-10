// upload-video.js — Phase E: upload a local .mp4 to Warm Storage, measure
// wall-clock, capture the PieceCID + dataset/piece txs + cost.
//
// Pass the data as a Uint8Array (50MB fits comfortably in memory; the SDK
// also accepts a ReadableStream if we ever need it). The first upload for a
// wallet/provider creates a Data Set (one tx) and then adds the piece
// (another tx) — both surfaced via callbacks.
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { formatUnits } from 'viem';
import { makeSynapse } from './client.js';

// --- locate exactly one .mp4 -------------------------------------------------
const here = new URL('./', import.meta.url);
const mp4s = readdirSync(here).filter((f) => f.toLowerCase().endsWith('.mp4'));
if (mp4s.length === 0) throw new Error('No .mp4 in bootstrap-filecoin/. Drop one and re-run.');
if (mp4s.length > 1) throw new Error(`Multiple .mp4 files found (${mp4s.join(', ')}). Keep exactly one.`);
const file = mp4s[0];
const path = new URL(`./${file}`, import.meta.url);
const size = statSync(path).size;
const bytes = new Uint8Array(readFileSync(path));
const sha256 = createHash('sha256').update(bytes).digest('hex');
console.log(`File   : ${file}`);
console.log(`Size   : ${(size / 1048576).toFixed(2)} MB (${size} bytes)`);
console.log(`sha256 : ${sha256}`);

const { synapse, account } = makeSynapse();
const dec = synapse.payments.decimals();

// --- cost estimate + balance before -----------------------------------------
const costs = await synapse.storage.getUploadCosts({ dataSize: BigInt(size) }).catch((e) => {
  console.warn('  (getUploadCosts failed, continuing):', e.message);
  return null;
});
if (costs) console.log('Est. costs:', JSON.stringify(costs, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
const depositedBefore = await synapse.payments.balance({ token: 'USDFC' });
console.log('USDFC deposited (before):', formatUnits(depositedBefore, dec));

// --- upload ------------------------------------------------------------------
console.log('\nUploading…');
const t0 = Date.now();
const result = await synapse.storage.upload(bytes, {
  callbacks: {
    onProviderSelected: (p) => console.log('  provider selected:', p.serviceProvider ?? p.payee ?? JSON.stringify(p).slice(0, 80)),
    onDataSetResolved: (i) => console.log(`  data set resolved: id=${i.dataSetId}`),
    onStored: (providerId, pieceCid) => console.log(`  stored at provider ${providerId}: ${pieceCid}`),
    onPiecesAdded: (tx, providerId, pieces) => console.log(`  pieces-added tx: ${tx} (provider ${providerId}, ${pieces.length} piece(s))`),
    onPiecesConfirmed: (dataSetId, providerId, pieces) => console.log(`  pieces confirmed: dataSet ${dataSetId}, provider ${providerId}, ${pieces.length} piece(s)`),
  },
});
const uploadMs = Date.now() - t0;

console.log('\n=== UploadResult ===');
console.log('  pieceCid      :', result.pieceCid.toString());
console.log('  size          :', result.size, 'bytes');
console.log('  complete      :', result.complete);
console.log('  copies        :', result.copies.length, '| failedAttempts:', result.failedAttempts.length);
for (const c of result.copies) {
  console.log(`    - provider ${c.providerId} dataSet ${c.dataSetId} piece ${c.pieceId} [${c.role}] newDataSet=${c.isNewDataSet}`);
  console.log(`      retrievalUrl: ${c.retrievalUrl}`);
}
for (const f of result.failedAttempts) console.log('    ! failed:', JSON.stringify(f));
console.log(`\nUpload wall-clock: ${(uploadMs / 1000).toFixed(1)}s`);

// --- cost actual -------------------------------------------------------------
const depositedAfter = await synapse.payments.balance({ token: 'USDFC' });
console.log('USDFC deposited (after) :', formatUnits(depositedAfter, dec));
console.log('USDFC delta (lockup/spend):', formatUnits(depositedBefore - depositedAfter, dec));

// --- persist for the download step -------------------------------------------
const out = {
  file,
  size,
  sha256,
  pieceCid: result.pieceCid.toString(),
  dataSetId: result.copies[0]?.dataSetId?.toString() ?? null,
  retrievalUrl: result.copies[0]?.retrievalUrl ?? null,
  uploadMs,
  uploadedAt: new Date().toISOString(),
  uploader: account.address,
};
writeFileSync(new URL('./upload-result.json', here), JSON.stringify(out, null, 2));
console.log('\nWrote upload-result.json (PieceCID + retrievalUrl for download step).');
