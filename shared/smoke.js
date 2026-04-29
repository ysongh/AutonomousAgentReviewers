require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { uploadJSON, downloadJSON, getDefaultSigner } = require('./og-storage');
const { makeLogger } = require('./logger');

async function main() {
  const logger = makeLogger('shared-smoke');

  const payload = {
    type: 'shared-smoke',
    sender: 'shared/smoke.js',
    timestamp: new Date().toISOString(),
    note: 'Round-trip sanity check for shared/og-storage.js',
  };

  console.log('--- UPLOAD ---');
  console.log('Payload:', payload);
  const t0 = Date.now();
  const { rootHash, txHash, txSeq } = await uploadJSON(payload, getDefaultSigner(), { logger });
  console.log('Upload OK in', ((Date.now() - t0) / 1000).toFixed(1), 's');
  console.log('  rootHash:', rootHash);
  console.log('  txHash:  ', txHash);
  console.log('  txSeq:   ', txSeq);

  console.log('\n--- DOWNLOAD ---');
  const t1 = Date.now();
  const got = await downloadJSON(rootHash, { logger });
  console.log('Download OK in', ((Date.now() - t1) / 1000).toFixed(1), 's');
  console.log('Got:', got);

  const ok = JSON.stringify(got) === JSON.stringify(payload);
  console.log('\nRound-trip match:', ok);
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e);
  process.exit(1);
});
