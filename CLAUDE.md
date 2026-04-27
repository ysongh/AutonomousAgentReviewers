# Autonomous Agent Reviewers (AAR)

A swarm of AI judge agents that peer-review hackathon submissions, coordinating
via 0G Storage on the 0G Galileo testnet (chainId 16602).

## Layout

- `react/` — Vite + React + TS template, the eventual dashboard. **Do not
  modify** until the dashboard work officially starts.
- `bootstrap/` — Throwaway Day-1 sanity check that proves 0G Storage
  upload/download works on this machine. Self-contained: own `package.json`,
  own `node_modules`, own `.env`. Not imported by anything else and not part
  of the final architecture. See `bootstrap/README.md`.
- `shared/` — Common modules used by every agent: `og-storage.js` (the
  productionized 0G workaround — see below), `schemas.js` (zod), `claude.js`
  (Anthropic wrapper), `github.js` (Octokit wrapper), `logger.js` (pino →
  `logs/<agent>.jsonl`), `config.js` (ports, agent IDs). Has its own
  `package.json`. Agents depend on it via `"aar-shared": "file:../../shared"`,
  which symlinks `node_modules/aar-shared` → `shared/`. **No npm workspaces.**
- `agents/<name>/` — One Express process per agent, own `package.json`, own
  `node_modules/`. Agents do NOT pass payload data over HTTP — only root
  hashes. The actual `SubmissionRecord` / `JudgeVerdict` payloads live on 0G
  Storage. Validate every read AND every write against the zod schemas.
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

Every judge agent (technical, and future security/design/etc.) follows the same shape:
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

## Inter-agent flow (the bus)

Day 2 pipeline (one judge, synchronous):

```
CLI (scripts/submit.js)
  └─ POST :4001/submit { repoUrl }
       intake/handler.js
         ├─ Octokit fetchRepoMetadata(repoUrl)
         ├─ uploadJSON(SubmissionRecord)        →  submissionRootHash
         ├─ POST :4002/judge { submissionRootHash, submissionId }
         │     judge-technical/handler.js
         │       ├─ downloadJSON(submissionRootHash) → SubmissionRecord (zod-validated)
         │       ├─ callJudge(...) → tool_use input
         │       └─ uploadJSON(JudgeVerdict)    →  verdictRootHash
         ├─ downloadJSON(verdictRootHash) → JudgeVerdict (zod-validated)
         └─ respond { submissionId, submissionRootHash, verdictRootHash, verdict }
```

Rules that future agents must respect:
- HTTP bodies between agents carry **only** root hashes + the `submissionId`
  UUID. Never inline payload data.
- Every agent that reads from 0G zod-validates the result before using it.
  Every agent that writes to 0G zod-validates before calling `uploadJSON`.
- Both ends assert `submissionId` matches the on-0G record (mismatched IDs
  mean a wire is crossed — fail loudly, do not coerce).
- Day 2 is synchronous (intake blocks on judge). Day 4 will go async via
  callbacks — when that happens, the contract above stays the same; only
  who-calls-whom changes.

## Running it (Day 2)

One-time setup:
```
cd shared && npm install
cd ../agents/intake && npm install
cd ../judge-technical && npm install
```
Add `ANTHROPIC_API_KEY` to root `.env`. `GITHUB_TOKEN` is optional.

Two terminals:
```
# terminal 1 — both agents, prefixed stdout, Ctrl-C kills both
./scripts/start-all.sh

# terminal 2 — submit a repo, get verdict synchronously
node scripts/submit.js https://github.com/sindresorhus/is
```

`scripts/start-all.sh` refuses to run if either agent's `node_modules/` is
missing. `scripts/submit.js` POSTs to intake at `:4001/submit` and prints
`submissionRootHash`, `verdictRootHash`, score, reasoning, and evidence.
To prove the verdict is genuinely on 0G:
```
node bootstrap/download.js <verdictRootHash>
```

## Conventions

- Never commit secrets. `.env` files are gitignored at each subproject's level;
  ship `.env.example` with placeholders.
- Treat 0G testnet calls as flaky — log entries can take seconds to propagate
  to storage nodes after a successful on-chain submit. Poll
  `getFileInfoByTxSeq(txSeq)` until non-null before pushing segments.
- Storage fee for tiny payloads is dominated by gas, not the per-sector price
  (~3e-8 0G/sector). Don't over-engineer fee estimation for sanity checks.
