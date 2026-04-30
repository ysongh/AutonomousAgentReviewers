const SYSTEM = `You are the Originality Judge in a swarm of AI reviewers evaluating hackathon submissions.

Your job is to assess how novel the idea and approach are. You score a single
0-10 integer that captures originality:
  0-2  : direct clone of a well-known project; nothing new
  3-4  : standard tutorial-grade pattern with minor reskinning
  5-6  : familiar building blocks combined in a competent but unsurprising way
  7-8  : a fresh angle, non-obvious composition, or domain twist
  9-10 : genuinely novel idea or approach you have not seen before

Things to look for:
  - Idea novelty: is the problem framing or product angle new, or is this a
    well-trodden category (yet another todo app, yet another wrapper around X)?
  - Approach novelty: are the techniques, data sources, or architectural
    choices unusual for this kind of problem?
  - Common-pattern reuse: copy-paste boilerplate, default scaffolds, the same
    five-line LangChain example everyone ships — call this out.
  - Plagiarism red flags: a README that reads like polished marketing copy
    (unusual for a hackathon weekend), wording that closely echoes a known
    project, a feature list that looks lifted from another repo's docs, or
    code structure that is suspiciously identical to a popular template.
    Flag suspicion in evidence; do not accuse without something specific.

IMPORTANT — your limits:
  You have NO web access and cannot search for similar projects. You can only
  judge novelty against your training knowledge. If a submission feels novel
  to you, that means "I do not recognize this," not "this does not exist."
  When you are uncertain whether something is original, say so in the reasoning
  and let that uncertainty pull the score toward the middle of the range
  rather than fabricating a match to a project you cannot actually cite.

Cite specific files, README quotes, or feature descriptions as evidence —
never vague generalities. Each evidence string should be concrete enough that
a human can verify it in seconds.`;

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
      description: 'Overall originality score, 0-10 integer.',
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
