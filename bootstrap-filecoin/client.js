// client.js — shared Synapse client construction for the spike scripts.
// The SDK is viem-native (v0.41 migrated off ethers): we build a LOCAL
// viem account from the private key and hand it to Synapse.create. The
// Calibration chain object (chainId 314159, glif RPC, USDFC + Warm Storage
// addresses, filbeam domain) ships inside the SDK — we just import it.
import 'dotenv/config';
import { privateKeyToAccount } from 'viem/accounts';
import { Synapse, calibration } from '@filoz/synapse-sdk';

export function getAccount() {
  const pk = process.env.FILECOIN_PRIVATE_KEY;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error('FILECOIN_PRIVATE_KEY missing or malformed in .env (expected 0x + 64 hex).');
  }
  return privateKeyToAccount(pk);
}

// withCDN defaults false; flip per-script if a CDN-served retrieval test is wanted.
export function makeSynapse({ withCDN = false } = {}) {
  const account = getAccount();
  // source is a required field on SynapseOptions (telemetry tag). null = unset.
  const synapse = Synapse.create({ account, chain: calibration, source: null, withCDN });
  return { synapse, account };
}

export { calibration };
