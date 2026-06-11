import { useCallback, useRef } from 'react';
import type { DemoVerdict, Failure, PanelVerdict, VerdictEntry } from '../types';
import { AGENTS } from '../config';
import { VerdictCard } from './VerdictCard';
import { DemoVerdictCard } from './DemoVerdictCard';

type Revision = PanelVerdict['round2Revisions'][number];

type Props = {
  verdicts: VerdictEntry[];
  failures: Failure[];
  // Optional: when present, each judge's round-2 outcome is forwarded to
  // its VerdictCard as a deliberation footer. Absent on round-1-race
  // runs; in that case the cards render exactly as Phase 0 did.
  panelVerdict?: PanelVerdict | null;
  // Phase 3 demo additions. demoVerdict present → render the demo card in the
  // last slot. demoVideoRetrievalUrl is the playable URL recovered from the
  // SubmissionRecord via /verify (null when that lookup failed). Both absent on
  // no-video runs, so the grid is byte-identical to Phase 1/2 then.
  demoVerdict?: DemoVerdict | null;
  demoVerdictRootHash?: string | null;
  demoVideoRetrievalUrl?: string | null;
};

// Render in canonical judge order regardless of which one returned first,
// so the panel reads the same way every run. judge-demo is deliberately NOT
// in this list (role 'demo') — it renders as its own card in the last slot.
const JUDGE_ORDER = AGENTS.filter((a) => a.role === 'judge').map((a) => a.id);

export function VerdictGrid({
  verdicts,
  failures,
  panelVerdict,
  demoVerdict,
  demoVerdictRootHash,
  demoVideoRetrievalUrl,
}: Props) {
  const byId = new Map<string, VerdictEntry>(verdicts.map((v) => [v.judgeId, v]));
  const failByJudge = new Map<string, Failure>(failures.map((f) => [f.judgeId, f]));
  const revisionByAgent = new Map<string, Revision>(
    (panelVerdict?.round2Revisions ?? []).map((r) => [r.agentId, r]),
  );

  // The single <video> element lives in DemoVerdictCard, but the ref is owned
  // here so the text-judge cards (siblings in this grid) can seek it when a
  // cross-modal revision cites a timestamp. seek() is the one place that knows
  // how: set time, scroll the player into view, play.
  const videoRef = useRef<HTMLVideoElement>(null);
  const seek = useCallback((seconds: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = seconds;
    v.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // play() rejects if autoplay is blocked; the seek already happened, so
    // swallow it.
    void v.play().catch(() => {});
  }, []);

  // Seek links are only interactive when there's actually a player to seek.
  const onSeek = demoVerdict && demoVideoRetrievalUrl ? seek : undefined;

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
              onSeek={onSeek}
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

      {demoVerdict ? (
        <DemoVerdictCard
          demoVerdict={demoVerdict}
          demoVerdictRootHash={demoVerdictRootHash ?? null}
          retrievalUrl={demoVideoRetrievalUrl ?? null}
          videoRef={videoRef}
          onSeek={onSeek}
        />
      ) : null}
    </section>
  );
}
