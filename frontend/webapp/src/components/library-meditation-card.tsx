"use client";

import Link from "next/link";
import * as Switch from "@radix-ui/react-switch";
import { type ReactNode } from "react";
import { ChatMarkdown } from "@/components/chat-markdown";
import {
  type LibraryMeditationItem,
  libraryMeditationCategoryLabel,
} from "@/lib/medimade-api";
import { type PendingLibraryGeneration } from "@/lib/pending-library-generations";
import { stripPauseMarkers } from "@/lib/meditation-analytics";

export function formatAudioClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) {
    return "—";
  }
  const m = Math.floor(seconds / 60);
  const s = Math.max(0, Math.floor(seconds % 60));
  return `${m}m ${s}s`;
}

export function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function IconMixer({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M4 21V10M4 6V3M12 21v-7M12 8V3M20 21v-5M20 10V3" />
      <circle cx="4" cy="8" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="10" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="20" cy="12" r="2.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconHeart({
  filled,
  className,
  strokeWidth = 2,
}: {
  filled: boolean;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path
        d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"
        fill={filled ? "currentColor" : "none"}
      />
    </svg>
  );
}

export type PendingLibraryMeditationItem = {
  kind: "pending";
  pendingKey: string;
  jobId: string;
  title: string;
  description: string | null;
  createdAt: string;
  meditationStyle: string | null;
  speakerName: string | null;
  speakerModelId: string | null;
  status: "pending" | "running" | "failed";
  error: string | null;
};

export type LibraryMeditationRow =
  | LibraryMeditationItem
  | PendingLibraryMeditationItem;

export function isPendingRow(
  x: LibraryMeditationRow,
): x is PendingLibraryMeditationItem {
  return (x as PendingLibraryMeditationItem).kind === "pending";
}

export function pendingGenerationToRow(
  p: PendingLibraryGeneration,
): PendingLibraryMeditationItem {
  return {
    kind: "pending",
    pendingKey: `pending:${p.jobId}`,
    jobId: p.jobId,
    title: p.title,
    description: p.description ?? null,
    createdAt: p.createdAt,
    meditationStyle: p.meditationStyle ?? null,
    speakerName: p.speakerName ?? null,
    speakerModelId: p.speakerModelId ?? null,
    status: p.status ?? "pending",
    error: p.error ?? null,
  };
}

export type LibraryMeditationCardProps = {
  item: LibraryMeditationRow;
  viewMode: "list" | "grid";
  hideOwnerActions?: boolean;
  /** Community tab hides stars entirely; program shelf shows disabled stars. */
  showRating?: boolean;
  ratingDisabled?: boolean;
  allowShare?: boolean;
  alwaysShowRowChrome?: boolean;
  isSelected?: boolean;
  isPlaying?: boolean;
  playingTimeSeconds?: number;
  onPlay?: () => void;
  onTogglePlay?: () => void;
  scriptExpanded?: boolean;
  onToggleScript?: () => void;
  mobileOpen?: boolean;
  onToggleMobile?: () => void;
  ratingBusy?: boolean;
  favouriteBusy?: boolean;
  archiveBusy?: boolean;
  onRating?: (rating: number | null) => void;
  onFavourite?: (favourite: boolean) => void;
  onArchive?: () => void;
  onPublicChange?: (isPublic: boolean) => void;
  onOpenMix?: (anchorEl: HTMLElement) => void;
  mixEditorSk?: string | null;
  onCloseMix?: () => void;
  shareCopiedId?: string | null;
  onShare?: () => void;
  onRemovePending?: (jobId: string) => void;
  itemRef?: (el: HTMLLIElement | null) => void;
  devOverlay?: ReactNode;
};

export function LibraryMeditationCard({
  item,
  viewMode,
  hideOwnerActions = false,
  showRating = true,
  ratingDisabled = false,
  allowShare = false,
  alwaysShowRowChrome = false,
  isSelected = false,
  isPlaying = false,
  playingTimeSeconds = 0,
  onPlay,
  onTogglePlay,
  scriptExpanded = false,
  onToggleScript,
  mobileOpen = false,
  onToggleMobile,
  ratingBusy = false,
  favouriteBusy = false,
  archiveBusy = false,
  onRating,
  onFavourite,
  onArchive,
  onPublicChange,
  onOpenMix,
  mixEditorSk = null,
  onCloseMix,
  shareCopiedId = null,
  onShare,
  onRemovePending,
  itemRef,
  devOverlay,
}: LibraryMeditationCardProps) {
  if (isPendingRow(item)) {
    const isFailed = item.status === "failed";
    const spinner = (
      <svg
        className="h-5 w-5 animate-spin"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        aria-hidden
      >
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      </svg>
    );
    const failIcon = (
      <svg
        className="h-5 w-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
      </svg>
    );
    return (
      <li
        ref={itemRef}
        className={`relative min-w-0 overflow-hidden rounded-2xl border p-4 shadow-sm ${
          isFailed
            ? "border-danger/35 bg-danger/5"
            : "border-accent/35 bg-accent-soft/20"
        }`}
      >
        {!isFailed ? (
          <>
            <div
              aria-hidden
              className="pointer-events-none absolute left-0 top-0 h-1 w-full bg-accent/10"
            >
              <div
                className="h-full w-1/3 bg-accent/60"
                style={{
                  animation: "mmIndeterminateBar 1.4s ease-in-out infinite",
                }}
              />
            </div>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 animate-pulse bg-accent-soft/30"
            />
          </>
        ) : null}
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg font-medium leading-snug">
              {item.title}
            </h2>
            <p className="mt-1 text-sm text-muted">{item.description ?? "—"}</p>
            {isFailed ? (
              <p className="mt-2 text-sm text-danger">
                {item.error ?? "Generation failed."}
              </p>
            ) : null}
            <p className="mt-2 text-xs text-muted">
              {formatWhen(item.createdAt)}
              {item.speakerName ? ` · ${item.speakerName}` : ""}
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <div
              className={`flex h-11 w-11 items-center justify-center rounded-full ${
                isFailed
                  ? "bg-danger/10 text-danger"
                  : "bg-selected/10 text-selected"
              }`}
              aria-label={isFailed ? "Generation failed" : "Generating"}
              title={isFailed ? "Generation failed" : "Generating"}
            >
              {isFailed ? failIcon : spinner}
            </div>
            {onRemovePending ? (
              <button
                type="button"
                onClick={() => onRemovePending(item.jobId)}
                className="cursor-pointer rounded-full border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:border-accent/35 hover:bg-accent-soft/20"
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>
      </li>
    );
  }

  const m = item;

  if (m.isDraft === true) {
    const href =
      m.sk != null
        ? `/meditate/create?draftSk=${encodeURIComponent(m.sk)}`
        : "/meditate/create";
    const continueBtn = (
      <Link
        href={href}
        className="inline-flex shrink-0 items-center justify-center rounded-full accent-fill-gradient px-4 py-2.5 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90"
      >
        Continue
      </Link>
    );
    if (viewMode === "grid") {
      return (
        <li
          ref={itemRef}
          className="group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-sm"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            Draft
          </p>
          <h2 className="font-display mt-2 text-lg font-medium leading-snug">
            {m.title}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {m.meditationStyle?.trim() ? m.meditationStyle : "—"}
          </p>
          <p className="mt-3 text-xs text-muted">{formatWhen(m.createdAt)}</p>
          <div className="mt-auto pt-4">{continueBtn}</div>
        </li>
      );
    }
    return (
      <li
        ref={itemRef}
        className="group relative min-w-0 overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-sm"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <span className="inline-block rounded-full border border-border bg-accent-soft/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-link">
              Draft
            </span>
            <h2 className="font-display mt-2 text-lg font-medium leading-snug">
              {m.title}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {m.meditationStyle?.trim()
                ? m.meditationStyle
                : "Style not set yet"}
            </p>
            <p className="mt-2 text-xs text-muted">
              Saved {formatWhen(m.createdAt)}
            </p>
          </div>
          {continueBtn}
        </div>
      </li>
    );
  }

  const open = scriptExpanded;
  const styleLine = libraryMeditationCategoryLabel(m);
  const lengthLine = formatDuration(m.durationSeconds);

  const stars = showRating ? (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={!m.sk || ratingBusy || ratingDisabled}
          onClick={() => onRating?.(m.rating === star ? null : star)}
          className={`rounded px-0.5 text-base leading-none sm:text-lg ${
            m.rating != null && star <= m.rating
              ? "text-accent"
              : "text-star-idle"
          } ${!m.sk || ratingDisabled ? "cursor-not-allowed opacity-40" : ""}`}
          title={
            ratingDisabled
              ? "Ratings aren’t available on program classes"
              : m.sk
                ? undefined
                : "Ratings need a catalogued row (generated after metadata deploy)"
          }
        >
          ★
        </button>
      ))}
    </div>
  ) : null;

  const favouriteDisabled = !m.sk || favouriteBusy;
  const favouriteBtn = hideOwnerActions ? null : (
    <button
      type="button"
      onClick={() => onFavourite?.(!m.favourite)}
      disabled={favouriteDisabled}
      aria-label={m.favourite ? "Unfavourite meditation" : "Favourite meditation"}
      className={`self-center items-center justify-center p-1 transition-opacity transition-colors ${
        m.favourite || alwaysShowRowChrome
          ? "opacity-100 pointer-events-auto"
          : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"
      } ${
        m.favourite ? "text-selected" : "text-muted"
      } ${
        favouriteDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      }`}
    >
      <IconHeart filled={m.favourite} strokeWidth={2.5} />
    </button>
  );

  const canEditMix = m.liveMix === true && Boolean(m.sk) && !m.isDraft;
  const mixerBtn =
    canEditMix && onOpenMix ? (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (mixEditorSk === m.sk) {
            onCloseMix?.();
            return;
          }
          onOpenMix(e.currentTarget);
        }}
        aria-expanded={mixEditorSk === m.sk}
        aria-label="Edit background mix"
        className={`self-center items-center justify-center p-1 text-muted transition-opacity ${
          alwaysShowRowChrome || mixEditorSk === m.sk
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"
        } cursor-pointer`}
      >
        <IconMixer />
      </button>
    ) : null;

  const archiveDisabled = !m.sk || archiveBusy || ratingBusy || favouriteBusy;
  const publicDisabled = !m.sk;
  const rowChrome = alwaysShowRowChrome
    ? "opacity-100 pointer-events-auto"
    : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto";
  const publicBtn =
    !hideOwnerActions && m.sk && !m.isDraft && onPublicChange ? (
      <div
        className={`flex items-center gap-2 transition-opacity ${rowChrome} ${
          publicDisabled ? "cursor-not-allowed opacity-50" : ""
        }`}
        title={
          m.isPublic === true
            ? "Public — in Community"
            : "Make public in Community"
        }
      >
        <span
          className={`text-[11px] font-medium tracking-wide ${
            m.isPublic === true ? "text-accent-link" : "text-muted"
          }`}
        >
          Public
        </span>
        <Switch.Root
          checked={m.isPublic === true}
          onCheckedChange={(v) => onPublicChange(Boolean(v))}
          disabled={publicDisabled}
          aria-label={
            m.isPublic ? "Remove from community library" : "Make public"
          }
          className="relative h-5 w-9 shrink-0 rounded-full border border-border bg-muted/40 transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:cursor-not-allowed"
        >
          <Switch.Thumb className="block h-4 w-4 translate-x-[2px] rounded-full bg-surface shadow-sm transition-transform will-change-transform data-[state=checked]:translate-x-[16px]" />
        </Switch.Root>
      </div>
    ) : null;
  const archiveBtn =
    hideOwnerActions || !onArchive ? null : (
      <button
        type="button"
        onClick={() => {
          if (!m.sk) return;
          onArchive();
        }}
        disabled={archiveDisabled}
        aria-label="Archive meditation"
        className={`rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-semibold text-muted transition-opacity transition-colors hover:border-accent/40 hover:text-foreground ${rowChrome} ${
          archiveDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
        }`}
        title="Archive"
      >
        Archive
      </button>
    );

  const shareId = m.id?.trim() || "";
  const shareBtn =
    allowShare && shareId && onShare ? (
      <button
        type="button"
        onClick={onShare}
        aria-label="Copy share link"
        className={`rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-semibold text-muted transition-opacity transition-colors hover:border-accent/40 hover:text-foreground ${
          !showRating ? "" : rowChrome
        } cursor-pointer`}
        title={
          shareCopiedId === shareId
            ? "Link copied"
            : "Copy link to this meditation"
        }
      >
        {shareCopiedId === shareId ? "Copied!" : "Share"}
      </button>
    ) : null;

  const scriptToggleBtn =
    m.scriptText && m.sk != null && onToggleScript ? (
      <button
        type="button"
        onClick={onToggleScript}
        className={`ml-2 ${
          open
            ? "inline-flex"
            : alwaysShowRowChrome
              ? "inline-flex"
              : "hidden group-hover:inline-flex"
        } items-center font-bold text-accent-link hover:text-accent-link/80 cursor-pointer`}
        style={{ lineHeight: "1.35" }}
      >
        {open ? "hide script" : "show script"}
      </button>
    ) : null;

  const playControl = isPlaying ? (
    <div className="flex items-center gap-2">
      <span className="tabular-nums text-xs font-semibold text-muted sm:inline">
        {formatAudioClock(playingTimeSeconds)}
      </span>
      <button
        type="button"
        onClick={() => onTogglePlay?.()}
        className="flex h-[38px] w-[38px] shrink-0 cursor-pointer items-center justify-center rounded-full accent-fill-gradient text-on-accent sm:h-11 sm:w-11"
        aria-label="Pause"
      >
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="currentColor"
          aria-hidden
        >
          <path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
        </svg>
      </button>
    </div>
  ) : (
    <button
      type="button"
      onClick={() => (isSelected ? onTogglePlay?.() : onPlay?.())}
      className={
        alwaysShowRowChrome
          ? "flex h-[38px] w-[38px] shrink-0 cursor-pointer items-center justify-center rounded-full accent-fill-gradient text-on-accent opacity-100 pointer-events-auto transition-opacity sm:h-11 sm:w-11"
          : "flex h-[38px] w-[38px] shrink-0 cursor-pointer items-center justify-center rounded-full accent-fill-gradient text-on-accent opacity-100 pointer-events-auto transition-opacity sm:h-11 sm:w-11 sm:opacity-0 sm:pointer-events-none sm:group-hover:opacity-100 sm:group-hover:pointer-events-auto"
      }
      aria-label="Play"
    >
      <svg
        viewBox="0 0 24 24"
        width="22"
        height="22"
        fill="currentColor"
        aria-hidden
      >
        <path d="M8 5v14l11-7L8 5z" />
      </svg>
    </button>
  );

  const actions = (
    <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
      {playControl}
    </div>
  );

  const mobileFavouriteBtn = hideOwnerActions ? null : (
    <button
      type="button"
      onClick={() => onFavourite?.(!m.favourite)}
      disabled={favouriteDisabled}
      aria-label={m.favourite ? "Unfavourite meditation" : "Favourite meditation"}
      className={`flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border border-border bg-background transition-colors ${
        m.favourite ? "text-selected border-selected/40" : "text-muted"
      } ${
        favouriteDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      }`}
    >
      <IconHeart filled={m.favourite} strokeWidth={2.5} />
    </button>
  );

  const mobileMixerBtn =
    canEditMix && onOpenMix ? (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (mixEditorSk === m.sk) {
            onCloseMix?.();
            return;
          }
          onOpenMix(e.currentTarget);
        }}
        aria-expanded={mixEditorSk === m.sk}
        aria-label="Edit background mix"
        className="flex h-[38px] w-[38px] shrink-0 cursor-pointer items-center justify-center rounded-full border border-border bg-background text-muted"
      >
        <IconMixer />
      </button>
    ) : null;

  const scriptBlock =
    open && m.scriptText ? (
      <div className="max-h-64 overflow-y-auto rounded-xl border border-border bg-background/80 p-3">
        <ChatMarkdown
          text={stripPauseMarkers(m.scriptText)}
          className="font-serif text-[13px] leading-relaxed text-foreground/95"
        />
        {m.scriptTruncated ? (
          <p className="mt-2 text-xs text-muted">
            Script was truncated for storage.
          </p>
        ) : null}
      </div>
    ) : null;

  const mobileCardBody = (
    <div className="sm:hidden">
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 flex-1 font-display text-lg font-medium leading-snug">
          {m.title}
        </h2>
        <span className="mt-1.5 shrink-0 tabular-nums text-xs font-semibold text-muted">
          {lengthLine}
        </span>
      </div>
      <span className="mt-2 inline-block rounded-full bg-accent-soft/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-link">
        {styleLine}
      </span>
      <p className="mt-2 line-clamp-2 text-sm text-muted">
        {m.description ?? "—"}
      </p>
      <div className="mt-3 flex items-center gap-2">
        {playControl}
        {mobileOpen ? mobileMixerBtn : null}
        {mobileFavouriteBtn}
        {!mobileOpen && onToggleMobile ? (
          <button
            type="button"
            onClick={onToggleMobile}
            className="ml-auto cursor-pointer text-sm font-semibold text-accent-link"
            aria-expanded={false}
          >
            More ⌄
          </button>
        ) : (
          <span className="ml-auto" aria-hidden />
        )}
      </div>
      {mobileOpen ? (
        <div className="mt-3 space-y-3">
          {m.scriptText && m.sk != null && onToggleScript ? (
            <button
              type="button"
              onClick={onToggleScript}
              className="cursor-pointer font-bold text-accent-link hover:text-accent-link/80"
              style={{ lineHeight: "1.35" }}
            >
              {open ? "Hide script" : "Show script"}
            </button>
          ) : null}
          {scriptBlock}
          {stars}
          <p className="text-xs text-muted">
            {formatWhen(m.createdAt)}
            {m.speakerName ? ` · ${m.speakerName}` : ""}
          </p>
          {publicBtn || archiveBtn || shareBtn ? (
            <div className="flex items-center gap-3 border-t border-border/70 pt-3 [&_*]:!opacity-100 [&_*]:!pointer-events-auto">
              {publicBtn}
              {shareBtn}
              {archiveBtn}
            </div>
          ) : null}
          {onToggleMobile ? (
            <button
              type="button"
              onClick={onToggleMobile}
              className="w-full cursor-pointer text-right text-sm font-semibold text-accent-link"
              aria-expanded={true}
            >
              Show less ⌃
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  if (viewMode === "grid") {
    return (
      <li
        ref={itemRef}
        className={`group relative flex min-w-0 flex-col overflow-visible rounded-2xl border bg-card p-5 shadow-sm ${
          isPlaying
            ? "border-accent"
            : "border-border hover:border-accent/80 transition-colors"
        }`}
      >
        {devOverlay}
        {isPlaying ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-accent border-accent-pulse"
          />
        ) : null}
        {mobileCardBody}
        <div className="hidden min-w-0 flex-1 flex-col sm:flex">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-wide text-accent-link">
              {styleLine}
            </p>
          </div>
          <div className="mt-2 flex items-start gap-3">
            <h2 className="font-display text-lg font-medium leading-snug">
              {m.title}
            </h2>
            <span className="mt-1.5 shrink-0 tabular-nums text-xs font-semibold text-muted">
              {lengthLine}
            </span>
          </div>
          <div className="mt-1 text-sm text-muted">
            {m.description ?? "—"}
            {scriptToggleBtn}
          </div>
          <div className="mt-3 flex w-full items-center gap-3 text-xs text-muted">
            <span className="min-w-0 flex-1">
              {formatWhen(m.createdAt)}
              {m.speakerName ? ` · ${m.speakerName}` : ""}
            </span>
            {publicBtn || archiveBtn || shareBtn ? (
              <span className="shrink-0 flex items-center gap-3">
                {publicBtn}
                {shareBtn}
                {archiveBtn}
              </span>
            ) : null}
          </div>
          {scriptBlock ? <div className="mt-4">{scriptBlock}</div> : null}
          <div className="mt-auto flex items-center justify-between gap-3 translate-y-2">
            <div>{stars}</div>
            <div className="flex items-center gap-2">
              {actions}
              {mixerBtn}
              {favouriteBtn}
            </div>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li
      ref={itemRef}
      className={`group relative min-w-0 overflow-visible rounded-2xl border bg-card p-4 shadow-sm ${
        isPlaying
          ? "border-accent"
          : "border-border hover:border-accent/80 transition-colors"
      }`}
    >
      {devOverlay}
      {isPlaying ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-accent border-accent-pulse"
        />
      ) : null}
      {mobileCardBody}
      <div className="hidden sm:block">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2 gap-y-1">
                <div className="flex items-start gap-3">
                  <h2 className="min-w-0 font-display text-lg font-medium leading-snug">
                    {m.title}
                  </h2>
                  <span className="mt-1.5 shrink-0 tabular-nums text-xs font-semibold text-muted">
                    {lengthLine}
                  </span>
                </div>
                <span className="rounded-full bg-accent-soft/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-link">
                  {styleLine}
                </span>
              </div>
            </div>
            <div className="mt-1 text-sm text-muted">
              {m.description ?? "—"}
              {scriptToggleBtn}
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center lg:flex-col lg:items-end xl:flex-col xl:items-end">
            {stars}
            <div className="flex items-center gap-2 lg:self-end">
              {actions}
              {mixerBtn}
              {favouriteBtn}
            </div>
          </div>
        </div>
        <div className="mt-2 flex w-full items-center gap-3 text-xs text-muted">
          <span className="min-w-0 flex-1">
            {formatWhen(m.createdAt)}
            {m.speakerName ? ` · ${m.speakerName}` : ""}
          </span>
          {publicBtn || archiveBtn || shareBtn ? (
            <span className="shrink-0 flex items-center gap-3">
              {publicBtn}
              {shareBtn}
              {archiveBtn}
            </span>
          ) : null}
        </div>
        {scriptBlock ? (
          <div className="mt-4 border-t border-border pt-4">{scriptBlock}</div>
        ) : null}
      </div>
    </li>
  );
}
