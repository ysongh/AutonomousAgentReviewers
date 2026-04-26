const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const PORTS = {
  intake: 4001,
  'judge-technical': 4002,
};

const AGENT_IDS = {
  intake: 'intake',
  judgeTechnical: 'judge-technical',
};

const PATHS = {
  root: ROOT,
  logs: path.join(ROOT, 'logs'),
  envFile: path.join(ROOT, '.env'),
};

const OG = {
  rpcUrl: process.env.RPC_URL,
  indexerUrl: process.env.INDEXER_URL,
  privateKey: process.env.PRIVATE_KEY,
};

module.exports = { PORTS, AGENT_IDS, PATHS, OG };
