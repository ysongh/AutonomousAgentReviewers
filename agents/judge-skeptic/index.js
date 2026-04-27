require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const express = require('express');
const { makeLogger, EVENTS } = require('aar-shared/logger');
const { PORTS, AGENT_IDS } = require('aar-shared/config');
const { judge } = require('./handler');

const PORT = PORTS['judge-skeptic'];
const AGENT_ID = AGENT_IDS.judgeSkeptic;
const logger = makeLogger(AGENT_ID);

const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/health', (_req, res) => res.json({ ok: true, agent: AGENT_ID }));

app.post('/judge', async (req, res) => {
  const { submissionRootHash, submissionId } = req.body || {};
  try {
    const result = await judge({ submissionRootHash, submissionId }, logger);
    res.json(result);
  } catch (err) {
    logger.error({ event: EVENTS.ERROR, submissionId, error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  logger.info({ event: 'agent-listening', port: PORT });
  console.log(`[${AGENT_ID}] listening on :${PORT}`);
});
