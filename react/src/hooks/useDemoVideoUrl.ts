import { useEffect, useState } from 'react';

// Recover the playable Filecoin retrieval URL for the demo video. It lives on
// the SubmissionRecord (`demoVideoRetrievalUrl`), NOT on the /submit response,
// so we read it back through the existing read-only /verify endpoint — which is
// hash-generic and already proxied to log-streamer. This keeps the dashboard a
// passive consumer (no new endpoint, no chain RPC in the browser).
//
// Returns null while loading, on any error, or when disabled. A null URL is a
// first-class state: DemoVerdictCard renders "video unavailable" and the
// timestamp-seek links go non-interactive — the verdict itself is unaffected.
export function useDemoVideoUrl(
  submissionRootHash: string | null,
  enabled: boolean,
): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !submissionRootHash) {
      setUrl(null);
      return;
    }
    const controller = new AbortController();
    setUrl(null);
    fetch(`/verify/${submissionRootHash}`, { signal: controller.signal })
      .then(async (resp) => {
        if (!resp.ok) return;
        const data = (await resp.json()) as { content?: { demoVideoRetrievalUrl?: unknown } };
        const retrieval = data?.content?.demoVideoRetrievalUrl;
        if (typeof retrieval === 'string') setUrl(retrieval);
      })
      .catch(() => {
        // best effort — the card handles a null URL gracefully
      });
    return () => controller.abort();
  }, [submissionRootHash, enabled]);

  return url;
}
