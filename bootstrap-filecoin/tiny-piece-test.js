// tiny-piece-test.js — secondary goal: what does storing a small (~2KB) JSON
// artifact (the shape of an AAR JudgeVerdict) look like on Warm Storage?
// Measures: does the SDK accept it, the min-size/padding floor, cost, and
// round-trip time. Informs a possible future 0G→Filecoin migration of the
// small JSON payloads (which currently live on 0G).
import { createHash } from 'node:crypto';
import { formatUnits } from 'viem';
import { SIZE_CONSTANTS } from '@filoz/synapse-sdk';
import { makeSynapse } from './client.js';

// A realistic ~2KB JudgeVerdict (padded reasoning/evidence to reach ~2KB).
const verdict = {
  agentId: 'judge-technical',
  submissionId: '7c3e9b1a-2f44-4d8e-9a01-5b6c7d8e9f00',
  score: 7,
  reasoning: 'The repository demonstrates solid architecture with clear separation of concerns. '.repeat(12),
  evidence: Array.from({ length: 8 }, (_, i) => `evidence[${i}]: file src/module${i}.ts cited for a concrete claim about implementation quality and test coverage`),
  producedAt: new Date().toISOString(),
};
const json = JSON.stringify(verdict);
const bytes = new TextEncoder().encode(json);
const sha256 = createHash('sha256').update(bytes).digest('hex');

console.log('=== Tiny piece (JudgeVerdict-shaped JSON) ===');
console.log('  raw JSON size      :', bytes.length, 'bytes');
console.log('  MIN_UPLOAD_SIZE    :', Number(SIZE_CONSTANTS.MIN_UPLOAD_SIZE), 'bytes (SDK floor)');
console.log('  BYTES_PER_LEAF     :', Number(SIZE_CONSTANTS.BYTES_PER_LEAF));
console.log('  above floor?       :', bytes.length >= Number(SIZE_CONSTANTS.MIN_UPLOAD_SIZE) ? 'yes' : 'NO — would be rejected/padded');

const { synapse } = makeSynapse();
const dec = synapse.payments.decimals();
const depositedBefore = await synapse.payments.balance({ token: 'USDFC' });

console.log('\nUploading tiny piece…');
const t0 = Date.now();
const result = await synapse.storage.upload(bytes, {
  callbacks: {
    onPiecesAdded: (tx, p, pieces) => console.log(`  pieces-added tx: ${tx} (provider ${p}, ${pieces.length})`),
    onPiecesConfirmed: (ds, p, pieces) => console.log(`  confirmed: dataSet ${ds}, provider ${p}, ${pieces.length}`),
  },
});
const upMs = Date.now() - t0;
console.log('  pieceCid           :', result.pieceCid.toString());
console.log('  reported size      :', result.size, 'bytes');
console.log('  copies             :', result.copies.length, '| newDataSet(s):', result.copies.map((c) => c.isNewDataSet).join(','));
console.log('  upload wall-clock  :', (upMs / 1000).toFixed(1), 's');

const depositedAfter = await synapse.payments.balance({ token: 'USDFC' });
console.log('  USDFC lockup delta :', formatUnits(depositedBefore - depositedAfter, dec));

console.log('\nDownloading tiny piece…');
const t1 = Date.now();
const back = await synapse.storage.download({ pieceCid: result.pieceCid.toString() });
const dlMs = Date.now() - t1;
const backSha = createHash('sha256').update(back).digest('hex');
console.log('  download wall-clock:', (dlMs / 1000).toFixed(1), 's,', back.length, 'bytes');
console.log('  byte-identical     :', backSha === sha256 ? 'YES ✅' : 'NO ❌');
console.log('  round-trip total   :', ((upMs + dlMs) / 1000).toFixed(1), 's');
if (backSha !== sha256) throw new Error('tiny-piece sha256 mismatch.');
