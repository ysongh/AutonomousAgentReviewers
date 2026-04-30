const { ethers } = require('ethers');

// Maps agentId → env var prefix in .env.agents.
const AGENT_KEY_PREFIX = {
  'intake':            'INTAKE',
  'judge-technical':   'JUDGE_TECHNICAL',
  'judge-originality': 'JUDGE_ORIGINALITY',
  'judge-skeptic':     'JUDGE_SKEPTIC',
  'aggregator':        'AGGREGATOR',
};

// One signer per agent per process. start-all.sh loads .env.agents into the
// environment so PRIVATE_KEY-style vars are present at agent startup.
const cache = new Map();

function getAgentSigner(agentId) {
  if (cache.has(agentId)) return cache.get(agentId);

  const prefix = AGENT_KEY_PREFIX[agentId];
  if (!prefix) {
    throw new Error(`getAgentSigner: unknown agentId "${agentId}". Expected one of: ${Object.keys(AGENT_KEY_PREFIX).join(', ')}`);
  }

  const keyVar = `${prefix}_PRIVATE_KEY`;
  const pk = process.env[keyVar];
  if (!pk) {
    throw new Error(`getAgentSigner: ${keyVar} missing from environment. Did you generate .env.agents and source it (start-all.sh handles this)?`);
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error(`getAgentSigner: ${keyVar} is malformed — expected 0x-prefixed 32-byte hex`);
  }

  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) {
    throw new Error('getAgentSigner: RPC_URL missing from environment');
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(pk, provider);
  cache.set(agentId, wallet);
  return wallet;
}

module.exports = { getAgentSigner };
