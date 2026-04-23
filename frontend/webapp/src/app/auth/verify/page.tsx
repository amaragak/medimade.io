"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import {
  getMedimadeApiBase,
  getMedimadeSessionEmail,
  saveMedimadeProfileDisplayName,
  setMedimadeSession,
  verifyMedimadeMagicLink,
} from "@/lib/medimade-api";

type Phase = "working" | "needsName" | "savingName" | "err" | "redirect";

function VerifyInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [phase, setPhase] = useState<Phase>("working");
  const [message, setMessage] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");

  useEffect(() => {
    const base = getMedimadeApiBase();
    if (!base) {
      setPhase("err");
      setMessage("API URL is not configured.");
      return;
    }
    const token = searchParams.get("token")?.trim() ?? "";
    if (!token) {
      setPhase("err");
      setMessage("Missing token in link. Request a new sign-in email.");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const result = await verifyMedimadeMagicLink(token);
        if (cancelled) return;
        if (result.needsProfileName) {
          setMedimadeSession(result.token, result.email);
          setPhase("needsName");
          return;
        }
        setMedimadeSession(result.token, result.email, result.displayName);
        setPhase("redirect");
        router.replace("/");
      } catch (e) {
        if (cancelled) return;
        setPhase("err");
        setMessage(e instanceof Error ? e.message : "Verification failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  const onSubmitName = useCallback(async () => {
    const trimmed = nameInput.trim();
    if (trimmed.length < 1 || trimmed.length > 80) {
      setMessage("Enter a name between 1 and 80 characters.");
      return;
    }
    setMessage(null);
    setPhase("savingName");
    try {
      const { token, displayName } = await saveMedimadeProfileDisplayName(trimmed);
      const email = getMedimadeSessionEmail();
      setMedimadeSession(token, email, displayName);
      setPhase("redirect");
      router.replace("/");
    } catch (e) {
      setPhase("needsName");
      setMessage(e instanceof Error ? e.message : "Could not save your name");
    }
  }, [nameInput, router]);

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
      <h1 className="font-display text-3xl font-medium tracking-tight">Signing you in</h1>
      {phase === "working" || phase === "redirect" ? (
        <p className="mt-4 text-sm text-muted">
          {phase === "redirect" ? "Redirecting…" : "One moment…"}
        </p>
      ) : null}
      {phase === "err" ? (
        <>
          <p className="mt-4 text-sm text-red-600 dark:text-red-400">{message}</p>
          <p className="mt-6 text-center text-sm">
            <Link href="/login" className="text-accent underline-offset-2 hover:underline">
              Request a new link
            </Link>
          </p>
        </>
      ) : null}
      {phase === "needsName" || phase === "savingName" ? (
        <div className="mt-6 space-y-4">
          <p className="text-sm text-muted">
            Welcome—tell us what to call you. You only see this once for a new account.
          </p>
          <label className="block text-sm font-semibold text-foreground" htmlFor="verify-display-name">
            Your name
          </label>
          <input
            id="verify-display-name"
            type="text"
            autoComplete="name"
            autoFocus
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            maxLength={80}
            className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground shadow-sm outline-none ring-accent/30 focus:border-accent/50 focus:ring-2"
            placeholder="e.g. Alex"
            disabled={phase === "savingName"}
          />
          {message ? (
            <p className="text-sm text-red-600 dark:text-red-400">{message}</p>
          ) : null}
          <button
            type="button"
            onClick={() => void onSubmitName()}
            disabled={phase === "savingName" || !nameInput.trim()}
            className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-40 dark:text-deep"
          >
            {phase === "savingName" ? "Saving…" : "Continue"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function AuthVerifyPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <p className="text-sm text-muted">Loading…</p>
        </div>
      }
    >
      <VerifyInner />
    </Suspense>
  );
}
