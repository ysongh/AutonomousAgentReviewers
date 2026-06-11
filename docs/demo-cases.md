# Demo Cases

Curated demo runs from the Day 5 Bucket 1 pass (2026-05-03). Six candidate
repos were submitted sequentially against the Phase 1 pipeline after the
revise-prompt softening. Three runs produced panel verdicts; three
degraded to a round-1-race failure (cross-submitter status=0 reverts at
the 0G flow contract — see CLAUDE.md "the bus" rules). All three
panel-producing runs landed `dissent=true`; the softened revise prompts
did not surface an organic revision in any of them.

The hashes below are stable on 0G Galileo and can be re-downloaded with
`node bootstrap/download.js <hash>`.

## Converged clean

No candidate surfaced after two passes plus one targeted retry (initial
6-URL pass + user-curated 1-URL follow-up + 1-URL retry of the same
follow-up). The follow-up targeted a recently-built personal project
(ysongh/NilDataWallet) on the theory that novel hackathon-shaped repos
would dodge the "mature library = not novel" originality penalty that
drove the dissent in pass one. Both attempts hit a round-1-race failure
before the aggregator was reached: the first lost `judge-skeptic` to a
flow-contract `status=0` revert, the retry lost `judge-originality` to
the same revert shape (different judge, same root cause). Across both
NilDataWallet runs the surviving judges scored 4–5 with closely aligned
reasoning (technical 5 + originality 7 first run, technical 5 + skeptic
4 retry), so the panel had a plausible converged-low trajectory — it
just never landed three round-1 verdicts in the same run. All three
panel-producing runs across the curation work were dissents; no
converged-clean case surfaced under current testnet conditions. Demo
will lean on the dissent case (sindresorhus/is) as primary; graceful
degradation remains uncovered — see below.

## Dissent

**Repo**: sindresorhus/is

- panelHash: `0x1ccc228188f0dc29cb77ccf918f73ff7b000f07a95db6872013ef5cec7b7ce03`
- aggregate: 6.90 (spread 6: technical=9, originality=3, skeptic=8)
- dissentSummary: "The panel split primarily on originality:
  judge-originality scored it a 3, arguing the submission is a
  long-established, widely-known npm package in a crowded category with
  no novel techniques, while judge-technical (9) and judge-skeptic (8)
  rewarded its polished code quality, comprehensive coverage, and
  real-world credibility without penalizing it for being a pre-existing
  library. The core disagreement is whether submitting a mature,
  published open-source package should disqualify it from high marks on
  dimensions beyond originality."
- notes: clearest demo narrative of the three — recognizable repo, the
  dissent is purely dimensional (novelty vs craft) rather than a
  calibration argument, all three judges held cleanly on round 2.

Alternative dissent panels recorded the same shape (kept here for
reference, not shown in the demo):
- sindresorhus/slugify — `0x3d983a326c42c1fd63e85958b265dc2e0d03e6e244350ed4888e4d52087064c2`
  (aggregate 7.20, spread 6: tech=9, orig=3, skep=9)
- sindresorhus/awesome-nodejs — `0xc38c5894b6b037798cebbea64775e27e5daa7f6a32f2860518df323db663e9e2`
  (aggregate 5.80, spread 6: tech=7, orig=2, skep=8 — the only one
  where judge-technical also pulled below 8)

## Revision

**First organic revision — captured 2026-06-11 (Phase 2 with-video run).**

The Day 5 curation corpus was all mature, widely-known libraries
(sindresorhus/*, express, nanoGPT, …). Against those, the softened
revise prompt only ever produced framing disagreements — every round-2
call held (`revised: false`). A revision needs a peer to cite *concrete
evidence the holder did not weigh in round 1*; a mature library gives
every judge the same complete picture, so there is nothing new to
surface. The first `revised: true` appeared the moment a **real project
with real gaps** was judged: the AAR repo itself.

**Repo**: ysongh/AutonomousAgentReviewers (with the narrated demo video)

- submissionId: `1fdcb738-4015-4cf0-8d60-05a5e09bfaad`
- submissionHash: `0x4405aa3d092fd7465163467ab452534bfb92e224e4638cb0831a61f607bdff1e`
- panelHash: `0x6ea054719afb32d88f79b26af30211eb503a3ffa4a0c8768538e55201101918d`
- aggregate: 7.70 (spread 1; final technical=8, originality=8, **skeptic 6→7**)
- dissent: **false** — the panel *converged because the skeptic moved*,
  not because everyone started aligned.

The skeptic scored **6** in round 1, flagging that the top-level file
tree did not expose the per-agent `agents/intake`, `agents/judge-*`
subdirectories the README described — a classic promise-vs-delivery
suspicion. In round 2 it saw judge-technical's evidence and revised to
**7** (`revisionRootHash`
`0x49f393076aa54fb16b6ebcdc580241494bcd7525c664215055e7e62bf438c04f`),
with this `revisionReasoning`:

> "The technical peer surfaced concrete evidence I couldn't verify from
> the file tree alone: `shared/` contains proper subdirectories
> (og-storage, claude, github, schemas, logger, config),
> `scripts/generate-agent-wallets.js` and
> `scripts/check-agent-balances.js` exist as real tooling, and CLAUDE.md
> serves as a dedicated architecture document — these resolve my concern
> that the per-agent structure might be underdeveloped. The agents/
> subdirectory structure is still not fully confirmed, and TODO.md plus
> bootstrap directories remain as legitimate gaps, but the overall
> implementation appears more substantive than the file tree alone
> suggested. I'm bumping one point for the concrete shared/ structure and
> scripting evidence, while holding back from 8 due to the ergonomics gap
> (8 separate install steps), TODO.md, and the external dependency
> requirements that make independent verification hard."

This is the evidence test working exactly as designed: a concrete,
citable peer observation (specific files/scripts/docs the skeptic had
not weighed) moved the score; the residual gaps it could *not* verify
kept it from going all the way to 8. The panel hash downloads cleanly
via `node bootstrap/download.js <hash>` and through the dashboard's
log-streamer `/verify/<hash>` endpoint.

> Note: this run pre-dates the Phase 3 cross-modal re-sequencing — the
> demo verdict here sat *beside* the panel (Phase 2), it did not yet feed
> round 2. The revision above came from a **text** peer (judge-technical),
> not the demo judge. It is recorded here because it is the corpus's first
> organic revision and the canonical "real project with real gaps"
> demonstration. A cross-modal revision (a text judge moved by a demo
> `shown`/`contradicted` entry) is the Phase 3 hunt — see the Phase 3
> verification notes.

## Graceful degradation

No candidate surfaced in Day 5 curation pass. The three failing runs
(expressjs/express, karpathy/nanoGPT, jakearchibald/svgomg) all lost
one or two round-1 judges to flow-contract `status=0` reverts, leaving
fewer than three round-1 verdicts and causing intake to skip the
aggregator entirely. None of them produced a partial panel — the
intended graceful-degradation shape (panel verdict with one judge
abstain-due-to-failure on round 2) requires all three round-1 judges
to land successfully and at least one round-2 revise to fail, which
did not occur in this pass.
