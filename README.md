# Autonomous Agent Reviewers (AAR)

A swarm of AI judge agents that peer-review hackathon submissions, with
every verdict recorded on **0G Storage** (Galileo testnet, chainId 16602).
The judges deliberate over a single round, the panel disagreement is
summarized by a neutral aggregator, and the final verdict is uploaded to
0G as an auditable artifact.

## How it works

```
              ┌──────────────────┐
  GitHub URL  │  intake (4001)   │  ← CLI / dashboard POSTs here
   ──────────▶│  fetches repo    │
              │  uploads to 0G   │
              └────────┬─────────┘
                       │ submissionRootHash
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
 ┌────────────┐ ┌────────────┐ ┌────────────┐
 │ technical  │ │originality │ │  skeptic   │   ROUND 1
 │   (4002)   │ │   (4003)   │ │   (4004)   │   parallel verdicts
 └─────┬──────┘ └─────┬──────┘ └─────┬──────┘
       └──────────────┼──────────────┘
                      ▼
              ┌──────────────────┐
              │ aggregator (4005)│
              │  fans out round 2│   ROUND 2
              │  + summarises    │   each judge sees peers,
              │  dissent         │   may revise or hold
              └────────┬─────────┘
                       │ panelVerdictRootHash
                       ▼
                 final verdict on 0G
```

Three judges with distinct rubrics (calibrated technical, blind-novelty
originality, intentionally-harsh skeptic) run round 1 in parallel. The
aggregator triggers round 2 — each judge sees the other two judges'
verdicts and either revises their score, holds by choice, or is recorded
as abstaining if their `/revise` call fails. Final score is a
`0.4·tech + 0.3·orig + 0.3·skep` weighted aggregate; dissent (spread ≥ 2)
is summarized by one neutral LLM call.

Every payload that crosses an HTTP wire between agents carries **only**
root hashes — the `SubmissionRecord`, `JudgeVerdict`, `RevisedVerdict`,
and `PanelVerdict` payloads themselves live on 0G Storage and are
zod-validated on every read and write.

## Quickstart

**Prereqs:** Node 18+, pnpm, an Anthropic API key, a funded 0G Galileo
testnet wallet (drip from <https://faucet.0g.ai>).

**1. Install** — each subproject installs independently (no monorepo):

```
cd shared && pnpm install
cd ../agents/intake && pnpm install
cd ../judge-technical && pnpm install
cd ../judge-originality && pnpm install
cd ../judge-skeptic && pnpm install
cd ../aggregator && pnpm install
cd ../../log-streamer && pnpm install
cd ../react && pnpm install
```

**2. Configure** — root `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
PRIVATE_KEY=0x...              # legacy, used by bootstrap/ + smoke
RPC_URL=https://evmrpc-testnet.0g.ai
INDEXER_URL=https://indexer-storage-testnet-turbo.0g.ai
GITHUB_TOKEN=ghp_...           # optional, raises GH rate limit
```

**3. Per-agent wallets** — each agent has its own keypair to avoid nonce
collisions when uploading concurrently:

```
node scripts/generate-agent-wallets.js
# fund each printed address with ~0.05 0G from the faucet
node scripts/check-agent-balances.js   # exits 0 once all 5 are >= 0.04 0G
```

**4. Run the swarm** (5 agents + log-streamer):

```
./scripts/start-all.sh
```

**5a. Submit from the CLI:**

```
node scripts/submit.js https://github.com/sindresorhus/is
```

**5b. Or open the dashboard:**

```
cd react && pnpm dev
# open http://localhost:5173
```

The dashboard streams agent activity via SSE from the log-streamer
(port 4100) and renders the round-1 verdicts, each judge's deliberation
outcome (revised / held / abstained), and the final panel verdict —
including the dissent summary and the on-chain hash — once the run
settles.

## Repo layout

```
shared/             common modules: og-storage, claude, github, schemas, logger, config
agents/
  intake/           (4001) entry point, fans out to judges, calls aggregator
  judge-technical/  (4002) code quality + completeness rubric
  judge-originality/(4003) novelty rubric, no web access
  judge-skeptic/    (4004) intentionally harsh, balances panel agreement bias
  aggregator/       (4005) round-2 deliberation + PanelVerdict
log-streamer/       (4100) tails logs/*.jsonl, exposes /events SSE feed
react/              dashboard (Vite + React 19 + TS, plain CSS)
scripts/            start-all.sh, stop-all.sh, submit.js, wallet helpers
bootstrap/          throwaway Day-1 0G upload sanity check (not in the prod path)
logs/               runtime JSONL per agent (gitignored)
```

## Tech

- **Runtime:** Node 18+, pnpm
- **0G:** `@0glabs/0g-ts-sdk` + raw `ethers` for the flow contract
  workaround (see `shared/og-storage.js`)
- **LLM:** Anthropic SDK with tool-use forced JSON output
  (`shared/claude.js`)
- **Validation:** zod schemas, applied on every 0G read and write
  (`shared/schemas.js`)
- **HTTP:** Express
- **Logging:** pino → JSONL → chokidar-tailed SSE
- **Dashboard:** React 19 + Vite + TypeScript, plain CSS with
  CSS variables (no UI lib, no state lib)

## Status

- **Phase 0** — single judge, end-to-end 0G round trip
- **Phase 1** — three judges, round-2 deliberation, aggregator,
  PanelVerdict on 0G
- **Phase 2** — dashboard renders the panel verdict, deliberation
  outcomes, and run-summary one-liner *(current)*

## Verifying a verdict

To prove any verdict (round 1, round 2, or panel) is genuinely on 0G:

```
node bootstrap/download.js <rootHash>
```

The full payload is fetched from 0G Storage and printed.

## Deeper docs

[`CLAUDE.md`](./CLAUDE.md) is the single source of truth for
architecture, the inter-agent bus contract, the 0G SDK / contract
footgun, the per-agent wallet rationale, the canonical log event
vocabulary, and the dashboard's component contract. Read that before
making non-trivial changes.
