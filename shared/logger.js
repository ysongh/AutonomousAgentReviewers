const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { PATHS } = require('./config');

// Canonical event vocabulary the dashboard depends on. Every log entry the
// dashboard renders must carry one of these in its `event` field. See
// CLAUDE.md "Log event shape" for the full schema contract.
const EVENTS = {
  SUBMISSION_RECEIVED: 'submission-received',
  GITHUB_FETCH_START: 'github-fetch-start',
  GITHUB_FETCH_COMPLETE: 'github-fetch-complete',
  UPLOAD_START: 'upload-start',
  UPLOAD_COMPLETE: 'upload-complete',
  DOWNLOAD_START: 'download-start',
  DOWNLOAD_COMPLETE: 'download-complete',
  CLAUDE_START: 'claude-start',
  CLAUDE_COMPLETE: 'claude-complete',
  JUDGE_CALL_START: 'judge-call-start',
  JUDGE_CALL_COMPLETE: 'judge-call-complete',
  ERROR: 'error',
};

function makeLogger(name) {
  fs.mkdirSync(PATHS.logs, { recursive: true });
  const file = path.join(PATHS.logs, `${name}.jsonl`);
  const dest = pino.destination({ dest: file, sync: false, mkdir: true });
  return pino(
    {
      name,
      base: { agentId: name },
      timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    },
    dest,
  );
}

// Returns a closure that, when called, returns the elapsed milliseconds since
// the timer was started. Use to populate `durationMs` on *-complete events.
function startTimer() {
  const t0 = Date.now();
  return () => Date.now() - t0;
}

module.exports = { makeLogger, startTimer, EVENTS };
