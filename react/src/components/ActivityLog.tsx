import { useEffect, useMemo, useRef, useState } from 'react';
import type { LogEvent } from '../types';
import { AGENTS } from '../config';

type Props = {
  events: LogEvent[];
  submissionId?: string | null;
};

const FILTER_ALL = '__all__';

function formatRow(ev: LogEvent): string {
  const bits: string[] = [];
  if (typeof ev.durationMs === 'number') bits.push(`${ev.durationMs}ms`);
  if (ev.rootHash) bits.push(`root=${String(ev.rootHash).slice(0, 10)}…`);
  if (ev.error) bits.push(`error=${ev.error}`);
  return bits.join(' · ');
}

export function ActivityLog({ events, submissionId }: Props) {
  const [filter, setFilter] = useState<string>(FILTER_ALL);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  const filtered = useMemo(() => {
    return events.filter((ev) => {
      if (submissionId && ev.submissionId && ev.submissionId !== submissionId) return false;
      if (filter !== FILTER_ALL && ev.agentId !== filter) return false;
      return true;
    });
  }, [events, submissionId, filter]);

  // Auto-scroll to bottom unless the user has scrolled up. We track the
  // intent in a ref so re-renders don't re-pin scroll prematurely.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [filtered]);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
    stickToBottomRef.current = distanceFromBottom < 32;
  }

  return (
    <section className="activity-log">
      <header className="activity-log__header">
        <h3 className="activity-log__title">Activity</h3>
        <div className="activity-log__filters">
          <button
            type="button"
            className={'filter-chip' + (filter === FILTER_ALL ? ' is-active' : '')}
            onClick={() => setFilter(FILTER_ALL)}
          >
            all
          </button>
          {AGENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              className={'filter-chip' + (filter === a.id ? ' is-active' : '')}
              onClick={() => setFilter(a.id)}
            >
              {a.label.toLowerCase()}
            </button>
          ))}
        </div>
      </header>
      <div className="activity-log__body" ref={containerRef} onScroll={handleScroll}>
        {filtered.length === 0 ? (
          <div className="activity-log__empty">No events yet.</div>
        ) : (
          filtered.map((ev, i) => (
            <div key={i} className={'activity-log__row activity-log__row--' + ev.agentId}>
              <span className="activity-log__time">{new Date(ev.timestamp).toLocaleTimeString()}</span>
              <span className="activity-log__agent">{ev.agentId}</span>
              <span className="activity-log__event">{ev.event}</span>
              <span className="activity-log__meta">{formatRow(ev)}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
