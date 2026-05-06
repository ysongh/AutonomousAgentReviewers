import { useEffect, useState } from 'react';

type VerifyResponse = {
  rootHash: string;
  retrievedAt: string;
  indexer: string | null;
  content: unknown;
};

type FetchState =
  | { status: 'loading' }
  | { status: 'success'; data: VerifyResponse }
  | { status: 'error'; message: string };

type Props = {
  rootHash: string;
  onClose: () => void;
};

function shorten(hash: string): string {
  if (hash.length <= 22) return hash;
  return `${hash.slice(0, 12)}…${hash.slice(-8)}`;
}

export function VerifyOn0GModal({ rootHash, onClose }: Props) {
  const [state, setState] = useState<FetchState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    fetch(`/verify/${rootHash}`, { signal: controller.signal })
      .then(async (resp) => {
        const text = await resp.text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new Error(`Non-JSON response (HTTP ${resp.status})`);
        }
        if (!resp.ok) {
          const msg = (parsed as { error?: string })?.error ?? `HTTP ${resp.status}`;
          throw new Error(msg);
        }
        setState({ status: 'success', data: parsed as VerifyResponse });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => controller.abort();
  }, [rootHash, attempt]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleCopyHash() {
    try {
      await navigator.clipboard.writeText(rootHash);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // best effort
    }
  }

  return (
    <div className="verify-modal__overlay" onClick={onClose} role="presentation">
      <div
        className="verify-modal__card"
        role="dialog"
        aria-modal="true"
        aria-label="Verify on 0G Storage"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="verify-modal__header">
          <h2 className="verify-modal__title">Verify on 0G Storage</h2>
          <button
            type="button"
            className="verify-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        {state.status === 'loading' ? (
          <div className="verify-modal__loading">
            <div className="verify-modal__spinner" aria-hidden="true" />
            <span>Retrieving from 0G Storage…</span>
          </div>
        ) : null}

        {state.status === 'error' ? (
          <div className="verify-modal__error">
            <p>{state.message}</p>
            <button
              type="button"
              className="verify-modal__retry"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Retry
            </button>
          </div>
        ) : null}

        {state.status === 'success' ? (
          <>
            <dl className="verify-modal__meta">
              <div>
                <dt>Retrieved</dt>
                <dd>{state.data.retrievedAt}</dd>
              </div>
              <div>
                <dt>Root hash</dt>
                <dd>
                  <span className="verify-modal__hash" title={rootHash}>
                    {shorten(rootHash)}
                  </span>
                  <button
                    type="button"
                    className="verify-modal__copy"
                    onClick={handleCopyHash}
                  >
                    {copied ? 'copied' : 'copy'}
                  </button>
                </dd>
              </div>
              <div>
                <dt>Indexer</dt>
                <dd className="verify-modal__indexer">
                  {state.data.indexer ?? '—'}
                </dd>
              </div>
            </dl>
            <pre className="verify-modal__json">
              <code>{JSON.stringify(state.data.content, null, 2)}</code>
            </pre>
          </>
        ) : null}
      </div>
    </div>
  );
}
