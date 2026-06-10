// review-demo.js — AAR Demo Judge spike.
//   node review-demo.js <path-to.mp4>
// Pipeline: mp4 -> (A) keyframes + (B) transcript -> (C) one Claude multimodal
// call -> DemoVerdict JSON. Self-contained; NOT wired into the AAR pipeline.
//
// Stage A is implemented here. Stages B and C are added in subsequent steps.
import 'dotenv/config';
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

const execFileP = promisify(execFile);
const ffprobePath = ffprobeStatic.path;

// --- HARD CONSTRAINTS (do not change) ---------------------------------------
const MAX_FRAMES = 14;       // hard cap, regardless of video length
const SECONDS_PER_FRAME = 15; // target 1 frame per ~15s, capped at MAX_FRAMES
const FRAME_WIDTH = 768;     // px wide, aspect preserved
const JPEG_QSCALE = 6;       // mjpeg qscale (2=best..31=worst); ~JPEG quality 80

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const FRAMES_DIR = here('./frames');
const AUDIO_PATH = here('./audio.mp3');

const WHISPER_MODEL = 'whisper-1';      // only model with verbose_json + timestamps
const WHISPER_USD_PER_MIN = 0.006;      // whisper-1 is billed by audio duration

const CLAUDE_MODEL = 'claude-sonnet-4-6'; // same model as the AAR judges
const CLAUDE_MAX_TOKENS = 1500;
// claude-sonnet-4-6 list price (USD per token) for the cost estimate.
const CLAUDE_USD_PER_INPUT_TOKEN = 3 / 1_000_000;
const CLAUDE_USD_PER_OUTPUT_TOKEN = 15 / 1_000_000;

const SYSTEM_PROMPT = `You are a judge on a hackathon panel, reviewing a DEMO VIDEO of a submission.
You are given keyframes sampled evenly across the video (each labeled with its timestamp) and the timestamped narration transcript.

Evaluate three things:
(a) Does the video DEMONSTRATE working functionality (something actually running/shown), versus only describing it?
(b) Is what is SHOWN on screen consistent with what is CLAIMED in the narration? Flag gaps between promise and delivery.
(c) Demo coherence and clarity.

Be specific and cite timestamps (MM:SS) for every observation. A frame is a still sampled at that timestamp; reason about what it depicts together with the narration around that time. Do not invent details you cannot see in a frame or read in the transcript. Calibrate the score 0-10 honestly: a polished slide-deck narration with no live functionality shown is not the same as a working demo.`;

const VERDICT_TOOL = {
  name: 'submit_demo_verdict',
  description: 'Submit the structured verdict for the demo video.',
  input_schema: {
    type: 'object',
    properties: {
      score: { type: 'integer', minimum: 0, maximum: 10, description: 'Overall demo quality, 0-10.' },
      reasoning: { type: 'string', description: '2-4 sentences justifying the score.' },
      evidence: {
        type: 'array',
        minItems: 3,
        description: 'At least 3 concrete observations, each tied to a timestamp.',
        items: {
          type: 'object',
          properties: {
            timestamp: { type: 'string', description: 'MM:SS into the video.' },
            observation: { type: 'string' },
          },
          required: ['timestamp', 'observation'],
        },
      },
      claims_check: {
        type: 'array',
        description: 'Narration claims checked against what is actually shown.',
        items: {
          type: 'object',
          properties: {
            claim: { type: 'string' },
            verdict: { type: 'string', enum: ['shown', 'asserted-only', 'contradicted'] },
            timestamp: { type: ['string', 'null'], description: 'MM:SS or null.' },
          },
          required: ['claim', 'verdict', 'timestamp'],
        },
      },
    },
    required: ['score', 'reasoning', 'evidence', 'claims_check'],
  },
};

function mmss(seconds) {
  const s = Math.round(seconds);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// Run a binary, fail loud with stderr on nonzero exit.
async function run(bin, args) {
  try {
    const { stdout } = await execFileP(bin, args, { maxBuffer: 1 << 26 });
    return stdout;
  } catch (e) {
    throw new Error(`${bin} failed: ${e.stderr || e.message}`);
  }
}

async function verifyTooling() {
  if (!ffmpegPath || !existsSync(ffmpegPath)) throw new Error(`ffmpeg binary missing (ffmpeg-static path: ${ffmpegPath}). Run pnpm install with the build allowlist.`);
  if (!ffprobePath || !existsSync(ffprobePath)) throw new Error(`ffprobe binary missing (ffprobe-static path: ${ffprobePath}).`);
}

async function probeDuration(mp4) {
  const out = await run(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', mp4]);
  const dur = parseFloat(out.trim());
  if (!Number.isFinite(dur) || dur <= 0) throw new Error(`Could not read a valid duration from ffprobe (got "${out.trim()}").`);
  return dur;
}

// STAGE A — extract <=14 evenly-spaced frames, 768px wide, recording timestamps.
async function extractFrames(mp4) {
  const t0 = Date.now();
  const duration = await probeDuration(mp4);
  const n = Math.min(MAX_FRAMES, Math.ceil(duration / SECONDS_PER_FRAME));

  // fresh frames dir
  rmSync(FRAMES_DIR, { recursive: true, force: true });
  mkdirSync(FRAMES_DIR, { recursive: true });

  const frames = [];
  for (let i = 0; i < n; i++) {
    const t = (duration * (i + 0.5)) / n; // evenly-spaced midpoints
    const file = `${FRAMES_DIR}/frame-${String(i + 1).padStart(2, '0')}.jpg`;
    // -ss before -i: fast AND accurate seek (ffmpeg decodes keyframe->target).
    await run(ffmpegPath, ['-y', '-ss', t.toFixed(3), '-i', mp4, '-frames:v', '1', '-vf', `scale=${FRAME_WIDTH}:-2`, '-q:v', String(JPEG_QSCALE), file]);
    if (!existsSync(file)) throw new Error(`Frame ${i + 1} was not written (t=${t.toFixed(1)}s).`);
    frames.push({ index: i + 1, t, label: mmss(t), file, bytes: statSync(file).size });
  }

  const stageMs = Date.now() - t0;
  return { duration, n, frames, stageMs };
}

// STAGE B — rip 16kHz mono audio, transcribe with whisper-1 + segment timestamps.
async function transcribe(mp4) {
  const t0 = Date.now();
  // -vn drop video, -ac 1 mono, -ar 16000 16kHz: small file, well under Whisper's 25MB cap.
  rmSync(AUDIO_PATH, { force: true });
  await run(ffmpegPath, ['-y', '-i', mp4, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', AUDIO_PATH]);
  if (!existsSync(AUDIO_PATH)) throw new Error('Audio extraction produced no file.');
  const audioBytes = statSync(AUDIO_PATH).size;
  if (audioBytes > 25 * 1024 * 1024) throw new Error(`Audio is ${(audioBytes / 1048576).toFixed(1)}MB, over Whisper's 25MB limit.`);

  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing in .env.');
  const openai = new OpenAI();
  const resp = await openai.audio.transcriptions.create({
    file: createReadStream(AUDIO_PATH),
    model: WHISPER_MODEL,
    response_format: 'verbose_json',
    timestamp_granularities: ['segment'],
  });

  const segments = resp.segments ?? [];
  const text = resp.text ?? '';
  const audioSeconds = resp.duration ?? 0;
  const costUsd = (audioSeconds / 60) * WHISPER_USD_PER_MIN;
  const stageMs = Date.now() - t0;
  return { text, segments, audioSeconds, audioBytes, costUsd, language: resp.language, stageMs };
}

// STAGE C — ONE Claude multimodal call (forced tool_use) -> DemoVerdict.
async function reviewWithClaude(frames, transcript) {
  const t0 = Date.now();
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY missing in .env.');

  const transcriptText = transcript.segments.length
    ? transcript.segments.map((s) => `[${mmss(s.start)}] ${s.text.trim()}`).join('\n')
    : transcript.text;

  // Build one user message: intro -> 14×(label + image) -> transcript -> repo context.
  const content = [
    { type: 'text', text: `This is a hackathon demo video. Below are ${frames.length} keyframes sampled evenly across the video, each preceded by its timestamp, followed by the timestamped narration transcript. Review the demo and submit your verdict using the submit_demo_verdict tool.` },
  ];
  for (const f of frames) {
    content.push({ type: 'text', text: `Frame ${f.index} — t=${f.label}` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: readFileSync(f.file).toString('base64') } });
  }
  content.push({ type: 'text', text: `TRANSCRIPT (timestamped narration):\n${transcriptText}` });
  content.push({ type: 'text', text: 'REPO CONTEXT: (none in this spike — in production this will contain the SubmissionRecord summary)' });

  const anthropic = new Anthropic();
  const resp = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: CLAUDE_MAX_TOKENS,
    system: SYSTEM_PROMPT,
    tools: [VERDICT_TOOL],
    tool_choice: { type: 'tool', name: VERDICT_TOOL.name }, // forced
    messages: [{ role: 'user', content }],
  });

  const toolUse = resp.content.find((b) => b.type === 'tool_use' && b.name === VERDICT_TOOL.name);
  if (!toolUse) throw new Error(`Claude did not return a ${VERDICT_TOOL.name} tool_use block (stop_reason=${resp.stop_reason}).`);

  const stageMs = Date.now() - t0;
  return { verdict: toolUse.input, usage: resp.usage, stopReason: resp.stop_reason, model: resp.model, stageMs };
}

async function main() {
  const mp4 = process.argv[2];
  if (!mp4) throw new Error('Usage: node review-demo.js <path-to.mp4>');
  if (!existsSync(mp4)) throw new Error(`File not found: ${mp4}`);
  await verifyTooling();

  console.log(`Input: ${mp4} (${(statSync(mp4).size / 1048576).toFixed(2)} MB)`);
  console.log(`ffmpeg : ${ffmpegPath}`);
  console.log(`ffprobe: ${ffprobePath}\n`);

  // --- Stage A ---
  const a = await extractFrames(mp4);
  console.log(`=== Stage A — frames ===`);
  console.log(`  duration   : ${a.duration.toFixed(1)}s (${mmss(a.duration)})`);
  console.log(`  frames     : ${a.n} (cap ${MAX_FRAMES})`);
  for (const f of a.frames) console.log(`    frame ${String(f.index).padStart(2)} @ t=${f.label} — ${(f.bytes / 1024).toFixed(1)} KB`);
  const totalKB = a.frames.reduce((s, f) => s + f.bytes, 0) / 1024;
  console.log(`  total      : ${totalKB.toFixed(1)} KB across ${a.n} frames`);
  console.log(`  wall-clock : ${(a.stageMs / 1000).toFixed(1)}s`);

  // --- Stage B ---
  const b = await transcribe(mp4);
  console.log(`\n=== Stage B — transcript ===`);
  console.log(`  audio      : ${(b.audioBytes / 1024).toFixed(1)} KB, ${b.audioSeconds.toFixed(1)}s, lang=${b.language}`);
  console.log(`  segments   : ${b.segments.length}`);
  console.log(`  transcript : ${b.text.length} chars`);
  console.log(`  est. cost  : $${b.costUsd.toFixed(4)} (whisper-1 @ $${WHISPER_USD_PER_MIN}/min)`);
  console.log(`  wall-clock : ${(b.stageMs / 1000).toFixed(1)}s`);
  console.log(`  --- first 3 segments ---`);
  for (const s of b.segments.slice(0, 3)) console.log(`    [${mmss(s.start)}–${mmss(s.end)}] ${s.text.trim()}`);

  // --- Stage C ---
  const c = await reviewWithClaude(a.frames, b);
  const inTok = c.usage.input_tokens;
  const outTok = c.usage.output_tokens;
  const claudeCost = inTok * CLAUDE_USD_PER_INPUT_TOKEN + outTok * CLAUDE_USD_PER_OUTPUT_TOKEN;
  console.log(`\n=== Stage C — Claude verdict ===`);
  console.log(`  model        : ${c.model}`);
  console.log(`  stop_reason  : ${c.stopReason}`);
  console.log(`  INPUT TOKENS : ${inTok}   <-- headline (30K tokens/min budget)`);
  console.log(`  output tokens: ${outTok}`);
  console.log(`  fits 30K/min : ${inTok < 30000 ? `YES (${(30000 - inTok)} headroom, ${(inTok / 30000 * 100).toFixed(0)}% of window)` : 'NO'}`);
  console.log(`  est. cost    : $${claudeCost.toFixed(4)} (Claude) + $${b.costUsd.toFixed(4)} (Whisper) = $${(claudeCost + b.costUsd).toFixed(4)}/review`);
  console.log(`  wall-clock   : ${(c.stageMs / 1000).toFixed(1)}s`);

  // --- Output ---
  const out = {
    source: mp4,
    generatedAt: new Date().toISOString(),
    model: c.model,
    usage: { input_tokens: inTok, output_tokens: outTok },
    stages: {
      frames: { count: a.n, durationSec: a.duration, wallClockMs: a.stageMs },
      transcript: { segments: b.segments.length, chars: b.text.length, audioSeconds: b.audioSeconds, costUsd: b.costUsd, wallClockMs: b.stageMs },
      claude: { wallClockMs: c.stageMs, costUsd: claudeCost },
    },
    frameTimestamps: a.frames.map((f) => ({ index: f.index, t: f.label })),
    verdict: c.verdict,
  };
  const outPath = here(`./verdict-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n=== DemoVerdict ===`);
  console.log(JSON.stringify(c.verdict, null, 2));
  const totalMs = a.stageMs + b.stageMs + c.stageMs;
  console.log(`\nTotal wall-clock: ${(totalMs / 1000).toFixed(1)}s  |  Written: ${outPath}`);
}

main().catch((e) => {
  console.error('\n❌', e.message);
  process.exit(1);
});
