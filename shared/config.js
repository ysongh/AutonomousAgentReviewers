const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const PORTS = {
  intake: 4001,
  'judge-technical': 4002,
  'judge-originality': 4003,
  'judge-skeptic': 4004,
  aggregator: 4005,
  'judge-demo': 4006,
  'log-streamer': 4100,
};

const AGENT_IDS = {
  intake: 'intake',
  judgeTechnical: 'judge-technical',
  judgeOriginality: 'judge-originality',
  judgeSkeptic: 'judge-skeptic',
  aggregator: 'aggregator',
  judgeDemo: 'judge-demo',
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
const JUDGE_DEMO_URL = `http://localhost:${PORTS['judge-demo']}`;

// Coordinated submit slots — mitigates the cross-submitter flow-contract race
// (see CLAUDE.md). The three judges run their Claude calls concurrently, but the
// COORDINATOR (intake for round 1, aggregator for round 2) assigns each judge a
// slot index 0/1/2; the judge delays its on-chain flow.submit by
// slot * SUBMIT_SLOT_MS so only ONE submit is in flight at a time. A Galileo
// flow.submit mines in ~9s, and concurrent in-flight submits revert all-but-one,
// so the slot must comfortably exceed the mine window. This serializes the
// on-chain writes WITHOUT serializing the (slow) Claude calls. Tunable via env.
const SUBMIT_SLOT_MS = Number(process.env.SUBMIT_SLOT_MS) || 12000;

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

module.exports = { PORTS, AGENT_IDS, JUDGE_URLS, JUDGE_REVISE_URLS, AGGREGATOR_URL, JUDGE_DEMO_URL, SUBMIT_SLOT_MS, PATHS, OG };
