import type { DemoVerdict, Failure, PanelVerdict, VerdictEntry } from '../types';

type Props = {
  verdicts: VerdictEntry[];
  failures: Failure[];
  panelVerdict: PanelVerdict | null;
  failedRound1: boolean;
  // Phase 3 demo fields, all from the /submit response and all absent on a
  // no-video run. demoVerdict drives the demo segment; the two errors drive the
  // amber degraded/failed chips that make a degraded run distinguishable from a
  // no-video run at a glance. Held/revised math is unchanged (text judges only).
  demoVerdict?: DemoVerdict | null;
  demoVideoError?: string;
  demoVerdictError?: string;
};

type Tone = 'ok' | 'warn' | 'err';

// One horizontal line that compresses the run outcome into three segments:
// round-1 fan-out result, deliberation result, and the final headline.
// Renders only when a run has produced a result — the parent decides the
// gating; this component just trusts the props it gets.
export function RunSummary({
  verdicts,
  failures,
  panelVerdict,
  failedRound1,
  demoVerdict,
  demoVideoError,
  demoVerdictError,
}: Props) {
  // Round-1 race: intake skipped aggregation. Re-submit is the only fix.
  if (failedRound1) {
    const successCount = verdicts.length;
    return (
      <section className="run-summary-line">
        <span className="run-summary-line__seg">
          Round 1: {successCount}/3 ✗
        </span>
        <span className="run-summary-line__sep">•</span>
        <span className="run-summary-line__seg">Aggregation skipped</span>
        <span className="run-summary-line__sep">•</span>
        <span className="run-summary-line__headline run-summary-line__headline--err">
          Re-submit recommended
        </span>
      </section>
    );
  }

  // Defensive: caller should not render this component without panelVerdict
  // when failedRound1 is false. If it happens, render nothing rather than
  // a half-formed line.
  if (!panelVerdict) return null;

  // Counts come from the normalized round2Revisions (abstainReason was
  // tagged in useSubmission). held = chose to hold; abstained = forced
  // by /revise failure; revised = adopted a new score.
  let revisedCount = 0;
  let heldCount = 0;
  let abstainedCount = 0;
  for (const r of panelVerdict.round2Revisions) {
    if (r.revised) revisedCount += 1;
    else if (r.abstainReason === 'failure') abstainedCount += 1;
    else heldCount += 1;
  }

  // Tone for the right-most segment:
  //  - red  → round-1 race (handled above)
  //  - amber → dissent OR any abstain-due-to-failure
  //  - green → converged AND clean
  const tone: Tone = abstainedCount > 0 || panelVerdict.dissent ? 'warn' : 'ok';
  const headlineLabel = panelVerdict.dissent ? '⚖ DISSENT' : '✓ CONVERGED';
  const score = panelVerdict.weightedAggregate.toFixed(2);

  // "2 held + 1 revised + 1 abstained (failure)" — only emit nonzero pieces
  // so the line stays tight on clean runs.
  const deliberationParts: string[] = [];
  if (heldCount > 0) deliberationParts.push(`${heldCount} held`);
  if (revisedCount > 0) deliberationParts.push(`${revisedCount} revised`);
  if (abstainedCount > 0) {
    deliberationParts.push(`${abstainedCount} abstained (failure)`);
  }
  const deliberationText =
    deliberationParts.length > 0 ? deliberationParts.join(' + ') : 'no revisions';

  // Round-1 success line: count fulfilled verdicts; failures shown only if
  // any (a clean run is "3/3 ✓", a partial round-2 run is still "3/3 ✓"
  // because round-1 succeeded — the abstentions are deliberation-side).
  const round1Text =
    failures.length === 0
      ? `${verdicts.length}/3 ✓`
      : `${verdicts.length}/3 (${failures.length} failed)`;

  // Demo segment: score, plus the contradicted count only when nonzero —
  // contradicted is the attention-worthy signal (a claim the video disproved).
  let demoText: string | null = null;
  if (demoVerdict) {
    const contradicted = demoVerdict.claims_check.filter(
      (c) => c.verdict === 'contradicted',
    ).length;
    demoText = `Demo: ${demoVerdict.score}${
      contradicted > 0 ? ` (${contradicted} contradicted)` : ''
    }`;
  }

  return (
    <section className="run-summary-line">
      <span className="run-summary-line__seg">Round 1: {round1Text}</span>
      <span className="run-summary-line__sep">•</span>
      <span className="run-summary-line__seg">Deliberation: {deliberationText}</span>
      <span className="run-summary-line__sep">•</span>
      <span className={`run-summary-line__headline run-summary-line__headline--${tone}`}>
        Panel: {score} {headlineLabel}
      </span>
      {demoText ? (
        <>
          <span className="run-summary-line__sep">•</span>
          <span className="run-summary-line__seg">{demoText}</span>
        </>
      ) : null}
      {demoVideoError ? (
        <span
          className="run-summary-line__chip run-summary-line__chip--warn"
          title={`Video degraded — ${demoVideoError}`}
        >
          ⚠ video degraded — panel ran without demo review
        </span>
      ) : null}
      {demoVerdictError ? (
        <span
          className="run-summary-line__chip run-summary-line__chip--warn"
          title={`Demo review failed — ${demoVerdictError}`}
        >
          ⚠ demo review failed — panel ran without demo
        </span>
      ) : null}
    </section>
  );
}
