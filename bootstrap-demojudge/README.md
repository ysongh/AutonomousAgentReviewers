# bootstrap-demojudge — Demo Judge spike (Phase 1)

Phase 1 spike for the proposed **Demo Judge** feature: prove the multimodal
review pipeline in **complete isolation**.

```
mp4 in → (A) keyframes + (B) transcript → (C) ONE Claude multimodal call → DemoVerdict JSON
```

No agents, no Filecoin, no 0G, no pipeline integration. Self-contained — own
`package.json`, own `node_modules/`, own `.env`. **Spike only — NOT wired into
the AAR pipeline.** (Phase 0, `bootstrap-filecoin/`, proved Filecoin Warm
Storage round-trips video; this phase proves the genuinely new primitive: an
LLM producing a structured verdict about a demo video.)

## The headline question

The org has a **30K tokens/min Anthropic rate limit** (already hit once). The
Demo Judge is deliberately sequenced **after round 1** so it gets its own rate
window. The critical measurement of this spike is the **input token count of
the single Claude call** — does one Demo Judge review fit inside the 30K/min
budget with comfortable margin? (Measured: **TBD** — filled in after the run.)

## Findings so far (the inspect-don't-assume discipline)

- **Whisper model choice (Stage B):** must use **`model: 'whisper-1'`** with
  `response_format: 'verbose_json'` + `timestamp_granularities: ['segment']`.
  The `openai` SDK's own example uses `gpt-4o-transcribe`, but that model (and
  `gpt-4o-mini-transcribe`) **only support `json` and return no timestamps** —
  unusable here, since the verdict's `evidence` cites `MM:SS`. The older model
  is the correct one. whisper-1 is billed by **audio duration** ($0.006/min),
  so its cost is derivable from `duration` with no token accounting.
- **pnpm build-script sandbox:** `ffmpeg-static`'s postinstall (which downloads
  the actual ffmpeg binary) is **silently skipped** by pnpm until the package
  is allowlisted in `package.json`'s `pnpm.onlyBuiltDependencies`. Without it,
  the exported binary path points at a missing file.
- **SDK version drift:** pre-seeded dependency ranges pulled stale majors
  (`openai` v4, `@anthropic-ai/sdk` v0.40). Forced to current: **openai
  6.42.0**, **@anthropic-ai/sdk 0.102.0**.
- **ffmpeg is vendored, not installed:** `ffmpeg-static` (ffmpeg 6.1.1) +
  `ffprobe-static` (ffprobe 4.0.2) live in `node_modules`; nothing touches the
  system. For production the Demo Judge would more likely install ffmpeg in the
  container image (`apt-get install ffmpeg`) — but that's a one-line swap of the
  binary path; the spike code just spawns an ffmpeg path. Not an architecture
  commitment.

## Setup

```bash
cd bootstrap-demojudge
pnpm install                 # installs SDKs + vendored ffmpeg/ffprobe
                             # (package.json allowlists ffmpeg-static's build)

cp .env.example .env         # then fill in:
#   OPENAI_API_KEY=...       (Whisper, Stage B)
#   ANTHROPIC_API_KEY=...    (Claude, Stage C — same key the AAR judges use)
```

A real demo video **with spoken narration** is required (a sine-tone test card
is unusable). The script takes its path as `argv[1]`.

## Usage

```bash
node review-demo.js /path/to/demo.mp4
```

Writes `verdict-<timestamp>.json` and pretty-prints the verdict to stdout.

## Pipeline stages (all inside `review-demo.js`)

| Stage | What it does | Key constraints |
|---|---|---|
| **A — frames** | `ffprobe` duration → `N = min(14, ceil(duration/15))` evenly-spaced frames at midpoints (`t_i = dur·(i+0.5)/N`), 768px wide (aspect preserved), JPEG (qscale 6 ≈ quality 80) into `frames/`, recording each frame's `MM:SS`. | **Hard cap 14 frames**, never exceeded regardless of length. |
| **B — transcript** | `ffmpeg` → 16 kHz mono audio → OpenAI `whisper-1` `verbose_json` with segment timestamps. | Whisper 25 MB file limit; 16 kHz mono keeps us well under. |
| **C — verdict** | ONE Claude call (`claude-sonnet-4-6`, same model as the judges): intro text → 14×(text `"Frame N — t=MM:SS"` + base64 image) → transcript → `REPO CONTEXT` placeholder. Forced `tool_choice` on `submit_demo_verdict`. Capture `usage.input_tokens`/`output_tokens` exactly. | **ONE call, no retries, no multi-pass.** |

`submit_demo_verdict` schema: `score` (int 0–10), `reasoning` (2–4 sentences),
`evidence` (≥3 × `{ timestamp: "MM:SS", observation }`), `claims_check`
(`{ claim, verdict: "shown"|"asserted-only"|"contradicted", timestamp }`).

> **Status:** Stage A implemented and runnable; Stages B and C are added in
> subsequent steps. Sections below are filled in as stages complete.

## Results (TBD)

| Metric | Value |
|---|---|
| Test video (duration / size) | TBD |
| Stage A wall-clock | TBD |
| Frames extracted / total KB | TBD |
| Stage B wall-clock / transcript chars | TBD |
| Stage C wall-clock | TBD |
| Total wall-clock | TBD |
| **Claude `input_tokens`** | **TBD** |
| Claude `output_tokens` | TBD |
| Fits 30K/min window? | TBD |
| Est. per-review cost (Whisper + Claude) | TBD |

### Quality spot-check (TBD)

Three `evidence` timestamps verified against the actual video frame + transcript:
TBD.

## Phase 2 architecture notes (TBD)

Filled in after the run — async vs. synchronous placement, rate-window
sequencing, frame budget tuning, ffmpeg deployment.
