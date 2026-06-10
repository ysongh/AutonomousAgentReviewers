// prompt.js — the demo judge's rubric, the forced-tool_use schema, and the
// multimodal user-content builder. Ported from bootstrap-demojudge (Phase 1
// spike) with one production change: REPO CONTEXT is now real (the
// SubmissionRecord's already-capped readme + repo metadata) instead of a
// placeholder, and the rubric tells the model to check those claims — alongside
// the narration's — against what the frames actually show.

const MAX_README_CHARS = 8000; // headroom is huge (spike used 8,550 input tokens
                               // of a 30K/min window), but cap so a pathological
                               // README can't blow the single-call budget.

const SYSTEM = `You are a judge on a hackathon panel, reviewing a DEMO VIDEO of a submission.
You are given keyframes sampled evenly across the video (each labeled with its timestamp), the timestamped narration transcript, and REPO CONTEXT (the project's README and metadata).

Evaluate three things:
(a) Does the video DEMONSTRATE working functionality (something actually running/shown), versus only describing it?
(b) Is what is SHOWN on screen consistent with what is CLAIMED — both in the narration AND in the README/repo context? Flag gaps between promise and delivery: a feature described in the README or narration but never shown on screen is "asserted-only"; a frame that shows something the claim says works is "shown"; a frame that shows something at odds with a claim is "contradicted".
(c) Demo coherence and clarity.

Be specific and cite timestamps (MM:SS) for every observation. A frame is a still sampled at that timestamp; reason about what it depicts together with the narration around that time. Do not invent details you cannot see in a frame or read in the transcript/README. Calibrate the score 0-10 honestly: a polished slide-deck narration with no live functionality shown is not the same as a working demo. Judge the DEMO, not the repo's own on-screen scores.`;

// Forced-tool_use schema — identical contract to the spike's submit_demo_verdict,
// which shared/schemas.js DemoVerdict validates against on the way to 0G.
const DEMO_VERDICT_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 10, description: 'Overall demo quality, 0-10.' },
    reasoning: { type: 'string', description: '2-4 sentences justifying the score.' },
    evidence: {
      type: 'array',
      minItems: 3,
      description: 'At least 3 concrete observations, each tied to a timestamp.',
      items: {
        type: 'object',
        properties: {
          timestamp: { type: 'string', description: 'MM:SS into the video.' },
          observation: { type: 'string' },
        },
        required: ['timestamp', 'observation'],
      },
    },
    claims_check: {
      type: 'array',
      description: 'Claims from the narration AND the README/repo context, checked against what is actually shown.',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string' },
          verdict: { type: 'string', enum: ['shown', 'asserted-only', 'contradicted'] },
          timestamp: { type: ['string', 'null'], description: 'MM:SS or null.' },
        },
        required: ['claim', 'verdict', 'timestamp'],
      },
    },
  },
  required: ['score', 'reasoning', 'evidence', 'claims_check'],
};

// Build the single user message: intro -> N×(frame label + base64 image) ->
// timestamped transcript -> REPO CONTEXT. `frames` items carry { index, label,
// dataBase64 }; `transcriptText` is the pre-formatted "[MM:SS] line" block.
function buildUserContent({ submission, frames, transcriptText }) {
  const content = [
    {
      type: 'text',
      text: `This is a hackathon demo video. Below are ${frames.length} keyframes sampled evenly across the video, each preceded by its timestamp, followed by the timestamped narration transcript and the project's REPO CONTEXT. Review the demo and submit your verdict using the submit_demo_verdict tool.`,
    },
  ];
  for (const f of frames) {
    content.push({ type: 'text', text: `Frame ${f.index} — t=${f.label}` });
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: f.dataBase64 },
    });
  }
  content.push({
    type: 'text',
    text: `TRANSCRIPT (timestamped narration):\n${transcriptText || '(no speech detected)'}`,
  });

  const readme = (submission.readme || '').slice(0, MAX_README_CHARS);
  const repoContext = [
    `Repository: ${submission.repoName}`,
    submission.repoDescription ? `Description: ${submission.repoDescription}` : null,
    `URL: ${submission.repoUrl}`,
    '',
    'README (may be truncated):',
    readme || '(no README)',
  ]
    .filter((l) => l !== null)
    .join('\n');
  content.push({ type: 'text', text: `REPO CONTEXT:\n${repoContext}` });

  return content;
}

module.exports = { SYSTEM, DEMO_VERDICT_TOOL_SCHEMA, buildUserContent, MAX_README_CHARS };
