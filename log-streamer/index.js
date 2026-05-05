require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const express = require('express');
const chokidar = require('chokidar');
const { makeLogger, EVENTS } = require('aar-shared/logger');
const { PORTS, AGENT_IDS, PATHS } = require('aar-shared/config');
const { downloadJSON } = require('aar-shared/og-storage');

const ROOT_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

const PORT = PORTS['log-streamer'];
const AGENT_ID = AGENT_IDS.logStreamer;
const logger = makeLogger(AGENT_ID);

const RING_SIZE = 200;
const PING_INTERVAL_MS = 15_000;

// Ring buffer of recent log entries. Each entry is the parsed JSON object.
const ring = [];
function pushRing(entry) {
  ring.push(entry);
  if (ring.length > RING_SIZE) ring.shift();
}

// Per-file byte offset so we only read the bytes appended since last tick.
// On first sight of a file we set offset = current size (skip backlog) — the
// dashboard cares about the current run, not yesterday's logs.
const offsets = new Map();
const clients = new Set();

function broadcast(entry) {
  const payload = `data: ${JSON.stringify(entry)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch (_) {
      // best effort; the close handler will clean up
    }
  }
}

function readNewLines(filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (_) {
    return;
  }
  const prev = offsets.get(filePath) ?? 0;
  if (stat.size === prev) return;
  // Truncation guard: if the file shrank (rotation, manual clear), restart at 0.
  const start = stat.size < prev ? 0 : prev;
  let buf;
  try {
    const fd = fs.openSync(filePath, 'r');
    buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
  } catch (_) {
    return;
  }
  offsets.set(filePath, stat.size);

  const text = buf.toString('utf8');
  const lines = text.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (_) {
      continue;
    }
    pushRing(entry);
    broadcast(entry);
  }
}

// Polling, not FSEvents. macOS FSEvents under-reports cross-process appends:
// when an agent's pino stream flushes a few bytes to logs/<name>.jsonl, the
// event often never reaches chokidar in this process, so SSE clients see
// only the 15s keepalive pings during a real submission. Polling at 200ms
// is the cost of reliability here — these are tiny files, not a hot path.
const watcher = chokidar.watch(PATHS.logs, {
  persistent: true,
  ignoreInitial: false,
  usePolling: true,
  interval: 200,
  binaryInterval: 200,
  awaitWriteFinish: false,
  ignored: (filePath) => {
    if (filePath === PATHS.logs) return false;
    return !filePath.endsWith('.jsonl');
  },
});

watcher.on('add', (filePath) => {
  // Skip backlog: start tailing from the current end of the file.
  try {
    const { size } = fs.statSync(filePath);
    offsets.set(filePath, size);
  } catch (_) {
    offsets.set(filePath, 0);
  }
  logger.info({ event: 'log-file-tailing', file: path.basename(filePath) });
});

watcher.on('change', (filePath) => {
  readNewLines(filePath);
});

watcher.on('unlink', (filePath) => {
  offsets.delete(filePath);
});

const app = express();

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', clients: clients.size, buffered: ring.length });
});

app.get('/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  // Replay the buffered last-N entries first so a fresh client has context.
  for (const entry of ring) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }

  clients.add(res);
  logger.info({ event: 'sse-client-connected', clients: clients.size });

  const ping = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch (_) {
      // closed; cleanup happens via the close handler
    }
  }, PING_INTERVAL_MS);

  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
    logger.info({ event: 'sse-client-disconnected', clients: clients.size });
  });
});

// Read-only proxy so the dashboard can render the actual JSON for a root
// hash without doing chain RPC from the browser. Reuses shared/og-storage
// so the workaround lives in exactly one place. The dashboard reaches
// this through the Vite dev proxy (/verify → 4100), same as /events.
app.get('/verify/:rootHash', async (req, res) => {
  const { rootHash } = req.params;
  if (!ROOT_HASH_RE.test(rootHash)) {
    return res.status(400).json({ error: 'rootHash must be 0x-prefixed 64-char hex' });
  }
  try {
    const content = await downloadJSON(rootHash, { logger });
    res.json({
      rootHash,
      retrievedAt: new Date().toISOString(),
      indexer: process.env.INDEXER_URL || null,
      content,
    });
  } catch (err) {
    logger.warn({ event: 'verify-failed', rootHash, error: err.message });
    res.status(502).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  logger.info({ event: 'agent-listening', port: PORT });
  console.log(`[${AGENT_ID}] listening on :${PORT}`);
});
