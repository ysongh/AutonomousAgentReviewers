// review-demo.js — AAR Demo Judge spike.
//   node review-demo.js <path-to.mp4>
// Pipeline: mp4 -> (A) keyframes + (B) transcript -> (C) one Claude multimodal
// call -> DemoVerdict JSON. Self-contained; NOT wired into the AAR pipeline.
//
// Stage A is implemented here. Stages B and C are added in subsequent steps.
import 'dotenv/config';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

const execFileP = promisify(execFile);
const ffprobePath = ffprobeStatic.path;

// --- HARD CONSTRAINTS (do not change) ---------------------------------------
const MAX_FRAMES = 14;       // hard cap, regardless of video length
const SECONDS_PER_FRAME = 15; // target 1 frame per ~15s, capped at MAX_FRAMES
const FRAME_WIDTH = 768;     // px wide, aspect preserved
const JPEG_QSCALE = 6;       // mjpeg qscale (2=best..31=worst); ~JPEG quality 80

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const FRAMES_DIR = here('./frames');

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

  console.log('\n(Stage A only — Stages B/C are added in the next steps.)');
}

main().catch((e) => {
  console.error('\n❌', e.message);
  process.exit(1);
});
