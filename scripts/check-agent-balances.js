#!/usr/bin/env node
// Reads .env.agents and the root .env, queries each agent address's balance
// on the 0G Galileo testnet, and prints a table. Exits 0 only if every agent
// has at least 0.04 0G (gives the user a buffer above the 0.05 faucet drip
// for tx fees).

const fs = require('fs');
const path = require('path');
const { ethers } = require(path.join(__dirname, '..', 'shared', 'node_modules', 'ethers'));
const dotenv = require(path.join(__dirname, '..', 'shared', 'node_modules', 'dotenv'));

const ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });
dotenv.config({ path: path.join(ROOT, '.env.agents') });

const MIN_BALANCE_OG = 0.04;
const AGENTS = [
  { id: 'intake',            prefix: 'INTAKE' },
  { id: 'judge-technical',   prefix: 'JUDGE_TECHNICAL' },
  { id: 'judge-originality', prefix: 'JUDGE_ORIGINALITY' },
  { id: 'judge-skeptic',     prefix: 'JUDGE_SKEPTIC' },
  { id: 'aggregator',        prefix: 'AGGREGATOR' },
  { id: 'judge-demo',        prefix: 'JUDGE_DEMO' },
];

async function main() {
  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) {
    console.error('RPC_URL missing from .env');
    process.exit(1);
  }
  const envAgentsPath = path.join(ROOT, '.env.agents');
  if (!fs.existsSync(envAgentsPath)) {
    console.error('.env.agents not found. Run: node scripts/generate-agent-wallets.js');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const minWei = ethers.parseEther(MIN_BALANCE_OG.toString());

  const rows = [];
  for (const { id, prefix } of AGENTS) {
    const address = process.env[`${prefix}_ADDRESS`];
    if (!address) {
      rows.push({ id, address: '(missing)', balance: null, ok: false });
      continue;
    }
    const balanceWei = await provider.getBalance(address);
    rows.push({
      id,
      address,
      balance: balanceWei,
      ok: balanceWei >= minWei,
    });
  }

  console.log('  Agent              Address                                       Balance');
  console.log('  -----------------  --------------------------------------------  -----------------');
  let allOk = true;
  for (const r of rows) {
    const balStr = r.balance === null
      ? 'n/a'
      : `${ethers.formatEther(r.balance)} 0G`;
    const mark = r.ok ? 'OK' : 'LOW';
    if (!r.ok) allOk = false;
    console.log(
      '  ' + r.id.padEnd(17) +
      '  ' + r.address.padEnd(44) +
      '  ' + balStr.padEnd(14) + ' ' + mark
    );
  }

  console.log();
  if (allOk) {
    console.log(`All ${AGENTS.length} agents have >= ${MIN_BALANCE_OG} 0G. Ready to start agents.`);
    process.exit(0);
  } else {
    console.log(`At least one agent is below ${MIN_BALANCE_OG} 0G. Top up at https://faucet.0g.ai`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Balance check failed:', e.message);
  process.exit(1);
});
