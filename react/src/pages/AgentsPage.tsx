import { useApp } from '../AppContext';
import { AGENTS } from '../config';
import { deriveAgentState } from '../lib/deriveAgentState';
import type { LogEvent } from '../types';

const HISTORY_DEPTH = 20;

function eventsForAgent(events: LogEvent[], agentId: string): LogEvent[] {
  // Newest first so the most recent activity is at the top of the panel.
  return events.filter((e) => e.agentId === agentId).slice(-HISTORY_DEPTH).reverse();
}

export function AgentsPage() {
  const { events } = useApp();

  return (
    <div className="agents-page">
      <header className="agents-page__header">
        <h2>Agents</h2>
        <p className="agents-page__lede">
          Last {HISTORY_DEPTH} events per service since this dashboard tab opened.
          History does not persist across reloads.
        </p>
      </header>

      <div className="agents-page__grid">
        {AGENTS.map((descriptor) => {
          const history = eventsForAgent(events, descriptor.id);
          const snapshot = deriveAgentState(events, descriptor.id);
          return (
            <section key={descriptor.id} className={'agent-detail agent-detail--' + snapshot.state}>
              <header className="agent-detail__header">
                <span className={'status-dot status-dot--' + snapshot.state} />
                <span className="agent-detail__label">{descriptor.label}</span>
                <span className="agent-detail__role">{descriptor.role}</span>
                <span className="agent-detail__count">{history.length} recent</span>
              </header>
              <div className="agent-detail__events">
                {history.length === 0 ? (
                  <div className="agent-detail__empty">no events yet</div>
                ) : (
                  history.map((ev, i) => (
                    <div key={i} className="agent-detail__event">
                      <span className="agent-detail__time">
                        {new Date(ev.timestamp).toLocaleTimeString()}
                      </span>
                      <span className="agent-detail__event-name">{ev.event}</span>
                      {typeof ev.durationMs === 'number' ? (
                        <span className="agent-detail__duration">{ev.durationMs}ms</span>
                      ) : null}
                      {ev.error ? (
                        <span className="agent-detail__error">{ev.error}</span>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
