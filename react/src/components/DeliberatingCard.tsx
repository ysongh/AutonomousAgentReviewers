// Skeleton card shown between round-1 completion and panel verdict landing.
// Same dimensions/position as PanelVerdictCard so the swap is clean. The
// gate (when to render this vs the real card) is owned by the page.
export function DeliberatingCard() {
  return (
    <article className="deliberating-card" aria-live="polite">
      <div className="deliberating-card__hero">
        <div className="deliberating-card__pulse">Deliberating…</div>
        <div className="deliberating-card__sub">
          Judges reviewing each other's verdicts on 0G Storage
        </div>
      </div>
      <div className="deliberating-card__bar" aria-hidden="true">
        <div className="deliberating-card__bar-fill" />
      </div>
    </article>
  );
}
