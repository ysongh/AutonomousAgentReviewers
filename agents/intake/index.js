const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.agents') });

const express = require('express');
const { makeLogger, EVENTS } = require('aar-shared/logger');
const { PORTS, AGENT_IDS } = require('aar-shared/config');
const { getAgentSigner } = require('aar-shared/agent-wallet');
const { intake } = require('./handler');

const PORT = PORTS.intake;
const AGENT_ID = AGENT_IDS.intake;
const logger = makeLogger(AGENT_ID);
const signer = getAgentSigner(AGENT_ID);

const app = express();
app.use(express.json({ limit: '64kb' }));

app.get('/health', (_req, res) => res.json({ ok: true, agent: AGENT_ID }));

app.post('/submit', async (req, res) => {
  const { repoUrl } = req.body || {};
  try {
    const result = await intake({ repoUrl }, { logger, signer });
    res.json(result);
  } catch (err) {
    logger.error({ event: EVENTS.ERROR, error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, async () => {
  const address = await signer.getAddress();
  logger.info({ event: 'agent-listening', port: PORT, signerAddress: address });
  console.log(`[${AGENT_ID}] listening on :${PORT} (signer ${address})`);
});
