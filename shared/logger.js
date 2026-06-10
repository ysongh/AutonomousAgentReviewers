const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { PATHS } = require('./config');

// Canonical event vocabulary the dashboard depends on. Every log entry the
// dashboard renders must carry one of these in its `event` field. See
// CLAUDE.md "Log event shape" for the full schema contract.
const EVENTS = {
  SUBMISSION_STARTED: 'submission-started',
  SUBMISSION_RECEIVED: 'submission-received',
  GITHUB_FETCH_START: 'github-fetch-start',
  GITHUB_FETCH_COMPLETE: 'github-fetch-complete',
  UPLOAD_START: 'upload-start',
  UPLOAD_COMPLETE: 'upload-complete',
  DOWNLOAD_START: 'download-start',
  DOWNLOAD_COMPLETE: 'download-complete',
  CLAUDE_START: 'claude-start',
  CLAUDE_COMPLETE: 'claude-complete',
  CLAUDE_REVISE_START: 'claude-revise-start',
  CLAUDE_REVISE_COMPLETE: 'claude-revise-complete',
  JUDGE_CALL_START: 'judge-call-start',
  JUDGE_CALL_COMPLETE: 'judge-call-complete',
  REVISE_CALL_START: 'revise-call-start',
  REVISE_CALL_COMPLETE: 'revise-call-complete',
  PANEL_AGGREGATE_START: 'panel-aggregate-start',
  PANEL_AGGREGATE_COMPLETE: 'panel-aggregate-complete',
  JUDGE_ABSTAIN_BY_CHOICE: 'judge-abstain-by-choice',
  JUDGE_ABSTAIN_DUE_TO_FAILURE: 'judge-abstain-due-to-failure',
  // Demo Judge (Phase 2). Filecoin video upload happens on intake; the
  // multimodal review happens on judge-demo (port 4006).
  FILECOIN_UPLOAD_START: 'filecoin-upload-start',
  FILECOIN_UPLOAD_COMPLETE: 'filecoin-upload-complete',
  DEMO_REVIEW_START: 'demo-review-start', // intake -> judge-demo hop lifecycle
  DEMO_REVIEW_COMPLETE: 'demo-review-complete',
  DEMO_VIDEO_DOWNLOAD_START: 'demo-video-download-start', // judge-demo fetches the mp4 over HTTP
  DEMO_VIDEO_DOWNLOAD_COMPLETE: 'demo-video-download-complete',
  FRAMES_EXTRACT_COMPLETE: 'frames-extract-complete',
  TRANSCRIPT_COMPLETE: 'transcript-complete',
  CLAUDE_DEMO_START: 'claude-demo-start', // the one multimodal Claude call
  CLAUDE_DEMO_COMPLETE: 'claude-demo-complete',
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
