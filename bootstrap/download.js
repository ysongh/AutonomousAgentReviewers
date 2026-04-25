require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Indexer } = require('@0glabs/0g-ts-sdk');

async function main() {
  const rootHash = process.argv[2];
  if (!rootHash) {
    console.error('Usage: node download.js <rootHash>');
    process.exit(1);
  }

  const { INDEXER_URL } = process.env;
  if (!INDEXER_URL) {
    console.error('Missing INDEXER_URL in .env');
    process.exit(1);
  }

  const indexer = new Indexer(INDEXER_URL);
  const outPath = path.join(__dirname, 'downloaded.json');

  if (fs.existsSync(outPath)) {
    fs.unlinkSync(outPath);
  }

  const err = await indexer.download(rootHash, outPath, true);
  if (err !== null) {
    console.error('download() failed:', err);
    process.exit(1);
  }

  const raw = fs.readFileSync(outPath, 'utf8');
  const parsed = JSON.parse(raw);
  console.log('Downloaded JSON:');
  console.log(parsed);
}

main().catch((e) => {
  console.error('Unexpected error:', e);
  process.exit(1);
});
