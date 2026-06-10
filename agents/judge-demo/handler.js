// handler.js — judge-demo's review() pipeline. Same shape as the other judges
// (download SubmissionRecord from 0G -> reason -> upload verdict to 0G with this
// agent's own wallet), but the reasoning is multimodal and the input is a video
// pulled over plain HTTP from Filecoin Warm Storage.
//
//   review({ submissionRootHash, submissionId })
//     -> downloadJSON(submissionRootHash)  (0G; zod SubmissionRecord)
//     -> 400 if demoVideoRetrievalUrl is null (intake must not call without a video)
//     -> HTTP-stream the mp4 to a temp file (150MB cap, never buffered in memory)
//     -> Stage A: ffprobe duration -> min(14, ceil(dur/15)) frames @768px
//     -> Stage B: ffmpeg 16kHz mono -> whisper-1 timestamped transcript
//     -> Stage C: ONE forced-tool_use Claude call (reused via shared callJudge)
//     -> DemoVerdict -> zod-validate -> uploadJSON(0G) -> { demoVerdictRootHash }
//
// JSON verdict goes to 0G; Filecoin holds ONLY the video. The demo judge NEVER
// imports @filoz/synapse-sdk — it only does an HTTP GET against retrievalUrl.
// Temp files (video + frames + audio) are cleaned in a finally block.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
let OpenAI = require('openai');
OpenAI = OpenAI.default || OpenAI; // openai v6 ships CJS with a default export

const { uploadJSON, downloadJSON } = require('aar-shared/og-storage');
const { callJudge } = require('aar-shared/claude');
const { SubmissionRecord, DemoVerdict } = require('aar-shared/schemas');
const { AGENT_IDS } = require('aar-shared/config');
const { EVENTS, startTimer } = require('aar-shared/logger');
const { SYSTEM, DEMO_VERDICT_TOOL_SCHEMA, buildUserContent } = require('./prompt');

const execFileP = promisify(execFile);
const AGENT_ID = AGENT_IDS.judgeDemo;

// --- HARD CONSTRAINTS (ported verbatim from the spike — do not change) -------
const MAX_FRAMES = 14;        // hard cap, regardless of video length
const SECONDS_PER_FRAME = 15; // ~1 frame / 15s, capped at MAX_FRAMES
const FRAME_WIDTH = 768;      // px wide, aspect preserved
const JPEG_QSCALE = 6;        // mjpeg qscale (2=best..31=worst); ~JPEG quality 80
const WHISPER_MODEL = 'whisper-1'; // only model with verbose_json + segment timestamps
const CLAUDE_MAX_TOKENS = 1500;    // spike output peaked ~1009 tokens
const MAX_VIDEO_BYTES = 150 * 1024 * 1024; // 150MB cap on the downloaded video
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;  // Whisper hard file limit

function mmss(seconds) {
  const s = Math.round(seconds);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

async function run(bin, args) {
  try {
    const { stdout } = await execFileP(bin, args, { maxBuffer: 1 << 26 });
    return stdout;
  } catch (e) {
    throw new Error(`${bin} failed: ${e.stderr || e.message}`);
  }
}

function verifyTooling() {
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
    throw new Error(`ffmpeg binary missing (ffmpeg-static path: ${ffmpegPath}). Run pnpm install with the build allowlist.`);
  }
  if (!ffprobePath || !fs.existsSync(ffprobePath)) {
    throw new Error(`ffprobe binary missing (ffprobe-static path: ${ffprobePath}).`);
  }
}

// Stream the video to disk. Never buffers the whole file in memory; aborts as
// soon as the running byte count exceeds the cap (also rejects up front on a
// too-large content-length).
async function downloadVideo(url, destPath) {
  const resp = await fetch(url);
  if (!resp.ok || !resp.body) {
    throw new Error(`video download failed: HTTP ${resp.status} from ${url}`);
  }
  const declared = Number(resp.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_VIDEO_BYTES) {
    throw new Error(`video too large: content-length ${declared} bytes exceeds ${MAX_VIDEO_BYTES} cap`);
  }

  let received = 0;
  const out = fs.createWriteStream(destPath);
  const counter = new (require('stream').Transform)({
    transform(chunk, _enc, cb) {
      received += chunk.length;
      if (received > MAX_VIDEO_BYTES) {
        cb(new Error(`video exceeded ${MAX_VIDEO_BYTES} byte cap mid-stream`));
        return;
      }
      cb(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(resp.body), counter, out);
  return received;
}

// STAGE A — extract <=14 evenly-spaced frames, 768px wide, recording timestamps.
async function extractFrames(mp4, framesDir) {
  const out = await run(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', mp4]);
  const duration = parseFloat(out.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Could not read a valid duration from ffprobe (got "${out.trim()}").`);
  }
  const n = Math.min(MAX_FRAMES, Math.ceil(duration / SECONDS_PER_FRAME));

  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });

  const frames = [];
  for (let i = 0; i < n; i++) {
    const t = (duration * (i + 0.5)) / n; // evenly-spaced midpoints
    const file = path.join(framesDir, `frame-${String(i + 1).padStart(2, '0')}.jpg`);
    // -ss before -i: fast AND accurate seek (ffmpeg decodes keyframe->target).
    await run(ffmpegPath, ['-y', '-ss', t.toFixed(3), '-i', mp4, '-frames:v', '1', '-vf', `scale=${FRAME_WIDTH}:-2`, '-q:v', String(JPEG_QSCALE), file]);
    if (!fs.existsSync(file)) throw new Error(`Frame ${i + 1} was not written (t=${t.toFixed(1)}s).`);
    frames.push({ index: i + 1, label: mmss(t), file });
  }
  return { duration, frames };
}

// STAGE B — rip 16kHz mono audio, transcribe with whisper-1 + segment timestamps.
async function transcribe(mp4, audioPath) {
  // -vn drop video, -ac 1 mono, -ar 16000 16kHz: small file, well under 25MB.
  fs.rmSync(audioPath, { force: true });
  await run(ffmpegPath, ['-y', '-i', mp4, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', audioPath]);
  if (!fs.existsSync(audioPath)) throw new Error('Audio extraction produced no file.');
  const audioBytes = fs.statSync(audioPath).size;
  if (audioBytes > MAX_AUDIO_BYTES) {
    throw new Error(`Audio is ${(audioBytes / 1048576).toFixed(1)}MB, over Whisper's 25MB limit.`);
  }

  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing in environment.');
  const openai = new OpenAI();
  const resp = await openai.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: WHISPER_MODEL,
    response_format: 'verbose_json',
    timestamp_granularities: ['segment'],
  });

  const segments = resp.segments ?? [];
  const text = resp.text ?? '';
  const transcriptText = segments.length
    ? segments.map((s) => `[${mmss(s.start)}] ${s.text.trim()}`).join('\n')
    : text;
  return { transcriptText, segmentCount: segments.length, chars: text.length, audioSeconds: resp.duration ?? 0 };
}

async function review({ submissionRootHash, submissionId }, { logger, signer }) {
  if (!submissionRootHash || !submissionId) {
    throw new Error('submissionRootHash and submissionId are required');
  }
  if (!signer) throw new Error('judge-demo handler requires a signer');
  verifyTooling();

  logger.info({ event: EVENTS.SUBMISSION_RECEIVED, submissionId, rootHash: submissionRootHash });

  const raw = await downloadJSON(submissionRootHash, { logger, submissionId });
  const submission = SubmissionRecord.parse(raw);
  if (submission.submissionId !== submissionId) {
    throw new Error(
      `submissionId mismatch: handler got ${submissionId}, record has ${submission.submissionId}`,
    );
  }
  if (!submission.demoVideoRetrievalUrl || !submission.demoVideoPieceCid) {
    // Caller bug: intake must not route a video-less submission to the demo judge.
    throw badRequest('SubmissionRecord has no demoVideoRetrievalUrl/demoVideoPieceCid — nothing to review');
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aar-demo-'));
  const videoPath = path.join(workDir, 'video.mp4');
  const audioPath = path.join(workDir, 'audio.mp3');
  const framesDir = path.join(workDir, 'frames');

  try {
    // --- download video over HTTP from Filecoin retrievalUrl ---
    const dlTimer = startTimer();
    logger.info({ event: EVENTS.DEMO_VIDEO_DOWNLOAD_START, submissionId, pieceCid: submission.demoVideoPieceCid });
    const videoBytes = await downloadVideo(submission.demoVideoRetrievalUrl, videoPath);
    logger.info({
      event: EVENTS.DEMO_VIDEO_DOWNLOAD_COMPLETE,
      submissionId,
      sizeBytes: videoBytes,
      durationMs: dlTimer(),
    });

    // --- Stage A: frames ---
    const a = await extractFrames(videoPath, framesDir);
    logger.info({
      event: EVENTS.FRAMES_EXTRACT_COMPLETE,
      submissionId,
      frames: a.frames.length,
      videoSeconds: a.duration,
    });

    // --- Stage B: transcript ---
    const b = await transcribe(videoPath, audioPath);
    logger.info({
      event: EVENTS.TRANSCRIPT_COMPLETE,
      submissionId,
      segments: b.segmentCount,
      chars: b.chars,
      audioSeconds: b.audioSeconds,
    });

    // --- Stage C: ONE multimodal Claude call (reuse shared callJudge) ---
    const frameBlocks = a.frames.map((f) => ({
      index: f.index,
      label: f.label,
      dataBase64: fs.readFileSync(f.file).toString('base64'),
    }));
    const userContent = buildUserContent({ submission, frames: frameBlocks, transcriptText: b.transcriptText });

    const claudeTimer = startTimer();
    logger.info({ event: EVENTS.CLAUDE_DEMO_START, submissionId, frames: frameBlocks.length });
    const { input, usage, model } = await callJudge({
      system: SYSTEM,
      user: userContent,
      schema: DEMO_VERDICT_TOOL_SCHEMA,
      maxTokens: CLAUDE_MAX_TOKENS,
      toolName: 'submit_demo_verdict',
      toolDescription: 'Submit the structured verdict for the demo video.',
    });
    logger.info({ event: EVENTS.CLAUDE_DEMO_COMPLETE, submissionId, model, usage, durationMs: claudeTimer() });

    // --- build + validate + upload DemoVerdict (to 0G, judge-demo's wallet) ---
    const verdict = DemoVerdict.parse({
      agentId: AGENT_ID,
      submissionId: submission.submissionId,
      score: input.score,
      reasoning: input.reasoning,
      evidence: input.evidence,
      claims_check: input.claims_check,
      videoPieceCid: submission.demoVideoPieceCid,
      producedAt: new Date().toISOString(),
    });

    const { rootHash: demoVerdictRootHash } = await uploadJSON(verdict, signer, { logger, submissionId });
    return { demoVerdictRootHash };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

module.exports = { review, AGENT_ID };
