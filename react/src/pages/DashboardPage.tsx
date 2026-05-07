import { useApp } from '../AppContext';
import { SubmissionForm } from '../components/SubmissionForm';
import { AgentGrid } from '../components/AgentGrid';
import { ActivityLog } from '../components/ActivityLog';
import { VerdictGrid } from '../components/VerdictGrid';
import { RunSummary } from '../components/RunSummary';
import { PanelVerdictCard } from '../components/PanelVerdictCard';
import { DeliberatingCard } from '../components/DeliberatingCard';

const JUDGE_AGENT_IDS = ['judge-technical', 'judge-originality', 'judge-skeptic'];

export function DashboardPage() {
  const { events, run, submit } = useApp();

  const isRunning = run.status === 'submitting';
  const showRunSection = run.status !== 'idle';
  const completed = run.status === 'complete' && run.response !== null;

  // Skeleton gate: while the response is in flight, derive "round-1 done,
  // panel pending" from the SSE feed. We can't filter by submissionId yet
  // (intake assigns it server-side and it isn't on the wire until the
  // response lands), so we use run.startedAt as a cutoff and count
  // distinct judge-call-complete events for the three judges. The skeleton
  // hides as soon as panel-aggregate-complete arrives, even before the
  // HTTP response settles, so the swap to the real PanelVerdictCard is
  // visually clean.
  const showDeliberating = (() => {
    if (!isRunning || run.startedAt === null) return false;
    const since = run.startedAt;
    let panelDone = false;
    const judgesDone = new Set<string>();
    for (const ev of events) {
      const ts = ev.timestamp ? Date.parse(ev.timestamp) : NaN;
      if (!Number.isFinite(ts) || ts < since) continue;
      if (ev.event === 'panel-aggregate-complete') panelDone = true;
      if (
        ev.event === 'judge-call-complete' &&
        ev.agentId &&
        JUDGE_AGENT_IDS.includes(ev.agentId)
      ) {
        judgesDone.add(ev.agentId);
      }
    }
    return judgesDone.size >= 3 && !panelDone;
  })();
  // While submitting, we don't yet know the submissionId (intake generates
  // it server-side), so the activity log shows the full feed and lets the
  // user watch the swarm wake up. Once the response lands we filter to
  // this run's events only.
  const activeSubmissionId = completed && run.response ? run.response.submissionId : null;

  // RunSummary renders only when a run produced a result — either a panel
  // verdict OR a confirmed round-1-race failure. Both are derived in
  // useSubmission; we just gate the render here.
  const showRunSummary =
    completed && run.response !== null && (run.response.panelVerdict !== null || run.failedRound1);

  return (
    <div className="dashboard-page">
      <SubmissionForm
        disabled={isRunning}
        onSubmit={submit}
        errorMessage={run.errorMessage}
      />

      <AgentGrid events={events} />

      {showRunSection ? (
        <section className="run-section">
          {completed && run.response ? (
            <header className="run-summary">
              <div className="run-summary__row">
                <span className="run-summary__label">submission</span>
                <code className="run-summary__value">{run.response.submissionId}</code>
              </div>
              <div className="run-summary__row">
                <span className="run-summary__label">submission root</span>
                <code className="run-summary__value">{run.response.submissionRootHash}</code>
              </div>
              <div className="run-summary__row">
                <span className="run-summary__label">verdicts</span>
                <span className="run-summary__value">
                  {run.response.verdicts.length} of 3
                  {run.response.failures.length > 0
                    ? ` (${run.response.failures.length} failed)`
                    : ''}
                </span>
              </div>
            </header>
          ) : (
            <header className="run-summary run-summary--pending">
              <span>Running panel for </span>
              <code className="run-summary__value">{run.repoUrl}</code>
              <span>…</span>
            </header>
          )}

          {showRunSummary && run.response ? (
            <RunSummary
              verdicts={run.response.verdicts}
              failures={run.response.failures}
              panelVerdict={run.response.panelVerdict}
              failedRound1={run.failedRound1}
            />
          ) : null}

          <ActivityLog events={events} submissionId={activeSubmissionId} />

          {completed && run.response ? (
            <VerdictGrid
              verdicts={run.response.verdicts}
              failures={run.response.failures}
              panelVerdict={run.response.panelVerdict}
            />
          ) : null}

          {completed && run.response && run.response.panelVerdict ? (
            <PanelVerdictCard
              panelVerdict={run.response.panelVerdict}
              panelVerdictRootHash={run.response.panelVerdictRootHash}
            />
          ) : showDeliberating ? (
            <DeliberatingCard />
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
