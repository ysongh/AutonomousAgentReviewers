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
  role: 'intake' | 'judge' | 'demo' | 'aggregator' | 'infra';
};

// The Phase 1-3 services. Order is the rendering order in the agent grid:
// intake first, the three text judges in panel order, the demo judge (Phase 3,
// idle on no-video runs), the aggregator that orchestrates round 2, infra
// (log-streamer) last. Keep ids in sync with shared/config.js AGENT_IDS.
//
// judge-demo uses role 'demo', NOT 'judge', on purpose: VerdictGrid derives
// canonical judge order from `role === 'judge'`, and the demo verdict is
// rendered by its own card (last slot) — keeping it out of that filter makes
// the three-text-judge grid byte-identical on every run.
export const AGENTS: AgentDescriptor[] = [
  { id: 'intake', label: 'Intake', role: 'intake' },
  { id: 'judge-technical', label: 'Technical', role: 'judge' },
  { id: 'judge-originality', label: 'Originality', role: 'judge' },
  { id: 'judge-skeptic', label: 'Skeptic', role: 'judge' },
  { id: 'judge-demo', label: 'Demo', role: 'demo' },
  { id: 'aggregator', label: 'Aggregator', role: 'aggregator' },
  { id: 'log-streamer', label: 'Log Streamer', role: 'infra' },
];

export const AGENT_IDS = AGENTS.map((a) => a.id);
