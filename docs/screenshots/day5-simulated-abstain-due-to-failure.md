# Day 5 — Simulated abstain-due-to-failure (text description)

This file substitutes for a PNG screenshot. The agent that ran the verification
was headless and could not capture a real screen, so this file describes what
the dashboard would render for the run captured here. The on-chain artifacts
are real and can be re-fetched.

## Run

- Submitted: `https://github.com/sindresorhus/is`
- Aggregator started with: `SIMULATE_REVISE_FAILURE=judge-skeptic`
- submissionId: `a50875b2-107c-4715-9b6d-ee6e3c7947bc`
- submissionRootHash: `0x6fa0cfeda2b8fe47ccff2c386162e21fe10df5203fcdc73b3d53d52b7d767a48`
- panelVerdictRootHash: `0x3a3a99b62381a7b621328c717e1a8a2dd08d70cb074d4c8b4cf5cd80737b46d4`
- Pipeline duration: 77.2 s

## Aggregator startup banner (stderr)

```
[aggregator] ⚠️  RUNNING WITH --simulate-revise-failure=judge-skeptic. This is a debug flag and must NOT ship in the final demo build.
```

The corresponding log entry on `logs/aggregator.jsonl`:

```
{"level":40,"event":"simulate-revise-failure-active","target":"judge-skeptic","timestamp":"2026-05-07T04:53:12.554Z","agentId":"aggregator"}
```

## Round 1 (all three succeeded)

| Judge | Score | RootHash |
|---|---|---|
| judge-technical | 9 | `0x88018888d007bbd614ae670411f178b7e66c471fe80a2b59a5658ca48f4f9c2f` |
| judge-originality | 2 | `0x547a34d43dda3e1b0be52fc23002d90d993599fc7c048c4dbf6ad7f98c8810d8` |
| judge-skeptic | 8 | `0x0c28972f6bb3a04cf24272c3712f040c9bce4dfffe065e5211674a9d60994e90` |

## Round 2 (the simulated failure)

- judge-technical: HELD — `0x8debc237af0ce1c7593eb2175e1b370b9b3b1e4f248e417ae4b1f3fbcd38484c`
- judge-originality: HELD — `0x651ef5f8380e6ab2231462117df4d8740733c3fb5411df649afbce6b7fecc7cb`
- judge-skeptic: ABSTAIN-DUE-TO-FAILURE — `revisionRootHash: null`

The aggregator's log captured the synthetic failure on the same code path
a real failure would take:

```
{"level":40,"event":"judge-abstain-due-to-failure","submissionId":"a50875b2-107c-4715-9b6d-ee6e3c7947bc","judgeId":"judge-skeptic","error":"simulated revise failure for judge-skeptic (--simulate-revise-failure)","timestamp":"2026-05-07T04:55:13.566Z","agentId":"aggregator"}
```

## Panel verdict

- finalScores: `{ technical: 9, originality: 2, skeptic: 8 }`
- weightedAggregate: `6.60 / 10`  (0.4·9 + 0.3·2 + 0.3·8)
- spread: `7`
- dissent: `true`
- dissentSummary:
  > The panel split primarily on originality: judge-originality scored it a 2,
  > arguing the submission is a pre-existing, widely recognized npm package
  > (sindresorhus/is) with no hackathon-relevant novelty, while judge-technical
  > (9) and judge-skeptic (8) both rated it highly on technical merit and
  > credibility, treating its maturity and real-world adoption as strengths
  > rather than disqualifiers.

The panel verdict still landed on 0G — the simulation only affects round 2,
and the panel produces with whatever round-2 outcomes it gets. The skeptic's
final score is the round-1 score (8), because abstention preserves round-1.

## What the dashboard would render

Reading the response payload through `useSubmission` and the existing
component logic:

- **AgentGrid (top)**: all six agent cards green/idle by the time the panel
  lands; during the run the four agents that actually worked (intake, the
  three judges, aggregator) cycled through `working` states.

- **DeliberatingCard**: visible in the panel-card slot from the moment all
  three round-1 verdicts completed (~37 s in) until `panel-aggregate-complete`
  arrived (~77 s). About 40 s of the pulsing "Deliberating…" headline +
  sliding progress bar. Vanishes the instant the SSE event lands; clean swap
  to PanelVerdictCard.

- **VerdictGrid (canonical order: technical → originality → skeptic)**:
  - **judge-technical card**: round-1 score 9, full reasoning + 8 evidence
    items. Footer: gray "held by choice" lock row with revisionRootHash.
  - **judge-originality card**: round-1 score 2, full reasoning + 5 evidence
    items. Footer: gray "held by choice" lock row with revisionRootHash.
  - **judge-skeptic card**: round-1 score 8, full reasoning + 5 evidence
    items. Footer: low-intensity rose row labeled "panel-only — judge
    unavailable" with the title-attribute tooltip carrying the simulated
    error string. `abstainReason: 'failure'` (client-derived from
    `revisionRootHash === null`).

- **PanelVerdictCard (bottom)**:
  - Hero: `6.60` with the formula `0.4 × technical(9) + 0.3 × originality(2)
    + 0.3 × skeptic(8) = 6.60` in the CSS-only tooltip.
  - Score badges: `tech 9` (good/green), `orig 2` (bad/red), `skep 8`
    (good/green). spread: 7. DISSENT pill (yellow).
  - Summary: the dissentSummary text above.
  - Footer: panel hash `0x3a3a99b6…737b46d4`, copy-hash button, **"Verify
    on 0G" button** (new in step 3) that opens `VerifyOn0GModal` and shows
    the panel JSON fetched fresh from the indexer through
    log-streamer's `/verify` endpoint.

- **RunSummary line**: `verdicts 3 of 3` (no failures during round 1, since
  the simulation only affects round 2). The summary line internally counts
  round-2 outcomes via `abstainReason`, so it would show `1 abstained
  (failure)` alongside the panel headline.

## Verifying the artifacts

```
node bootstrap/download.js 0x3a3a99b62381a7b621328c717e1a8a2dd08d70cb074d4c8b4cf5cd80737b46d4
```

This returns the on-chain `PanelVerdict` for this run, including
`round2Revisions[2].revisionRootHash === null` for skeptic — the on-chain
record of the abstention. The cause (simulated vs real) lives only in the
aggregator's log.
