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

module.exports = { SYSTEM, buildUserPrompt, VERDICT_TOOL_SCHEMA };
