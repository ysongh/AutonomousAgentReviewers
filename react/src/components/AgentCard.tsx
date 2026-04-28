import type { AgentDescriptor } from '../config';
import type { AgentSnapshot } from '../lib/deriveAgentState';

type Props = {
  descriptor: AgentDescriptor;
  snapshot: AgentSnapshot;
};

function formatTime(ts?: string) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return '';
  }
}

function formatLatest(snapshot: AgentSnapshot): string {
  if (!snapshot.lastEvent) return 'no events yet';
  if (snapshot.state === 'working' && snapshot.inFlightEvent) {
    return snapshot.inFlightEvent;
  }
  return snapshot.lastEvent.event;
}

function formatDuration(ms?: number) {
  if (typeof ms !== 'number' || !isFinite(ms)) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function AgentCard({ descriptor, snapshot }: Props) {
  const duration = formatDuration(snapshot.lastEvent?.durationMs);
  const stateClass = `agent-card agent-card--${snapshot.state}`;
  return (
    <article className={stateClass}>
      <header className="agent-card__header">
        <span className={'status-dot status-dot--' + snapshot.state} />
        <span className="agent-card__label">{descriptor.label}</span>
        <span className="agent-card__role">{descriptor.role}</span>
      </header>
      <div className="agent-card__body">
        <div className="agent-card__event">{formatLatest(snapshot)}</div>
        <div className="agent-card__meta">
          {duration ? <span className="agent-card__duration">{duration}</span> : null}
          <span className="agent-card__time">{formatTime(snapshot.lastEvent?.timestamp)}</span>
        </div>
      </div>
    </article>
  );
}
