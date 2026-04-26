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
async function callJudge({ system, user, schema, model = DEFAULT_MODEL, maxTokens = 1024 }) {
  const c = getClient();
  const tool = {
    name: 'submit_verdict',
    description: 'Return the structured judgment for this submission.',
    input_schema: schema,
  };
  const resp = await c.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'submit_verdict' },
    messages: [{ role: 'user', content: user }],
  });
  const block = resp.content.find((b) => b.type === 'tool_use' && b.name === 'submit_verdict');
  if (!block) throw new Error('Claude did not return a submit_verdict tool_use block');
  return { input: block.input, usage: resp.usage, model: resp.model };
}

module.exports = { callJudge, DEFAULT_MODEL };
