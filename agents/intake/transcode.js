// transcode.js — intake's video normalization stage (Phase 3). ONE ffmpeg pass
// turns an arbitrary user upload into a normalized mp4 that sits in the
// empirically reliable small-upload band on Filecoin Calibration (see the
// "Filecoin large-upload flaky" footgun: 87MB pieces failed mid-transfer twice,
// a 3MB re-encode succeeded).
//
// Target: 720p MAX height — lossless for the demo judge, which extracts
// 768px-WIDE keyframes; H.264 video capped ~1.5Mbps; AAC audio ~96kbps (audio is
// KEPT — Whisper needs the narration); +faststart so the moov atom is at the
// front for the demo judge's plain-HTTP range fetch.
//
// ONE attempt, no retry. On any ffmpeg failure the caller degrades to no-video
// (the panel is never blocked). ffmpeg is vendored via ffmpeg-static, which pnpm
// only downloads when allowlisted in package.json's pnpm.onlyBuiltDependencies.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const ffmpegPath = require('ffmpeg-static');

const execFileP = promisify(execFile);

function verifyTooling() {
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
    throw new Error(
      `ffmpeg binary missing (ffmpeg-static path: ${ffmpegPath}). ` +
        'Run pnpm install with ffmpeg-static allowlisted in pnpm.onlyBuiltDependencies.',
    );
  }
}

// Transcode inputPath -> a fresh temp mp4. Returns { outputPath, inputBytes,
// outputBytes }. The caller owns cleanup of BOTH the input and outputPath.
async function transcodeVideo(inputPath) {
  verifyTooling();
  const inputBytes = fs.statSync(inputPath).size;
  const outputPath = path.join(
    os.tmpdir(),
    `aar-intake-transcode-${Date.now()}-${process.pid}.mp4`,
  );

  // scale fits the video inside a 1280x720 box, preserving aspect, never
  // upscaling (force_original_aspect_ratio=decrease), with even dimensions
  // (force_divisible_by=2 — x264 requires even w/h). min() commas are protected
  // by single quotes, which ffmpeg's own filtergraph parser honors (execFile
  // passes args literally, no shell). -preset veryfast keeps the single pass fast.
  const args = [
    '-y',
    '-i', inputPath,
    '-vf', "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
    '-c:v', 'libx264', '-preset', 'veryfast',
    '-b:v', '1500k', '-maxrate', '1500k', '-bufsize', '3000k',
    '-c:a', 'aac', '-b:a', '96k',
    '-movflags', '+faststart',
    outputPath,
  ];

  try {
    await execFileP(ffmpegPath, args, { maxBuffer: 1 << 26 });
  } catch (e) {
    fs.rmSync(outputPath, { force: true });
    throw new Error(`ffmpeg transcode failed: ${e.stderr || e.message}`);
  }
  if (!fs.existsSync(outputPath)) {
    throw new Error('ffmpeg transcode produced no output file');
  }
  const outputBytes = fs.statSync(outputPath).size;
  return { outputPath, inputBytes, outputBytes };
}

module.exports = { transcodeVideo };
