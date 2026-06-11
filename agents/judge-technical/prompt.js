const SYSTEM = `You are the Technical Judge in a swarm of AI reviewers evaluating hackathon submissions.

You are a senior engineer. Be rigorous, fair, and concise. Score on a 0-10 integer scale where:
  0-2  : nothing works / placeholder
  3-4  : prototype with serious gaps
  5-6  : working but rough; obvious issues
  7-8  : solid, idiomatic, mostly complete
  9-10 : exceptional craft and completeness

Evaluate four dimensions and let them inform a single overall score:
  - Code quality: structure, naming, idiomatic patterns
  - Architecture: sensible modules, reasonable choices for the problem
  - Completeness: does it look like it actually works, or half-built?
  - Documentation: is the README clear, does setup look reproducible?

Cite specific files, code snippets, or README quotes as evidence — never vague
generalities. Each evidence string should be concrete enough that a human can
verify it in seconds.`;

function buildUserPrompt(submission) {
  const { repoUrl, repoName, repoDescription, readme, fileTree } = submission;
  const treeText = fileTree.length ? fileTree.join('\n') : '(empty)';
  const readmeText = readme && readme.trim() ? readme : '(no README)';
  return `Repository: ${repoName}
URL: ${repoUrl}
Description: ${repoDescription || '(none)'}

Top-level file tree:
${treeText}

README:
---
${readmeText}
---

Produce your verdict by calling the submit_verdict tool.`;
}

const VERDICT_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    score: {
      type: 'integer',
      minimum: 0,
      maximum: 10,
      description: 'Overall technical score, 0-10 integer.',
    },
    reasoning: {
      type: 'string',
      description: '2-4 sentences explaining the score.',
    },
    evidence: {
      type: 'array',
      items: { type: 'string' },
      description: 'Specific file refs or quotes from the README/tree backing the score.',
    },
  },
  required: ['score', 'reasoning', 'evidence'],
};

const REVISE_APPENDIX = `

You are now in round 2 of panel deliberation. You have already submitted a
verdict on this submission. You are seeing your peer judges' verdicts for
the first time.

Apply the evidence test: did a peer cite a specific file, function,
dependency, README quote, build artifact, or test/CI signal that you did
not weigh in round 1? If yes, update your score to reflect that new
information. If peers only disagree on framing, weighting, or
interpretation of the same facts, hold — framing disagreements are not
new evidence.

CROSS-MODAL EVIDENCE: you may also be shown the demo-video judge's verdict
(score, reasoning, timestamped evidence, and a claims_check). Treat it under
the SAME evidence test. A claims_check entry marked "shown" is concrete
evidence that a claimed feature actually works — it was demonstrated on screen
at the cited timestamp. A "contradicted" entry is concrete evidence of a gap —
the frame at that timestamp is at odds with the claim. A "shown" or
"contradicted" entry counts as new evidence ONLY if it cites a timestamp;
weight "contradicted" entries carefully and verify the timestamp before acting
on them. An "asserted-only" entry is NOT evidence either way — it only means
the claim was never demonstrated.

Two outcomes:
  - Revise (revised=true): a peer (text OR demo) surfaced concrete
    code-quality evidence you missed. Set revisedScore (0-10 integer) and
    revisionReasoning (1-3 sentences naming the specific evidence and how it
    shifted your score).
  - Hold (revised=false): no new evidence, only different framing. Omit
    revisedScore and revisionReasoning. Holding is a legitimate outcome.

Produce your decision by calling the revise_verdict tool.`;

const SYSTEM_REVISE = SYSTEM + REVISE_APPENDIX;

// demoVerdict is OPTIONAL cross-modal evidence (the demo-video judge's DemoVerdict);
// it is passed as a separate arg, NOT mixed into peerVerdicts (different schema).
// When present, its claims_check + timestamped evidence are rendered as a clearly
// labeled section the judge weighs under the same evidence test.
function buildRevisePrompt({ ownVerdict, peerVerdicts, demoVerdict }) {
  const evList = (xs) => xs.map((e) => `  - ${e}`).join('\n');
  const peerSections = peerVerdicts
    .map(
      (v) =>
        `Peer: ${v.agentId}\n` +
        `- Score: ${v.score}/10\n` +
        `- Reasoning: ${v.reasoning}\n` +
        `- Evidence:\n${evList(v.evidence)}`,
    )
    .join('\n\n');

  let demoSection = '';
  if (demoVerdict) {
    const demoEv = demoVerdict.evidence
      .map((e) => `  - [${e.timestamp}] ${e.observation}`)
      .join('\n');
    const demoClaims = demoVerdict.claims_check
      .map((c) => `  - [${c.verdict}]${c.timestamp ? ` @${c.timestamp}` : ''} ${c.claim}`)
      .join('\n');
    demoSection = `

CROSS-MODAL EVIDENCE FROM THE DEMO VIDEO REVIEW (judge-demo):
- Demo score: ${demoVerdict.score}/10
- Reasoning: ${demoVerdict.reasoning}
- Timestamped evidence:
${demoEv}
- Claims check (claim -> what the video actually shows):
${demoClaims}`;
  }

  return `Your round-1 verdict on this submission:
- Score: ${ownVerdict.score}/10
- Reasoning: ${ownVerdict.reasoning}
- Evidence:
${evList(ownVerdict.evidence)}

Your peer judges' round-1 verdicts on the same submission:

${peerSections}${demoSection}

Decide whether to hold (revised=false) or revise (revised=true with new
score + reasoning). Call the revise_verdict tool.`;
}

const REVISE_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    revised: {
      type: 'boolean',
      description:
        'true if you are revising your score after seeing peers, false if you are holding your original score.',
    },
    revisedScore: {
      type: 'integer',
      minimum: 0,
      maximum: 10,
      description:
        'Required iff revised=true: your new 0-10 integer score. Omit if revised=false.',
    },
    revisionReasoning: {
      type: 'string',
      description:
        'Required iff revised=true: 1-3 sentences explaining specifically what peer argument changed your view. Omit if revised=false.',
    },
  },
  required: ['revised'],
};

module.exports = {
  SYSTEM,
  buildUserPrompt,
  VERDICT_TOOL_SCHEMA,
  SYSTEM_REVISE,
  buildRevisePrompt,
  REVISE_TOOL_SCHEMA,
};
