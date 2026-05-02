import { useApp } from '../AppContext';
import { SubmissionForm } from '../components/SubmissionForm';
import { AgentGrid } from '../components/AgentGrid';
import { ActivityLog } from '../components/ActivityLog';
import { VerdictGrid } from '../components/VerdictGrid';
import { RunSummary } from '../components/RunSummary';
import { PanelVerdictCard } from '../components/PanelVerdictCard';

export function DashboardPage() {
  const { events, run, submit } = useApp();

  const isRunning = run.status === 'submitting';
  const showRunSection = run.status !== 'idle';
  const completed = run.status === 'complete' && run.response !== null;
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
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
