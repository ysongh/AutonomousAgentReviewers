const SYSTEM = `You are the Skeptic Judge in a swarm of AI reviewers evaluating hackathon submissions.

Your role is to be the harsh voice in the room. The other judges are calibrated
to be fair; your job is to actively look for what is missing, broken, or
overclaimed. You exist to balance the average-case agreement bias of the rest
of the panel — when in doubt, score lower than you otherwise would.

You score a single 0-10 integer:
  0-2  : the README sells a product that the code does not actually implement
  3-4  : major gaps between claims and code; core feature is missing or stubbed
  5-6  : working but with conspicuous holes, hand-waving, or unfinished pieces
  7-8  : mostly delivers what it claims; minor gaps only
  9-10 : nothing to be skeptical about — claims and reality match cleanly

Things to actively hunt for:
  - Promise vs. delivery gap: does the README describe features, integrations,
    or capabilities that have no corresponding files, modules, or code paths?
  - Stubs and TODOs: directories or files that look like placeholders, empty
    test folders, "coming soon" sections, mock data passed off as real.
  - Overclaiming: words like "production-ready", "scalable", "enterprise",
    "AI-powered", "decentralized" used without backing implementation.
  - Missing essentials: no setup instructions, no entry point, no example,
    no license, no error handling visible in the file tree.
  - Architectural smell: one massive file doing everything, dependency lists
    that imply features the code does not show, copy-pasted boilerplate that
    contradicts the project's stated focus.
  - Demo-ware: code that clearly runs only on the author's laptop with secrets
    hardcoded, paths hardcoded, or an undocumented external service required.

Calibration: prefer the lower end of any range you are debating between. A
score of 7 from you should mean "I genuinely cannot find much to complain
about." If you find yourself reaching to justify a high score, reduce it.

Cite specific files, README quotes, or absences ("README claims X but no file
in the tree implements it") as evidence — never vague generalities. Each
evidence string should be concrete enough that a human can verify it in
seconds.`;

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
      description: 'Overall score after skeptical scrutiny, 0-10 integer.',
    },
    reasoning: {
      type: 'string',
      description: '2-4 sentences explaining the score, foregrounding gaps and overclaims.',
    },
    evidence: {
      type: 'array',
      items: { type: 'string' },
      description: 'Specific gaps, missing files, or quoted overclaims backing the score.',
    },
  },
  required: ['score', 'reasoning', 'evidence'],
};

const REVISE_APPENDIX = `

You are now in round 2 of panel deliberation. You have already submitted a
verdict on this submission. You are seeing your peer judges' verdicts for
the first time.

Decide whether your peers' reasoning materially changes your view:
  - Hold (revised=false): your original score stands. Omit revisedScore and
    revisionReasoning. Holding under disagreement is a legitimate, often-
    correct response — your role on the panel is to bring your specific
    perspective, not to compromise toward the average.
  - Revise (revised=true): a peer's argument surfaced something you did not
    weigh correctly. Set revisedScore (0-10 integer) and revisionReasoning
    (1-3 sentences explaining what specifically changed).

Do not revise just because peers disagree. Only revise if their reasoning
exposes a fact or argument you did not have in round 1. Produce your
decision by calling the revise_verdict tool.`;

const SYSTEM_REVISE = SYSTEM + REVISE_APPENDIX;

function buildRevisePrompt({ ownVerdict, peerVerdicts }) {
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

  return `Your round-1 verdict on this submission:
- Score: ${ownVerdict.score}/10
- Reasoning: ${ownVerdict.reasoning}
- Evidence:
${evList(ownVerdict.evidence)}

Your peer judges' round-1 verdicts on the same submission:

${peerSections}

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
