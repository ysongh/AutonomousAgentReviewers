require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const express = require('express');
const { makeLogger, EVENTS } = require('aar-shared/logger');
const { PORTS, AGENT_IDS } = require('aar-shared/config');
const { intake } = require('./handler');

const PORT = PORTS.intake;
const AGENT_ID = AGENT_IDS.intake;
const logger = makeLogger(AGENT_ID);

const app = express();
app.use(express.json({ limit: '64kb' }));

app.get('/health', (_req, res) => res.json({ ok: true, agent: AGENT_ID }));

app.post('/submit', async (req, res) => {
  const { repoUrl } = req.body || {};
  try {
    const result = await intake({ repoUrl }, logger);
    res.json(result);
  } catch (err) {
    logger.error({ event: EVENTS.ERROR, error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  logger.info({ event: 'agent-listening', port: PORT });
  console.log(`[${AGENT_ID}] listening on :${PORT}`);
});
