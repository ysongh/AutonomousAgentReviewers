import { Fragment } from 'react';

// Matches an MM:SS (or M:SS) timestamp as a whole token. This is the same
// shape the demo judge cites everywhere — DemoVerdict evidence observations,
// claims_check timestamps, and (when a cross-modal revision fires) the text
// judges' revisionReasoning. Turning each into a button is what makes a
// cross-modal revision legible: the skeptic's "[02:54] shows all five agents
// running" becomes click-and-see.
const TIMESTAMP_RE = /\b(\d{1,2}):(\d{2})\b/g;

// Parse a single standalone "MM:SS" token to seconds. Returns null for
// anything that isn't a bare timestamp (e.g. the claims_check `timestamp`
// field can be null). Tolerant of surrounding whitespace.
export function parseTimestamp(token: string | null | undefined): number | null {
  if (!token) return null;
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(token);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

type Props = {
  text: string;
  // When present, each MM:SS token renders as a button that seeks the inline
  // demo video. When ABSENT (no playable video on this run), tokens render as
  // plain text — the seek affordance only exists when there is something to
  // seek, per the Phase 4 contract.
  onSeek?: (seconds: number) => void;
};

export function SeekableText({ text, onSeek }: Props) {
  if (!onSeek) return <>{text}</>;

  const parts: Array<string | { ts: string; seconds: number }> = [];
  let lastIndex = 0;
  // Fresh regex per render — a global regex carries lastIndex state, so reusing
  // the module-level one across calls would skip matches.
  const re = new RegExp(TIMESTAMP_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    parts.push({ ts: match[0], seconds: Number(match[1]) * 60 + Number(match[2]) });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));

  return (
    <>
      {parts.map((part, i) =>
        typeof part === 'string' ? (
          <Fragment key={i}>{part}</Fragment>
        ) : (
          <button
            key={i}
            type="button"
            className="seek-link"
            onClick={() => onSeek(part.seconds)}
            title={`Jump to ${part.ts} in the demo video`}
          >
            {part.ts}
          </button>
        ),
      )}
    </>
  );
}
