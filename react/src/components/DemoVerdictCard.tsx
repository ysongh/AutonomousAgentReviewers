import { useState, type RefObject } from 'react';
import type { ClaimVerdict, DemoVerdict } from '../types';
import { SeekableText, parseTimestamp } from '../lib/SeekableText';
import { VerifyOn0GModal } from './VerifyOn0GModal';

type Props = {
  demoVerdict: DemoVerdict;
  demoVerdictRootHash: string | null;
  // The playable Filecoin retrieval URL, recovered from the SubmissionRecord
  // via /verify (it never lands on the /submit response). null when that
  // lookup failed or is still pending — the card then renders without a player
  // and timestamps stay non-interactive.
  retrievalUrl: string | null;
  // Owned by VerdictGrid so the text-judge cards can seek this same element.
  videoRef: RefObject<HTMLVideoElement | null>;
  // Present iff there is a playable video to seek (see SeekableText).
  onSeek?: (seconds: number) => void;
};

function shorten(hash: string): string {
  if (!hash) return '';
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

// Same three-bucket score coloring the PanelVerdictCard uses. Inlined rather
// than shared — the repo favors copy over abstraction for the judge surface,
// and it's three lines.
function scoreTone(score: number): 'good' | 'mid' | 'bad' {
  if (score >= 7) return 'good';
  if (score >= 4) return 'mid';
  return 'bad';
}

// Contradicted is the attention-worthy signal, so it sorts first; asserted-only
// (unproven) next; shown (corroborated) last. Stable within each bucket.
const CLAIM_ORDER: Record<ClaimVerdict, number> = {
  contradicted: 0,
  'asserted-only': 1,
  shown: 2,
};

const CLAIM_LABEL: Record<ClaimVerdict, string> = {
  contradicted: 'contradicted',
  'asserted-only': 'asserted',
  shown: 'shown',
};

export function DemoVerdictCard({
  demoVerdict,
  demoVerdictRootHash,
  retrievalUrl,
  videoRef,
  onSeek,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [videoBroken, setVideoBroken] = useState(false);

  const { score, reasoning, evidence, claims_check } = demoVerdict;

  async function handleCopy() {
    if (!demoVerdictRootHash) return;
    try {
      await navigator.clipboard.writeText(demoVerdictRootHash);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // best effort
    }
  }

  const sortedClaims = [...claims_check].sort(
    (a, b) => CLAIM_ORDER[a.verdict] - CLAIM_ORDER[b.verdict],
  );

  const showPlayer = retrievalUrl !== null && !videoBroken;

  return (
    <article className="demo-verdict-card">
      <header className="verdict-card__header">
        <span className="verdict-card__judge demo-verdict-card__judge">judge-demo</span>
        <span className={`verdict-card__score demo-verdict-card__score--${scoreTone(score)}`}>
          {score}
          <span className="verdict-card__score-max">/10</span>
        </span>
      </header>

      {showPlayer ? (
        <video
          ref={videoRef}
          className="demo-verdict-card__video"
          src={retrievalUrl ?? undefined}
          controls
          preload="metadata"
          onError={() => setVideoBroken(true)}
        />
      ) : (
        <p className="demo-verdict-card__video-unavailable">
          Video unavailable from provider — review below is unaffected.
        </p>
      )}

      <p className="verdict-card__reasoning">
        <SeekableText text={reasoning} onSeek={onSeek} />
      </p>

      <div className="claims-check">
        <div className="claims-check__title">Claims check</div>
        <table className="claims-check__table">
          <tbody>
            {sortedClaims.map((c, i) => {
              const seekable = onSeek && parseTimestamp(c.timestamp) !== null;
              return (
                <tr key={i} className="claims-check__row">
                  <td className="claims-check__verdict-cell">
                    <span className={`claim-chip claim-chip--${c.verdict}`}>
                      {CLAIM_LABEL[c.verdict]}
                    </span>
                  </td>
                  <td className="claims-check__claim-cell">{c.claim}</td>
                  <td className="claims-check__ts-cell">
                    {c.timestamp ? (
                      seekable ? (
                        <SeekableText text={c.timestamp} onSeek={onSeek} />
                      ) : (
                        c.timestamp
                      )
                    ) : (
                      <span className="claims-check__ts-empty">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="demo-evidence">
        <div className="demo-evidence__title">Evidence</div>
        <ul className="demo-evidence__list">
          {evidence.map((ev, i) => (
            <li key={i} className="demo-evidence__item">
              <span className="demo-evidence__ts">
                <SeekableText text={ev.timestamp} onSeek={onSeek} />
              </span>
              <span className="demo-evidence__obs">
                <SeekableText text={ev.observation} onSeek={onSeek} />
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div
        className="demo-verdict-card__final"
        title="The Demo Judge does not deliberate: its verdict describes what the video showed, which peer evidence cannot change. Its round-1 score is its final score."
      >
        Score final by design — the Demo Judge does not deliberate.
      </div>

      {demoVerdictRootHash ? (
        <footer className="verdict-card__footer">
          <span className="verdict-card__hash" title={demoVerdictRootHash}>
            0G: {shorten(demoVerdictRootHash)}
          </span>
          <button type="button" className="verdict-card__copy" onClick={handleCopy}>
            {copied ? 'copied' : 'copy hash'}
          </button>
          <button
            type="button"
            className="verdict-card__copy verdict-card__verify"
            onClick={() => setVerifyOpen(true)}
            aria-label="Verify on 0G Storage"
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6.5 9.5a3 3 0 0 0 4.24 0l2-2a3 3 0 1 0-4.24-4.24l-1 1" />
              <path d="M9.5 6.5a3 3 0 0 0-4.24 0l-2 2a3 3 0 1 0 4.24 4.24l1-1" />
            </svg>
            Verify on 0G
          </button>
        </footer>
      ) : null}

      {verifyOpen && demoVerdictRootHash ? (
        <VerifyOn0GModal
          rootHash={demoVerdictRootHash}
          onClose={() => setVerifyOpen(false)}
        />
      ) : null}
    </article>
  );
}
