'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

const basePath =
  process.env.NODE_ENV === 'production'
    ? `/${process.env.NEXT_PUBLIC_REGION_SHORT || 'use1'}`
    : '';

function ChallengeForm() {
  const searchParams = useSearchParams();
  const oidc = searchParams?.get('oidc') ?? null;
  const [solved, setSolved] = useState(0);
  const [required, setRequired] = useState(1);
  const [widgetKey, setWidgetKey] = useState(0); // bump to remount the widget for the next solve
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    import('altcha').catch(console.error); // registers <altcha-widget>
  }, []);

  const finish = useCallback((uid: string) => {
    window.location.href = `${basePath}/api/oidc/interaction/${uid}`;
  }, []);

  // Mirrors (authlogin)/login/page.tsx's handleAltchaStateChange — same
  // `(ev: CustomEvent) => void` signature the `altcha` package's ambient
  // JSX.IntrinsicElements declares for onstatechange (no ts-expect-error
  // needed: `import('altcha')` above pulls in that global augmentation).
  const onStateChange = useCallback(
    async (ev: CustomEvent) => {
      if (ev.detail?.state !== 'verified' || !ev.detail?.payload || busy || done) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`${basePath}/api/captcha/verify-login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ altcha: ev.detail.payload }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(body?.error || 'Verification failed. Try again.');
          setWidgetKey((k) => k + 1); // reset for a fresh attempt
          return;
        }
        setSolved(body.solved ?? solved + 1);
        setRequired(body.required ?? required);
        if (body.done) {
          setDone(true);
          if (oidc) finish(oidc);
          else setError('Missing login context. Please restart your login.');
        } else {
          setWidgetKey((k) => k + 1); // arm the next solve
        }
      } catch {
        setError('Network error. Try again.');
        setWidgetKey((k) => k + 1);
      } finally {
        setBusy(false);
      }
    },
    [busy, done, oidc, required, solved, finish]
  );

  return (
    <div className="max-w-md mx-auto mt-[10vh] p-6 text-center">
      <h1 className="text-xl font-bold text-foreground mb-2">One more step</h1>
      <p className="text-default-500 mb-5">
        Complete the verification to finish signing in.
        {required > 1 && ` (${Math.min(solved, required)} of ${required} solved)`}
      </p>

      {done ? (
        <p className="text-success font-semibold">Verified — completing sign-in…</p>
      ) : (
        // `key` on the wrapper (not the custom element itself — AltchaWidgetReact's
        // type doesn't declare `key`) forces a full remount of the widget subtree
        // so it re-fetches a fresh challenge for each solve.
        <div key={widgetKey}>
          <altcha-widget
            challengeurl={`${basePath}/api/captcha/challenge`}
            onstatechange={onStateChange}
            hidefooter
            hidelogo
          />
        </div>
      )}

      {busy && <p className="text-default-500 mt-3">Checking…</p>}
      {error && <p className="text-danger mt-3">{error}</p>}
      {!oidc && !done && (
        <p className="text-danger mt-3 text-sm">
          Missing login context — please restart your login.
        </p>
      )}
    </div>
  );
}

export default function ChallengePage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-md mx-auto mt-[10vh] p-6 text-center">
          <div className="h-6 w-40 mx-auto rounded bg-content2 animate-pulse mb-3" />
          <div className="h-4 w-64 mx-auto rounded bg-content2 animate-pulse" />
        </div>
      }
    >
      <ChallengeForm />
    </Suspense>
  );
}
