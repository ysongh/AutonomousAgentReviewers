const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const PORTS = {
  intake: 4001,
  'judge-technical': 4002,
  'judge-originality': 4003,
  'judge-skeptic': 4004,
  aggregator: 4005,
  'log-streamer': 4100,
};

const AGENT_IDS = {
  intake: 'intake',
  judgeTechnical: 'judge-technical',
  judgeOriginality: 'judge-originality',
  judgeSkeptic: 'judge-skeptic',
  aggregator: 'aggregator',
  logStreamer: 'log-streamer',
};

const JUDGE_URLS = {
  technical: `http://localhost:${PORTS['judge-technical']}`,
  originality: `http://localhost:${PORTS['judge-originality']}`,
  skeptic: `http://localhost:${PORTS['judge-skeptic']}`,
};

const JUDGE_REVISE_URLS = {
  technical: `${JUDGE_URLS.technical}/revise`,
  originality: `${JUDGE_URLS.originality}/revise`,
  skeptic: `${JUDGE_URLS.skeptic}/revise`,
};

const AGGREGATOR_URL = `http://localhost:${PORTS.aggregator}`;

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

module.exports = { PORTS, AGENT_IDS, JUDGE_URLS, JUDGE_REVISE_URLS, AGGREGATOR_URL, PATHS, OG };
