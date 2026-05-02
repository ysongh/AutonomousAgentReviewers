import type { Failure, PanelVerdict, VerdictEntry } from '../types';
import { AGENTS } from '../config';
import { VerdictCard } from './VerdictCard';

type Revision = PanelVerdict['round2Revisions'][number];

type Props = {
  verdicts: VerdictEntry[];
  failures: Failure[];
  // Optional: when present, each judge's round-2 outcome is forwarded to
  // its VerdictCard as a deliberation footer. Absent on round-1-race
  // runs; in that case the cards render exactly as Phase 0 did.
  panelVerdict?: PanelVerdict | null;
};

// Render in canonical judge order regardless of which one returned first,
// so the panel reads the same way every run.
const JUDGE_ORDER = AGENTS.filter((a) => a.role === 'judge').map((a) => a.id);

export function VerdictGrid({ verdicts, failures, panelVerdict }: Props) {
  const byId = new Map<string, VerdictEntry>(verdicts.map((v) => [v.judgeId, v]));
  const failByJudge = new Map<string, Failure>(failures.map((f) => [f.judgeId, f]));
  const revisionByAgent = new Map<string, Revision>(
    (panelVerdict?.round2Revisions ?? []).map((r) => [r.agentId, r]),
  );

  return (
    <section className="verdict-grid">
      {JUDGE_ORDER.map((judgeId) => {
        const entry = byId.get(judgeId);
        if (entry) {
          return (
            <VerdictCard
              key={judgeId}
              entry={entry}
              revision={revisionByAgent.get(judgeId)}
            />
          );
        }
        const failure = failByJudge.get(judgeId);
        return (
          <article key={judgeId} className="verdict-card verdict-card--failed">
            <header className="verdict-card__header">
              <span className="verdict-card__judge">{judgeId}</span>
              <span className="verdict-card__score verdict-card__score--failed">—</span>
            </header>
            <p className="verdict-card__reasoning">
              {failure ? failure.error : 'No verdict returned for this judge.'}
            </p>
          </article>
        );
      })}
    </section>
  );
}
