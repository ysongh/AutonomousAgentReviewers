// All paths are relative — vite proxies them to the right backend in dev.
export const SUBMIT_URL = '/submit';
export const EVENTS_URL = '/events';

// Cap the in-memory event buffer. The log-streamer's own ring is 200; the
// dashboard keeps a slightly larger window so users can scroll back through
// the most recent run without losing context.
export const MAX_EVENTS = 500;

export type AgentDescriptor = {
  id: string;
  label: string;
  role: 'intake' | 'judge' | 'aggregator' | 'infra';
};

// The six Phase 1 services. Order is the rendering order in the agent grid:
// intake first, judges in the same order as the panel, the aggregator that
// orchestrates round 2, infra (log-streamer) last. Keep ids in sync with
// shared/config.js AGENT_IDS.
export const AGENTS: AgentDescriptor[] = [
  { id: 'intake', label: 'Intake', role: 'intake' },
  { id: 'judge-technical', label: 'Technical', role: 'judge' },
  { id: 'judge-originality', label: 'Originality', role: 'judge' },
  { id: 'judge-skeptic', label: 'Skeptic', role: 'judge' },
  { id: 'aggregator', label: 'Aggregator', role: 'aggregator' },
  { id: 'log-streamer', label: 'Log Streamer', role: 'infra' },
];

export const AGENT_IDS = AGENTS.map((a) => a.id);
