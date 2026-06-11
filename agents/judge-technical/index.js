const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.agents') });

const express = require('express');
const { makeLogger, EVENTS } = require('aar-shared/logger');
const { PORTS, AGENT_IDS } = require('aar-shared/config');
const { getAgentSigner } = require('aar-shared/agent-wallet');
const { judge, revise } = require('./handler');

const PORT = PORTS['judge-technical'];
const AGENT_ID = AGENT_IDS.judgeTechnical;
const logger = makeLogger(AGENT_ID);
const signer = getAgentSigner(AGENT_ID);

const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/health', (_req, res) => res.json({ ok: true, agent: AGENT_ID }));

app.post('/judge', async (req, res) => {
  const { submissionRootHash, submissionId } = req.body || {};
  try {
    const result = await judge({ submissionRootHash, submissionId }, { logger, signer });
    res.json(result);
  } catch (err) {
    logger.error({ event: EVENTS.ERROR, submissionId, error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

app.post('/revise', async (req, res) => {
  // demoVerdictRootHash is OPTIONAL cross-modal evidence — present only when the
  // submission had a successfully-reviewed demo video.
  const { submissionId, originalVerdictRootHash, peerVerdictRootHashes, demoVerdictRootHash } =
    req.body || {};
  try {
    const result = await revise(
      { submissionId, originalVerdictRootHash, peerVerdictRootHashes, demoVerdictRootHash },
      { logger, signer },
    );
    res.json(result);
  } catch (err) {
    logger.error({ event: EVENTS.ERROR, submissionId, error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, async () => {
  const address = await signer.getAddress();
  logger.info({ event: 'agent-listening', port: PORT, signerAddress: address });
  console.log(`[${AGENT_ID}] listening on :${PORT} (signer ${address})`);
});
