import type { AgentState, LogEvent } from '../types';

export type AgentSnapshot = {
  agentId: string;
  state: AgentState;
  lastEvent: LogEvent | null;
  // Most recent *-start that has not yet been matched by a *-complete. Used
  // by the UI to label the "currently doing" state on a working agent.
  inFlightEvent: string | null;
};

// Pair a `foo-start` with `foo-complete`. Anything outside this map (e.g.
// `submission-received`, `agent-listening`) is treated as a momentary event
// and does not pin the agent to "working".
const START_TO_COMPLETE: Record<string, string> = {
  'github-fetch-start': 'github-fetch-complete',
  'upload-start': 'upload-complete',
  'download-start': 'download-complete',
  'claude-start': 'claude-complete',
  'judge-call-start': 'judge-call-complete',
};

// Walk the events for one agent in chronological order and reduce them down
// to a single snapshot. The reducer tracks open `*-start` events on a stack;
// the matching `*-complete` pops them. If anything is left on the stack
// after we hit the latest event, the agent is "working".
export function deriveAgentState(events: LogEvent[], agentId: string): AgentSnapshot {
  const ours = events.filter((e) => e.agentId === agentId);
  if (ours.length === 0) {
    return { agentId, state: 'idle', lastEvent: null, inFlightEvent: null };
  }

  const lastEvent = ours[ours.length - 1];

  // An `error` event always wins — recoverable or not, the UI flags it so
  // the operator notices. The next non-error `*-start` from the same agent
  // will move it back into "working".
  if (lastEvent.event === 'error') {
    return { agentId, state: 'errored', lastEvent, inFlightEvent: null };
  }

  const openStack: string[] = [];
  for (const ev of ours) {
    const completeName = START_TO_COMPLETE[ev.event];
    if (completeName) {
      openStack.push(completeName);
      continue;
    }
    const matchIdx = openStack.lastIndexOf(ev.event);
    if (matchIdx >= 0) openStack.splice(matchIdx, 1);
  }

  if (openStack.length > 0) {
    const expected = openStack[openStack.length - 1];
    const startName = Object.entries(START_TO_COMPLETE).find(
      ([, complete]) => complete === expected,
    )?.[0] ?? null;
    return { agentId, state: 'working', lastEvent, inFlightEvent: startName };
  }

  return { agentId, state: 'idle', lastEvent, inFlightEvent: null };
}

export function deriveAllAgentStates(events: LogEvent[], agentIds: string[]): AgentSnapshot[] {
  return agentIds.map((id) => deriveAgentState(events, id));
}
