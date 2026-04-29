const Anthropic = require('@anthropic-ai/sdk');

const DEFAULT_MODEL = 'claude-sonnet-4-6';

let client;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set in environment');
  }
  if (!client) client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

// Calls Claude with a tool that forces a JSON object back. Returns the parsed
// tool_use input. Avoids regex-extracting JSON from prose.
//
// toolName/toolDescription are optional — defaults preserve the round-1 judge
// contract. Phase 1 reuses this for revise_verdict (per-judge round 2) and
// summarize_dissent (aggregator's optional dissent summary).
async function callJudge({
  system,
  user,
  schema,
  model = DEFAULT_MODEL,
  maxTokens = 1024,
  toolName = 'submit_verdict',
  toolDescription = 'Return the structured judgment for this submission.',
}) {
  const c = getClient();
  const tool = {
    name: toolName,
    description: toolDescription,
    input_schema: schema,
  };
  const resp = await c.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    tools: [tool],
    tool_choice: { type: 'tool', name: toolName },
    messages: [{ role: 'user', content: user }],
  });
  const block = resp.content.find((b) => b.type === 'tool_use' && b.name === toolName);
  if (!block) throw new Error(`Claude did not return a ${toolName} tool_use block`);
  return { input: block.input, usage: resp.usage, model: resp.model };
}

module.exports = { callJudge, DEFAULT_MODEL };
