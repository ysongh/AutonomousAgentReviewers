import { useState } from 'react';
import type { PanelVerdict } from '../types';

type Props = {
  panelVerdict: PanelVerdict;
  panelVerdictRootHash: string | null;
};

function shorten(hash: string): string {
  if (!hash) return '';
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

// Three-bucket score color, same gradient the dashboard already uses
// elsewhere via CSS tokens. 0-3 bad, 4-6 mid, 7-10 good. Returns the
// CSS modifier suffix so the caller can compose `.score-badge--good`
// etc. from this single source of truth.
function scoreTone(score: number): 'good' | 'mid' | 'bad' {
  if (score >= 7) return 'good';
  if (score >= 4) return 'mid';
  return 'bad';
}

export function PanelVerdictCard({ panelVerdict, panelVerdictRootHash }: Props) {
  const [copied, setCopied] = useState(false);
  const { finalScores, weightedAggregate, spread, dissent, dissentSummary } = panelVerdict;

  // Build the formula string with the actual numbers substituted in. Goes
  // into the hero's title attribute for hover-tooltip discovery; the
  // formula is the most useful "show your work" affordance the panel has.
  const formula =
    `0.4 × technical(${finalScores.technical}) + ` +
    `0.3 × originality(${finalScores.originality}) + ` +
    `0.3 × skeptic(${finalScores.skeptic}) = ` +
    `${weightedAggregate.toFixed(2)}`;

  async function handleCopy() {
    if (!panelVerdictRootHash) return;
    try {
      await navigator.clipboard.writeText(panelVerdictRootHash);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // best effort
    }
  }

  return (
    <article className="panel-verdict-card">
      <div className="panel-verdict-card__hero" title={formula}>
        <div className="panel-verdict-card__score">
          {weightedAggregate.toFixed(2)}
        </div>
        <div className="panel-verdict-card__label">weighted panel score</div>
      </div>

      <div className="panel-verdict-card__main">
        <div className="panel-verdict-card__badges">
          <span className={`score-badge score-badge--${scoreTone(finalScores.technical)}`}>
            tech {finalScores.technical}
          </span>
          <span className={`score-badge score-badge--${scoreTone(finalScores.originality)}`}>
            orig {finalScores.originality}
          </span>
          <span className={`score-badge score-badge--${scoreTone(finalScores.skeptic)}`}>
            skep {finalScores.skeptic}
          </span>
          <span className="panel-verdict-card__spread">spread: {spread}</span>
          {dissent ? (
            <span className="dissent-pill dissent-pill--dissent">DISSENT</span>
          ) : (
            <span className="dissent-pill dissent-pill--converged">CONVERGED</span>
          )}
        </div>

        <p className="panel-verdict-card__summary">{dissentSummary}</p>
      </div>

      {panelVerdictRootHash ? (
        <footer className="panel-verdict-card__footer">
          <span className="panel-verdict-card__hash" title={panelVerdictRootHash}>
            Panel verdict on 0G: {shorten(panelVerdictRootHash)}
          </span>
          <button type="button" className="verdict-card__copy" onClick={handleCopy}>
            {copied ? 'copied' : 'copy hash'}
          </button>
        </footer>
      ) : null}
    </article>
  );
}
