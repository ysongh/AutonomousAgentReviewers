import type { LogEvent } from '../types';
import { AGENTS, AGENT_IDS } from '../config';
import { deriveAllAgentStates } from '../lib/deriveAgentState';
import { AgentCard } from './AgentCard';

type Props = {
  events: LogEvent[];
};

export function AgentGrid({ events }: Props) {
  const snapshots = deriveAllAgentStates(events, AGENT_IDS);
  return (
    <section className="agent-grid">
      {AGENTS.map((descriptor, i) => (
        <AgentCard key={descriptor.id} descriptor={descriptor} snapshot={snapshots[i]} />
      ))}
    </section>
  );
}
