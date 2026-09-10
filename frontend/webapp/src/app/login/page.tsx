"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  getMedimadeApiBase,
  loginAsMedimadeGuest,
  requestMedimadeMagicLink,
} from "@/lib/medimade-api";
import { rememberAuthNext, safeAuthNext } from "@/lib/app-routes";

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeAuthNext(searchParams.get("next"), "/");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [guestBusy, setGuestBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const base = getMedimadeApiBase();

  useEffect(() => {
    rememberAuthNext(next);
  }, [next]);

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
      router.replace(next);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not start guest session",
      );
      setGuestBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
      <h1 className="font-display text-3xl font-medium tracking-tight">Sign in</h1>
      <p className="mt-2 text-sm text-muted">
        We email you a one-time link. No password. Your library and cloud journal are tied to
        this account.
      </p>

      {!base ? (
        <p className="mt-8 rounded-xl border border-border bg-card p-4 text-sm text-muted">
          Set <code className="rounded bg-background px-1 py-0.5">NEXT_PUBLIC_MEDIMADE_API_URL</code>{" "}
          to enable sign-in.
        </p>
      ) : sent ? (
        <p className="mt-8 rounded-xl border border-border bg-card p-4 text-sm text-foreground">
          Check your email for a sign-in link. You can close this tab.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-foreground">
              Email
            </label>
            <input
              id="email"
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
          {error ? (
            <p className="text-sm text-danger">{error}</p>
          ) : null}
          <button
            type="submit"
            disabled={busy || guestBusy}
            className="w-full rounded-xl accent-fill-gradient px-4 py-2.5 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Sending…" : "Email me a link"}
          </button>
        </form>
      )}

      {base && !sent ? (
        <>
          <div className="relative my-8">
            <div className="absolute inset-0 flex items-center" aria-hidden>
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase tracking-wide">
              <span className="bg-background px-3 text-muted">or</span>
            </div>
          </div>

          <button
            type="button"
            disabled={busy || guestBusy}
            onClick={() => void continueAsGuest()}
            className="w-full cursor-pointer rounded-xl border border-border bg-transparent px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            {guestBusy ? "Starting…" : "Continue as guest"}
          </button>
          <p className="mt-2 text-center text-xs text-muted">
            Opens the shared guest account — no email required.
          </p>
        </>
      ) : null}

      <p className="mt-8 text-center text-sm text-muted">
        <Link href="/" className="text-accent-link underline-offset-2 hover:underline">
          Back to home
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <p className="text-sm text-muted">Loading…</p>
        </div>
      }
    >
      <LoginInner />
    </Suspense>
  );
}
