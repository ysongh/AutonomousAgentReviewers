# Autonomous Agent Reviewers (AAR)

A swarm of AI judge agents that peer-review hackathon submissions, coordinating
via 0G Storage on the 0G Galileo testnet (chainId 16602).

## Layout

- `react/` — Vite + React 19 + TS dashboard (Phase 2). Consumes the
  log-streamer's SSE feed for live agent activity and POSTs submissions
  to intake. Uses `react-router-dom` for routing (`/` dashboard,
  `/agents` per-agent detail). No UI lib, no state lib — plain CSS plus
  hooks; the surface is small enough that a framework would be overhead.
  Has its own `package.json` and uses `pnpm`. Standalone — does not
  share `node_modules` with the agents.
- `bootstrap/` — Throwaway Day-1 sanity check that proves 0G Storage
  upload/download works on this machine. Self-contained: own `package.json`,
  own `node_modules`, own `.env`. Not imported by anything else and not part
  of the final architecture. See `bootstrap/README.md`.
- `shared/` — Common modules used by every agent: `og-storage.js` (the
  productionized 0G workaround — see below), `schemas.js` (zod), `claude.js`
  (Anthropic wrapper), `github.js` (Octokit wrapper), `logger.js` (pino →
  `logs/<agent>.jsonl`), `config.js` (ports, agent IDs). Has its own
  `package.json`. Agents depend on it via `"aar-shared": "link:../../shared"`
  (pnpm's `link:` protocol — log-streamer uses `link:../shared`). This makes
  `node_modules/aar-shared` a real symlink to the live `shared/` directory,
  so edits to `shared/*.js` are picked up on the next process restart with
  no reinstall needed. **No pnpm workspaces, no monorepo config** — each
  subproject installs independently.

  **Do NOT use the `file:` protocol with pnpm.** pnpm snapshots `file:` deps
  into a frozen copy under `.pnpm/`, which means edits to `shared/` are
  invisible until you reinstall every dependent package. We learned this
  the hard way on Day 3.
- `agents/<name>/` — One Express process per agent, own `package.json`, own
  `node_modules/`. Agents do NOT pass payload data over HTTP — only root
  hashes. The actual `SubmissionRecord` / `JudgeVerdict` payloads live on 0G
  Storage. Validate every read AND every write against the zod schemas.
  Phase 1 agents: `intake` (4001), `judge-technical` (4002),
  `judge-originality` (4003), `judge-skeptic` (4004). Ports + URLs are
  centralized in `shared/config.js` (`PORTS`, `AGENT_IDS`, `JUDGE_URLS`).
- `log-streamer/` — Sibling service (NOT under `agents/`) on port 4100.
  Tails `logs/*.jsonl` via chokidar and exposes a Server-Sent Events feed
  the dashboard will consume. Has its own `package.json` and `node_modules/`
  with `aar-shared` symlinked the same way the agents do it.
- `scripts/` — CLI entry points (`start-all.sh`, `submit.js`).
- `logs/` — Runtime JSONL per agent. Gitignored. The eventual dashboard
  data source.
- Root `package.json` — leave alone. No monorepo config, no workspaces. Each
  real subproject gets its own `package.json`.

## 0G I/O — use shared/og-storage.js, not bootstrap/

`bootstrap/upload.js` was the proof of concept. The productionized version
lives in `shared/og-storage.js` and exposes `uploadJSON(obj)` /
`downloadJSON(rootHash)`. **All real code must use it.** Don't re-port the
workaround into another file — fix it in one place.

Smoke test (Day 2): `node shared/smoke.js` round-trips a small JSON payload.
Upload was ~10s end-to-end on Galileo; download ~1.5s. Tx fee for tiny
payloads is dominated by gas.

## 0G Storage SDK / contract footgun (important)

`@0glabs/0g-ts-sdk@0.3.3` (latest on npm) is **incompatible** with the deployed
flow contract on 0G Galileo testnet. The contract expects a wrapped struct:

```solidity
struct Submission { SubmissionData data; address submitter; }
```

with selector `0xbc8c11f8`. The SDK still calls the old un-wrapped selector
`0xef3e12dc`, so `Indexer.upload(...)` and `Uploader.uploadFile(...)` always
revert with `require(false)`.

**Workaround used in `bootstrap/upload.js`:** call `flow.submit(...)` directly
with raw ethers using the new ABI, then push segments via
`StorageNode.uploadSegmentsByTxSeq(...)`. The rest of the SDK is fine —
`MemData`, `MerkleTree` (`file.merkleTree()`), `file.createSubmission(...)`,
`Indexer.selectNodes(...)`, `Indexer.download(...)`, and the `Submit` event
ABI on `getFlowContract(...)` all work as-is.

When building the real upload path (outside `bootstrap/`), reuse this same
pattern — don't try `Indexer.upload` again expecting it to work.

## Judge agent pattern

Every judge agent follows the same shape:
- `prompt.js` — `SYSTEM` rubric, `buildUserPrompt(submission)`, and a JSON
  Schema for the tool that returns the verdict.
- `handler.js` — `downloadJSON(submissionRootHash)` → zod-validate
  `SubmissionRecord` → `callJudge({ system, user, schema })` →
  zod-validate `JudgeVerdict` → `uploadJSON(verdict)` → return `{ verdictRootHash }`.
- `index.js` — Express, `POST /judge { submissionRootHash, submissionId }`.

`shared/claude.js` forces structured output with Anthropic's tool use
(`tool_choice: { type: 'tool', name: 'submit_verdict' }`) instead of
regex-extracting JSON from prose. New judges should reuse `callJudge` and
just supply their own `schema` — don't re-prompt for "raw JSON only".

The three Day-3 judges share this pattern by **copy, not abstraction**.
Three near-identical folders is the right shape for the swarm — do not
refactor them into a generic judge factory. Differences live entirely in
`prompt.js`:
- `judge-technical` (port 4002) — code quality, architecture, completeness,
  documentation. Calibrated fairly across 0–10.
- `judge-originality` (port 4003) — novelty of idea/approach, plagiarism red
  flags. Has NO web access; uncertainty pulls scores toward the middle
  rather than fabricating matches.
- `judge-skeptic` (port 4004) — deliberately harsh; hunts promise-vs-delivery
  gaps, stubs, and overclaims. Calibrated to lean low when debating between
  two adjacent scores. Exists to balance the panel's average-case agreement
  bias.

All three return the same `JudgeVerdict` schema (`{ score: 0-10 integer,
reasoning, evidence: string[] }`). Tool_use is the contract — if Claude
fails to return valid tool input, fail loudly. Do not add prose-parsing
fallbacks.

## Inter-agent flow (the bus)

Day 3 pipeline — three judges in parallel, synchronous from the CLI's view:

```
CLI (scripts/submit.js)
  └─ POST :4001/submit { repoUrl }
       intake/handler.js
         ├─ Octokit fetchRepoMetadata(repoUrl)
         ├─ uploadJSON(SubmissionRecord)        →  submissionRootHash
         ├─ Promise.allSettled([
         │     POST :4002/judge { submissionRootHash, submissionId },  // technical
         │     POST :4003/judge { submissionRootHash, submissionId },  // originality
         │     POST :4004/judge { submissionRootHash, submissionId },  // skeptic
         │   ])
         │     each judge:
         │       ├─ downloadJSON(submissionRootHash) → SubmissionRecord (zod-validated)
         │       ├─ callJudge(...) → tool_use input
         │       └─ uploadJSON(JudgeVerdict) → verdictRootHash
         │   intake then downloads + zod-validates each returned verdict
         └─ respond { submissionId, submissionRootHash, verdicts, failures }
```

Response shape:
- `verdicts: Array<{ judgeId, verdictRootHash, verdict }>` — one entry per
  judge that succeeded. Verdict objects already match the `JudgeVerdict`
  zod schema.
- `failures: Array<{ judgeId, error }>` — one entry per judge that threw or
  returned an invalid response. Empty array on a clean run.

Rules that future agents must respect:
- HTTP bodies between agents carry **only** root hashes + the `submissionId`
  UUID. Never inline payload data.
- Every agent that reads from 0G zod-validates the result before using it.
  Every agent that writes to 0G zod-validates before calling `uploadJSON`.
- Both ends assert `submissionId` matches the on-0G record (mismatched IDs
  mean a wire is crossed — fail loudly, do not coerce).
- Intake fans out with `Promise.allSettled`, NOT `Promise.all`. Partial
  results beat total failure — one bad judge must not poison the run. Log
  the failure with an `error` event carrying `judgeId` and surface it in
  the `failures` array.
- Intake does NOT aggregate. It collects raw verdicts and returns them.
  Aggregation + deliberation is Day 4.
- Day 3 is synchronous (intake awaits all judges). Day 4 will go async via
  callbacks — when that happens, the contract above stays the same; only
  who-calls-whom changes.

## Running it (Day 3)

One-time setup — install in every subproject (the `link:` protocol points
each `node_modules/aar-shared` at the live `shared/` directory, so future
edits to `shared/` need no reinstall):
```
cd shared && pnpm install
cd ../agents/intake && pnpm install
cd ../judge-technical && pnpm install
cd ../judge-originality && pnpm install
cd ../judge-skeptic && pnpm install
cd ../../log-streamer && pnpm install
```
Add `ANTHROPIC_API_KEY`, `PRIVATE_KEY`, `RPC_URL`, `INDEXER_URL` to root
`.env`. `GITHUB_TOKEN` is optional but raises GitHub's anonymous rate limit.

Three terminals:
```
# terminal 1 — start all 5 services (4 agents + log-streamer)
./scripts/start-all.sh

# terminal 2 — tap the live SSE feed (optional; the dashboard will do this)
curl -N http://localhost:4100/events

# terminal 3 — submit a repo, get all three verdicts synchronously
node scripts/submit.js https://github.com/sindresorhus/is
```

`scripts/start-all.sh` refuses to run if any subproject's `node_modules/`
is missing and tells you which ones. `scripts/stop-all.sh` kills anything
listening on the Phase 1 ports (4001-4004, 4100) — useful if a previous
run was backgrounded or crashed.

`scripts/submit.js` POSTs to intake at `:4001/submit` and prints the
`submissionRootHash`, every successful verdict (judgeId, verdictRootHash,
score, reasoning, evidence), and any judge failures. Expected end-to-end
time on Galileo: ~35-40s, dominated by the two 0G uploads (~10s each).
The three judges run concurrently; total time should not multiply with
the number of judges.

To prove a verdict is genuinely on 0G:
```
node bootstrap/download.js <verdictRootHash>
```

## Log event shape

Every agent logs JSONL via `shared/logger.js` (pino) to `logs/<agentId>.jsonl`.
The dashboard (and the log-streamer SSE feed) consumes these files, so the
shape is a contract — don't drift from it.

Required fields on every entry (auto-populated by pino):
- `timestamp` — ISO string (renamed from pino's default `time`)
- `agentId`   — string, set via pino `base`

Required fields on every entry the dashboard cares about (set by the call site):
- `event`        — one of the canonical names below
- `submissionId` — UUID, when the entry belongs to a submission's lifecycle
- `rootHash`     — when the entry refers to a 0G upload/download
- `durationMs`   — number, on every `*-complete` event
- `error`        — string, on `error` events only

Canonical event vocabulary (exported as `EVENTS` from `aar-shared/logger`):
- `submission-received`
- `github-fetch-start`, `github-fetch-complete`
- `upload-start`, `upload-complete`
- `download-start`, `download-complete`
- `claude-start`, `claude-complete`
- `judge-call-start`, `judge-call-complete`
- `error`

Use `startTimer()` from the same module to populate `durationMs`:
```js
const { EVENTS, startTimer } = require('aar-shared/logger');
const t = startTimer();
logger.info({ event: EVENTS.UPLOAD_START, submissionId, rootHash });
// ... work ...
logger.info({ event: EVENTS.UPLOAD_COMPLETE, submissionId, rootHash, durationMs: t() });
```

Non-canonical events (e.g. `agent-listening`, `upload-mined`) are allowed and
must still carry `timestamp` + `agentId` + `event`, but the dashboard may
ignore them. When in doubt, prefer a canonical name.

## Log streamer (port 4100)

`log-streamer/index.js` is the bridge between the agents' on-disk JSONL
logs and the Phase 2 dashboard. It tails every `*.jsonl` file under
`logs/` with chokidar (polling mode — see below), maintains a per-file
byte offset so it only reads newly appended bytes, and broadcasts each
parsed entry as a Server-Sent Event.

Why polling (`usePolling: true, interval: 200`) instead of native FS
events: macOS FSEvents under-reports cross-process appends. When an
agent's pino stream flushes a few bytes to `logs/<name>.jsonl`, the
event often never reaches chokidar in the streamer process, so SSE
clients see only the 15s keepalive pings during a real submission.
Polling the directory is the cost of reliability; these are tiny files
and a few-per-minute write rate, so the CPU overhead is negligible.

Endpoints:
- `GET /events` — SSE stream. Headers: `Content-Type: text/event-stream`,
  `Cache-Control: no-cache`, `Connection: keep-alive`. On connect the
  service replays the in-memory ring buffer (last 200 entries it has seen)
  before going live. Sends a `: ping` comment every 15s as a keepalive.
  Each event body is a single JSONL log entry as `data: {...}\n\n`.
- `GET /health` — `{ status: 'ok', clients, buffered }`.

Design rules:
- The ring buffer holds the last 200 entries the streamer has *observed
  this run*. On startup, files are tailed from their current end — the
  service does NOT replay historical log content from prior runs. The
  dashboard cares about the live pipeline, not yesterday's traffic.
- The streamer is a passive consumer of the JSONL files. It does not write
  to them, does not parse log structure beyond `JSON.parse`, and does not
  filter by event name. Whatever the agents log, it ships. Dashboard-side
  filtering is the dashboard's job.
- Truncation guard: if a watched file shrinks (rotation, manual clear),
  the offset resets to 0 so the next read does not skip into garbage.

## Dashboard (react/, Phase 2)

The dashboard is a same-origin SPA. In dev, Vite proxies backend traffic
so the browser never hits CORS:
  - `/submit` → `http://127.0.0.1:4001` (intake)
  - `/events` → `http://127.0.0.1:4100` (log-streamer SSE)

This lets the React app call relative URLs (`fetch('/submit', ...)`,
`new EventSource('/events')`) and stay portable to a production deploy
where the same paths are reverse-proxied.

Architectural rules:
- The dashboard is a **passive consumer** of the existing bus. It does
  not introduce new HTTP endpoints, log events, or 0G writes. If the
  dashboard needs information the agents don't already emit, the right
  fix is to add it to the agents' canonical event vocabulary, not to
  paper over it client-side.
- Submission completion is derived from the HTTP response to
  `POST /submit` (which already returns the verdicts) — NOT from a
  synthetic SSE event. This keeps intake unchanged and the contract
  symmetric with the CLI.
- One SSE connection per browser tab, opened above `<Routes>` so
  navigation between routes does not tear it down.
- The dashboard renders the **current submission only**. No history,
  no persistence. If the user refreshes, the run state is gone — they
  re-submit from the form.

Type contract:
- `react/src/types.ts` mirrors the bus schemas: `LogEvent` matches the
  canonical shape from `shared/logger.js`, `Verdict` matches the zod
  schema from `shared/schemas.js`, `SubmissionResponse` matches what
  `agents/intake/handler.js` returns. If those server-side shapes
  change, update `types.ts` in the same commit.
- `react/src/config.ts` `AGENTS` is the dashboard's source of truth for
  rendering order and labels of the five services. Its `id` values must
  match `AGENT_IDS` in `shared/config.js` exactly.
- `react/src/lib/deriveAgentState.ts` `START_TO_COMPLETE` pairs every
  `*-start` event with its matching `*-complete`. The agent grid uses
  the open-pair count to decide "working" vs "idle". When you add a new
  `*-start`/`*-complete` pair to `EVENTS` in `shared/logger.js`, add it
  here too — otherwise the dashboard will treat the event as momentary
  and the agent card will not show as working during it. The reducer
  uses a stack, not a flag, so overlapping pairs (e.g. a judge that has
  both a `download-start` and an `upload-start` open at the same time)
  are tracked correctly; do not simplify it back to a single boolean.

- Never commit secrets. `.env` files are gitignored at each subproject's level;
  ship `.env.example` with placeholders.
- Treat 0G testnet calls as flaky — log entries can take seconds to propagate
  to storage nodes after a successful on-chain submit. Poll
  `getFileInfoByTxSeq(txSeq)` until non-null before pushing segments.
- Concurrent uploads from the **same wallet** can revert on Galileo. Three
  judges fanning out to `flow.submit(...)` simultaneously occasionally yields
  one `status=0` receipt with no logs (the contract revert path). Observed
  in Phase 1 verification. This is why intake fans out with
  `Promise.allSettled` and surfaces a `failures` array — partial results
  beat total failure. Do **not** add retries inside `og-storage.js` to mask
  this; let the failure bubble up so the panel can decide what to do with
  an incomplete verdict set.
- Storage fee for tiny payloads is dominated by gas, not the per-sector price
  (~3e-8 0G/sector). Don't over-engineer fee estimation for sanity checks.
