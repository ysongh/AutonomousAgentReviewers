// gen-wallet.js — generate ONE fresh Calibration keypair for the spike.
// Writes FILECOIN_PRIVATE_KEY into .env (refuses to overwrite an existing one)
// and prints the address. Never reuses any AAR key.
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const ENV_PATH = new URL('./.env', import.meta.url);

let existing = '';
if (existsSync(ENV_PATH)) {
  existing = readFileSync(ENV_PATH, 'utf8');
  if (/^FILECOIN_PRIVATE_KEY=0x[0-9a-fA-F]{64}\s*$/m.test(existing)) {
    const acct = privateKeyToAccount(
      existing.match(/^FILECOIN_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/m)[1]
    );
    console.error('.env already has a FILECOIN_PRIVATE_KEY — refusing to overwrite.');
    console.error('Existing address:', acct.address);
    process.exit(1);
  }
}

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

const line = `FILECOIN_PRIVATE_KEY=${privateKey}\n`;
writeFileSync(ENV_PATH, existing ? `${existing.trimEnd()}\n${line}` : line, { mode: 0o600 });

console.log('Fresh Calibration keypair generated and written to .env (gitignored).');
console.log('ADDRESS:', account.address);
