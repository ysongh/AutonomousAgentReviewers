const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.agents') });

const express = require('express');
const { makeLogger, EVENTS } = require('aar-shared/logger');
const { PORTS, AGENT_IDS } = require('aar-shared/config');
const { getAgentSigner } = require('aar-shared/agent-wallet');
const { aggregate } = require('./handler');

const PORT = PORTS.aggregator;
const AGENT_ID = AGENT_IDS.aggregator;
const logger = makeLogger(AGENT_ID);
const signer = getAgentSigner(AGENT_ID);

// --simulate-revise-failure=<agentId>  OR  SIMULATE_REVISE_FAILURE=<agentId>
// Forces the targeted judge's /revise call to throw, so the dashboard's
// abstain-due-to-failure rendering can be exercised on demand. Same code
// path as a real failure: synthetic abstention, JUDGE_ABSTAIN_DUE_TO_FAILURE
// log event, revisionRootHash:null in the panel. Temporary — tracked in
// TODO.md for removal before submission.
const VALID_SIMULATE_TARGETS = new Set([
  AGENT_IDS.judgeTechnical,
  AGENT_IDS.judgeOriginality,
  AGENT_IDS.judgeSkeptic,
]);
function parseSimulateFailure() {
  const cliArg = process.argv.find((a) => a.startsWith('--simulate-revise-failure='));
  const fromCli = cliArg ? cliArg.split('=')[1] : null;
  const fromEnv = process.env.SIMULATE_REVISE_FAILURE || null;
  const value = fromCli || fromEnv;
  if (!value) return null;
  if (!VALID_SIMULATE_TARGETS.has(value)) {
    console.warn(
      `[${AGENT_ID}] ignoring --simulate-revise-failure=${value}: must be one of ${[...VALID_SIMULATE_TARGETS].join(', ')}`,
    );
    return null;
  }
  return value;
}
const simulateFailure = parseSimulateFailure();

const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/health', (_req, res) => res.json({ ok: true, agent: AGENT_ID }));

app.post('/aggregate', async (req, res) => {
  const { submissionId, submissionRootHash, verdictRootHashes } = req.body || {};
  try {
    const result = await aggregate(
      { submissionId, submissionRootHash, verdictRootHashes },
      { logger, signer, simulateFailure },
    );
    res.json(result);
  } catch (err) {
    logger.error({ event: EVENTS.ERROR, submissionId, error: err.message, stack: err.stack });
    // Per addendum: panel verdict is the final artifact; surface failure
    // as 503 so intake can hand it to the user as a re-submit signal.
    res.status(503).json({ error: err.message });
  }
});

app.listen(PORT, async () => {
  const address = await signer.getAddress();
  logger.info({ event: 'agent-listening', port: PORT, signerAddress: address });
  console.log(`[${AGENT_ID}] listening on :${PORT} (signer ${address})`);
  if (simulateFailure) {
    const banner = `⚠️  RUNNING WITH --simulate-revise-failure=${simulateFailure}. This is a debug flag and must NOT ship in the final demo build.`;
    console.warn(`[${AGENT_ID}] ${banner}`);
    logger.warn({ event: 'simulate-revise-failure-active', target: simulateFailure });
  }
});
