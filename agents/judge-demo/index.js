const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.agents') });

const express = require('express');
const { makeLogger, EVENTS } = require('aar-shared/logger');
const { PORTS, AGENT_IDS } = require('aar-shared/config');
const { getAgentSigner } = require('aar-shared/agent-wallet');
const { review } = require('./handler');

const PORT = PORTS['judge-demo'];
const AGENT_ID = AGENT_IDS.judgeDemo;
const logger = makeLogger(AGENT_ID);
const signer = getAgentSigner(AGENT_ID);

const app = express();
// Bodies carry only root hashes + the submissionId UUID — same bus rule as the
// other judges. The video itself never crosses this wire; it comes from Filecoin.
app.use(express.json({ limit: '64kb' }));

app.get('/health', (_req, res) => res.json({ ok: true, agent: AGENT_ID }));

app.post('/review', async (req, res) => {
  const { submissionRootHash, submissionId } = req.body || {};
  try {
    const result = await review({ submissionRootHash, submissionId }, { logger, signer });
    res.json(result);
  } catch (err) {
    logger.error({ event: EVENTS.ERROR, submissionId, error: err.message, stack: err.stack });
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.listen(PORT, async () => {
  const address = await signer.getAddress();
  logger.info({ event: 'agent-listening', port: PORT, signerAddress: address });
  console.log(`[${AGENT_ID}] listening on :${PORT} (signer ${address})`);
});
