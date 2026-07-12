'use client';

import { useEffect, useState, useCallback } from 'react';

const basePath =
  process.env.NODE_ENV === 'production'
    ? `/${process.env.NEXT_PUBLIC_REGION_SHORT || 'use1'}`
    : '';

export default function ChallengePage() {
  const [oidc, setOidc] = useState<string | null>(null);
  const [solved, setSolved] = useState(0);
  const [required, setRequired] = useState(1);
  const [widgetKey, setWidgetKey] = useState(0); // bump to remount the widget for the next solve
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setOidc(params.get('oidc'));
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
    <div style={{ maxWidth: 420, margin: '10vh auto', padding: 24, textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>One more step</h1>
      <p style={{ color: '#666', marginBottom: 20 }}>
        Complete the verification to finish signing in.
        {required > 1 && ` (${Math.min(solved, required)} of ${required} solved)`}
      </p>

      {done ? (
        <p style={{ color: '#16a34a', fontWeight: 600 }}>Verified — completing sign-in…</p>
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

      {busy && <p style={{ color: '#666', marginTop: 12 }}>Checking…</p>}
      {error && <p style={{ color: '#dc2626', marginTop: 12 }}>{error}</p>}
      {!oidc && !done && (
        <p style={{ color: '#dc2626', marginTop: 12, fontSize: 13 }}>
          Missing login context — please restart your login.
        </p>
      )}
    </div>
  );
}
