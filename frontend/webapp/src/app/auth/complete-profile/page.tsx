"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import {
  getMedimadeSessionEmail,
  getMedimadeSessionJwt,
  saveMedimadeProfileDisplayName,
  setMedimadeSession,
} from "@/lib/medimade-api";
import { decodeMedimadeJwtPayloadUnverified } from "@/lib/medimade-jwt-payload";

function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

function CompleteProfileInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get("next"));
  const [phase, setPhase] = useState<"check" | "form" | "saving" | "err">("check");
  const [message, setMessage] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");

  useEffect(() => {
    const jwt = getMedimadeSessionJwt();
    if (!jwt) {
      router.replace(`/login?next=${encodeURIComponent(next)}`);
      return;
    }
    const payload = decodeMedimadeJwtPayloadUnverified(jwt);
    if (payload?.name?.trim()) {
      setMedimadeSession(jwt, getMedimadeSessionEmail(), payload.name.trim());
      router.replace(next);
      return;
    }
    setPhase("form");
  }, [next, router]);

  const onSubmitName = useCallback(async () => {
    const trimmed = nameInput.trim();
    if (trimmed.length < 1 || trimmed.length > 80) {
      setMessage("Enter a name between 1 and 80 characters.");
      return;
    }
    setMessage(null);
    setPhase("saving");
    try {
      const { token, displayName } = await saveMedimadeProfileDisplayName(trimmed);
      const email = getMedimadeSessionEmail();
      setMedimadeSession(token, email, displayName);
      router.replace(next);
    } catch (e) {
      setPhase("form");
      setMessage(e instanceof Error ? e.message : "Could not save your name");
    }
  }, [nameInput, next, router]);

  if (phase === "check") {
    return (
      <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
        <p className="text-sm text-muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
      <h1 className="font-display text-3xl font-medium tracking-tight">Your name</h1>
      <p className="mt-2 text-sm text-muted">
        Add how you would like to be addressed. This stays on your account.
      </p>
      <div className="mt-6 space-y-4">
        <label
          className="block text-sm font-semibold text-foreground"
          htmlFor="complete-profile-display-name"
        >
          Display name
        </label>
        <input
          id="complete-profile-display-name"
          type="text"
          autoComplete="name"
          autoFocus
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          maxLength={80}
          className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground shadow-sm outline-none ring-accent/30 focus:border-accent/50 focus:ring-2"
          placeholder="e.g. Alex"
          disabled={phase === "saving"}
        />
        {message ? (
          <p className="text-sm text-red-600 dark:text-red-400">{message}</p>
        ) : null}
        <button
          type="button"
          onClick={() => void onSubmitName()}
          disabled={phase === "saving" || !nameInput.trim()}
          className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-40 dark:text-deep"
        >
          {phase === "saving" ? "Saving…" : "Continue"}
        </button>
        <p className="text-center text-sm text-muted">
          <Link href="/" className="text-accent underline-offset-2 hover:underline">
            Back to home
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function CompleteProfilePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
          <p className="text-sm text-muted">Loading…</p>
        </div>
      }
    >
      <CompleteProfileInner />
    </Suspense>
  );
}
