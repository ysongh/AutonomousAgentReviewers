import { useState } from 'react';
import type { VerdictEntry } from '../types';

type Props = {
  entry: VerdictEntry;
};

function shorten(hash: string): string {
  if (!hash) return '';
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

export function VerdictCard({ entry }: Props) {
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
