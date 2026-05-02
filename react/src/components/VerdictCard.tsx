import { useState } from 'react';
import type { PanelVerdict, VerdictEntry } from '../types';

type Revision = PanelVerdict['round2Revisions'][number];

type Props = {
  entry: VerdictEntry;
  // Optional: this judge's round-2 outcome. Absent when the run skipped
  // aggregation (round-1 race) or when this specific judge has no entry
  // in round2Revisions for any reason. The card renders fine without it
  // — the deliberation footer is purely additive.
  revision?: Revision;
};

function shorten(hash: string): string {
  if (!hash) return '';
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

// Tiny inline icons. Inline SVG keeps us dependency-free; a single icon
// font would be overkill for three glyphs.
function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3 8h9M9 5l3 3-3 3"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M5 7V5a3 3 0 0 1 6 0v2M4 7h8v6H4z"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function WarnIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 2 1.5 13.5h13zM8 6.5v3.5M8 11.5v.5"
        stroke="currentColor"
        strokeWidth="1.4"
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DeliberationRow({
  revision,
  round1Score,
}: {
  revision: Revision;
  round1Score: number;
}) {
  const [open, setOpen] = useState(false);

  if (revision.revised) {
    const newScore = revision.revisedScore ?? round1Score;
    return (
      <div className="deliberation-row deliberation-row--revised">
        <button
          type="button"
          className="deliberation-row__summary"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <ArrowIcon />
          <span>
            Score: {round1Score} → {newScore}
          </span>
          <span className="deliberation-row__toggle">
            {open ? 'hide' : 'after deliberation'}
          </span>
        </button>
        {open && revision.revisionReasoning ? (
          <p className="deliberation-row__detail">{revision.revisionReasoning}</p>
        ) : null}
      </div>
    );
  }

  if (revision.abstainReason === 'failure') {
    return (
      <div
        className="deliberation-row deliberation-row--failed"
        title="Judge could not participate in deliberation due to a 0G upload failure. Round-1 score retained."
      >
        <WarnIcon />
        <span>
          Score: {round1Score} <em>(panel-only — judge unavailable)</em>
        </span>
      </div>
    );
  }

  // Default branch: held by choice (or held by absence-of-failure marker).
  return (
    <div className="deliberation-row deliberation-row--held">
      <LockIcon />
      <span>Score: {round1Score} (held)</span>
    </div>
  );
}

export function VerdictCard({ entry, revision }: Props) {
  const { judgeId, verdictRootHash, verdict } = entry;
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(verdictRootHash);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // best effort; clipboard API may be blocked in some contexts
    }
  }

  return (
    <article className="verdict-card">
      <header className="verdict-card__header">
        <span className="verdict-card__judge">{judgeId}</span>
        <span className="verdict-card__score">{verdict.score}<span className="verdict-card__score-max">/10</span></span>
      </header>
      <p className="verdict-card__reasoning">{verdict.reasoning}</p>
      <ul className="verdict-card__evidence">
        {verdict.evidence.map((ev, i) => (
          <li key={i}>{ev}</li>
        ))}
      </ul>
      {revision ? (
        <DeliberationRow revision={revision} round1Score={verdict.score} />
      ) : null}
      <footer className="verdict-card__footer">
        <span className="verdict-card__hash" title={verdictRootHash}>
          0G: {shorten(verdictRootHash)}
        </span>
        <button type="button" className="verdict-card__copy" onClick={handleCopy}>
          {copied ? 'copied' : 'copy hash'}
        </button>
      </footer>
    </article>
  );
}
