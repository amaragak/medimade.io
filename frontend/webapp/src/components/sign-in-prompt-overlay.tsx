"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  ensureMedimadeSession,
  getMedimadeApiBase,
  getMedimadeSessionDisplayName,
  getMedimadeSessionEmail,
  getMedimadeSessionJwt,
  loginAsMedimadeGuest,
  requestMedimadeMagicLink,
} from "@/lib/medimade-api";
import {
  rememberAuthNext,
  safeAuthNext,
} from "@/lib/app-routes";
import {
  exitMarketingPreviewMode,
  preservedSessionLabel,
} from "@/lib/marketing-preview";

type Props = {
  /** Called when the overlay should close without signing in. */
  onDismiss: () => void;
  /** Path to return to after sign-in. */
  nextPath: string;
};

function SignInPromptInner({ onDismiss, nextPath }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [guestBusy, setGuestBusy] = useState(false);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [resumeLabel, setResumeLabel] = useState<string | null>(null);

  const base = getMedimadeApiBase();
  const next = safeAuthNext(nextPath, "/");
  const anyBusy = busy || guestBusy || resumeBusy;

  useEffect(() => {
    rememberAuthNext(next);
  }, [next]);

  useEffect(() => {
    const sync = () => {
      if (!getMedimadeSessionJwt()) {
        setResumeLabel(null);
        return;
      }
      setResumeLabel(
        preservedSessionLabel(
          getMedimadeSessionDisplayName(),
          getMedimadeSessionEmail(),
        ),
      );
    };
    sync();
    window.addEventListener("medimade-session-changed", sync);
    return () => window.removeEventListener("medimade-session-changed", sync);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSent(false);
    setBusy(true);
    try {
      rememberAuthNext(next);
      await requestMedimadeMagicLink(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send link");
    } finally {
      setBusy(false);
    }
  }

  async function continueAsGuest() {
    setError(null);
    setGuestBusy(true);
    try {
      await loginAsMedimadeGuest();
      exitMarketingPreviewMode();
      window.location.assign(next);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not start guest session",
      );
      setGuestBusy(false);
    }
  }

  async function resumeSession() {
    setError(null);
    setResumeBusy(true);
    try {
      exitMarketingPreviewMode();
      await ensureMedimadeSession();
      if (!getMedimadeSessionJwt()) {
        throw new Error("Session expired — sign in again");
      }
      router.replace(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resume session");
      setResumeBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="signin-prompt-title"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Dismiss"
        onClick={onDismiss}
      />
      <div className="relative z-[1] w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
        <h2
          id="signin-prompt-title"
          className="font-display text-2xl font-medium tracking-tight text-foreground"
        >
          Sign in to continue
        </h2>
        <p className="mt-2 text-sm text-muted">
          That page is for signed-in accounts. Sign in or continue as guest to
          open it.
        </p>

        {!base ? (
          <p className="mt-6 text-sm text-muted">
            Sign-in isn’t configured in this environment.
          </p>
        ) : sent ? (
          <p className="mt-6 rounded-xl border border-border bg-background p-4 text-sm text-foreground">
            Check your email for a sign-in link. After you open it, we’ll bring
            you back here.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="signin-prompt-email"
                className="block text-sm font-medium text-foreground"
              >
                Email
              </label>
              <input
                id="signin-prompt-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                placeholder="you@example.com"
              />
            </div>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <button
              type="submit"
              disabled={anyBusy}
              className="w-full rounded-xl accent-fill-gradient px-4 py-2.5 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Sending…" : "Email me a link"}
            </button>
          </form>
        )}

        {base && !sent ? (
          <>
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center" aria-hidden>
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase tracking-wide">
                <span className="bg-card px-3 text-muted">or</span>
              </div>
            </div>
            <button
              type="button"
              disabled={anyBusy}
              onClick={() => void continueAsGuest()}
              className="w-full cursor-pointer rounded-xl border border-border bg-transparent px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              {guestBusy ? "Starting…" : "Continue as guest"}
            </button>
            {resumeLabel ? (
              <>
                <div className="relative my-6">
                  <div
                    className="absolute inset-0 flex items-center"
                    aria-hidden
                  >
                    <div className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase tracking-wide">
                    <span className="bg-card px-3 text-muted">or</span>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={anyBusy}
                  onClick={() => void resumeSession()}
                  className="w-full cursor-pointer rounded-xl border border-accent/50 bg-accent-soft/30 px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-accent-soft/50 disabled:opacity-50"
                >
                  {resumeBusy ? "Opening…" : `Open app as ${resumeLabel}`}
                </button>
                <p className="mt-2 text-center text-xs text-muted">
                  Resume the session you left when viewing the marketing page.
                </p>
              </>
            ) : null}
          </>
        ) : null}

        <div className="mt-6 flex items-center justify-between gap-3 text-sm">
          <button
            type="button"
            onClick={onDismiss}
            className="cursor-pointer text-muted underline-offset-2 hover:text-foreground hover:underline"
          >
            Stay on this page
          </button>
          <Link
            href={`/login?next=${encodeURIComponent(next)}`}
            className="text-accent-link underline-offset-2 hover:underline"
            onClick={() => rememberAuthNext(next)}
          >
            Full sign-in page
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Overlay shown on marketing pages when redirected from a protected app URL
 * (`?signin=1&next=…`).
 */
export function SignInPromptOverlay({
  open,
  nextPath,
  onDismiss,
}: {
  open: boolean;
  nextPath: string;
  onDismiss: () => void;
}) {
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <SignInPromptInner nextPath={nextPath} onDismiss={onDismiss} />
    </Suspense>
  );
}

/** Hook-friendly reader for ?signin=1&next= from the URL. */
export function useSignInPromptQuery(): {
  wantsSignIn: boolean;
  nextPath: string;
  clearSignInQuery: () => void;
} {
  const router = useRouter();
  const searchParams = useSearchParams();
  const wantsSignIn = searchParams.get("signin") === "1";
  const nextPath = safeAuthNext(searchParams.get("next"), "/");

  function clearSignInQuery() {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.delete("signin");
    url.searchParams.delete("next");
    const qs = url.searchParams.toString();
    router.replace(`${url.pathname}${qs ? `?${qs}` : ""}${url.hash}`);
  }

  return { wantsSignIn, nextPath, clearSignInQuery };
}
