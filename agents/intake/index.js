const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.agents') });

const fs = require('fs');
const os = require('os');
const express = require('express');
const multer = require('multer');
const { makeLogger, EVENTS } = require('aar-shared/logger');
const { PORTS, AGENT_IDS } = require('aar-shared/config');
const { getAgentSigner } = require('aar-shared/agent-wallet');
const { assertRunway } = require('aar-shared/filecoin-storage');
const { intake } = require('./handler');

const PORT = PORTS.intake;
const AGENT_ID = AGENT_IDS.intake;
const logger = makeLogger(AGENT_ID);
const signer = getAgentSigner(AGENT_ID);

// 150MB cap on the optional demo video, mp4/webm/mov only. multer (the standard
// express multipart middleware) is used over busboy because its disk-storage
// engine streams the upload straight to a temp file — we never hold the whole
// video in memory, and the cap is enforced by multer before our handler runs.
const MAX_VIDEO_BYTES = 150 * 1024 * 1024;
const ALLOWED_VIDEO_MIME = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const ALLOWED_VIDEO_EXT = new Set(['.mp4', '.webm', '.mov']);

const upload = multer({
  storage: multer.diskStorage({ destination: os.tmpdir() }),
  limits: { fileSize: MAX_VIDEO_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ALLOWED_VIDEO_MIME.has(file.mimetype) || ALLOWED_VIDEO_EXT.has(ext)) return cb(null, true);
    cb(Object.assign(new Error(`unsupported video type: ${file.mimetype || ext || 'unknown'}`), { statusCode: 400 }));
  },
});

const app = express();
app.use(express.json({ limit: '64kb' }));

app.get('/health', (_req, res) => res.json({ ok: true, agent: AGENT_ID }));

// upload.single('video') is a no-op for application/json bodies (the existing
// no-video path) and streams the multipart 'video' field to a temp file
// otherwise. The wrapper turns multer's own errors (size cap, bad type) into
// a clean 400.
function acceptVideo(req, res, next) {
  upload.single('video')(req, res, (err) => {
    if (err) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : err.statusCode || 400;
      logger.error({ event: EVENTS.ERROR, error: `video upload rejected: ${err.message}` });
      return res.status(status).json({ error: err.message });
    }
    next();
  });
}

app.post('/submit', acceptVideo, async (req, res) => {
  const { repoUrl } = req.body || {};
  const videoPath = req.file ? req.file.path : null;
  try {
    const result = await intake({ repoUrl, videoPath }, { logger, signer });
    res.json(result);
  } catch (err) {
    logger.error({ event: EVENTS.ERROR, error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  } finally {
    if (videoPath) fs.rm(videoPath, { force: true }, () => {});
  }
});

app.listen(PORT, async () => {
  const address = await signer.getAddress();
  logger.info({ event: 'agent-listening', port: PORT, signerAddress: address });
  console.log(`[${AGENT_ID}] listening on :${PORT} (signer ${address})`);
  // Startup gate: fail loud if the Filecoin spike wallet can't pay for video
  // storage. Does NO payment setup — just reads balances (see filecoin-storage).
  try {
    const runway = await assertRunway();
    logger.info({ event: 'filecoin-runway-ok', ...runway });
    console.log(`[${AGENT_ID}] Filecoin runway OK — ${runway.tfil} tFIL, ${runway.usdfcDeposited} USDFC deposited`);
  } catch (err) {
    logger.error({ event: EVENTS.ERROR, error: `Filecoin runway check failed: ${err.message}` });
    console.error(`[${AGENT_ID}] FATAL — Filecoin runway check failed:\n${err.message}`);
    process.exit(1);
  }
});
