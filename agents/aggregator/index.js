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

const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/health', (_req, res) => res.json({ ok: true, agent: AGENT_ID }));

app.post('/aggregate', async (req, res) => {
  const { submissionId, submissionRootHash, verdictRootHashes } = req.body || {};
  try {
    const result = await aggregate(
      { submissionId, submissionRootHash, verdictRootHashes },
      { logger, signer },
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
});
