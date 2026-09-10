"use client";

/**
 * Meditations created for this life area (Generate meditation / Ideate goal path).
 */

import { useCallback, useEffect, useState } from "react";
import { useLibraryPlayer } from "@/components/library-player-provider";
import {
  isPendingRow,
  LibraryMeditationCard,
  pendingGenerationToRow,
  type LibraryMeditationRow,
} from "@/components/library-meditation-card";
import { useMobileOrTouchChrome } from "@/hooks/use-mobile-or-touch-chrome";
import { isMedimadeSessionActive } from "@/lib/auth-session";
import {
  listLibraryMeditations,
  patchMeditationFavourite,
  patchMeditationRating,
  type LibraryMeditationItem,
} from "@/lib/medimade-api";
import {
  loadPendingGenerations,
  savePendingGenerations,
  PENDING_LIBRARY_GENERATIONS_CHANGED_EVENT,
} from "@/lib/pending-library-generations";

type Props = {
  lifeAreaId: string;
};

function rowKey(m: LibraryMeditationRow): string {
  return isPendingRow(m) ? m.pendingKey : m.sk || m.s3Key;
}

export function PlanLifeAreaMeditationsPanel({ lifeAreaId }: Props) {
  const alwaysShowRowChrome = useMobileOrTouchChrome();
  const {
    nowPlaying,
    playingS3Key,
    playItem,
    toggleCurrent,
    setPlaybackTimeListener,
  } = useLibraryPlayer();

  const [rows, setRows] = useState<LibraryMeditationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [expandedSk, setExpandedSk] = useState<string | null>(null);
  const [mobileCardOpen, setMobileCardOpen] = useState<Record<string, boolean>>(
    {},
  );
  const [ratingBusySk, setRatingBusySk] = useState<string | null>(null);
  const [favouriteBusySk, setFavouriteBusySk] = useState<string | null>(null);
  const [playingTimeSeconds, setPlayingTimeSeconds] = useState(0);

  useEffect(() => {
    setPlaybackTimeListener((_s3Key, timeSeconds) => {
      setPlayingTimeSeconds(timeSeconds);
    });
    return () => setPlaybackTimeListener(null);
  }, [setPlaybackTimeListener]);

  useEffect(() => {
    if (!playingS3Key) setPlayingTimeSeconds(0);
  }, [playingS3Key]);

  const patchLocalItem = useCallback(
    (sk: string, patch: Partial<LibraryMeditationItem>) => {
      setRows((prev) =>
        prev.map((row) => {
          if (isPendingRow(row)) return row;
          if (row.sk !== sk) return row;
          return { ...row, ...patch };
        }),
      );
    },
    [],
  );

  const refresh = useCallback(async () => {
    setErr(null);
    const pending = loadPendingGenerations().filter(
      (p) => p.lifeAreaId === lifeAreaId && p.status !== "failed",
    );

    let library: LibraryMeditationItem[] = [];
    if (isMedimadeSessionActive()) {
      try {
        library = await listLibraryMeditations();
      } catch (e) {
        setErr(
          e instanceof Error ? e.message : "Couldn’t load meditations.",
        );
      }
    }

    const linked = library
      .filter(
        (m) =>
          !m.archived &&
          !m.isDraft &&
          typeof m.lifeAreaId === "string" &&
          m.lifeAreaId === lifeAreaId,
      )
      .sort(
        (a, b) =>
          new Date(b.createdAt ?? 0).getTime() -
          new Date(a.createdAt ?? 0).getTime(),
      );

    const linkedJobIds = new Set(
      linked
        .map((m) => m.jobId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    );

    const pendingRows = pending.map(pendingGenerationToRow);

    const libraryTitles = new Set(
      linked.map((m) => m.title.trim().toLowerCase()),
    );
    const pendingOnly = pendingRows.filter((p) => {
      if (linkedJobIds.has(p.jobId)) return false;
      return !libraryTitles.has(p.title.trim().toLowerCase());
    });

    setRows([...pendingOnly, ...linked]);
    setLoading(false);
  }, [lifeAreaId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
    const onPending = () => void refresh();
    window.addEventListener(
      PENDING_LIBRARY_GENERATIONS_CHANGED_EVENT,
      onPending,
    );
    window.addEventListener("focus", onPending);
    return () => {
      window.removeEventListener(
        PENDING_LIBRARY_GENERATIONS_CHANGED_EVENT,
        onPending,
      );
      window.removeEventListener("focus", onPending);
    };
  }, [refresh]);

  function removePendingJob(jobId: string) {
    const id = jobId.trim();
    if (!id) return;
    const current = loadPendingGenerations();
    const next = current.filter((p) => p.jobId !== id);
    savePendingGenerations(next);
    setRows((prev) =>
      prev.filter((row) => !isPendingRow(row) || row.jobId !== id),
    );
  }

  async function setRating(item: LibraryMeditationItem, rating: number | null) {
    if (!item.sk) return;
    setRatingBusySk(item.sk);
    try {
      await patchMeditationRating(item.sk, rating);
      patchLocalItem(item.sk, { rating });
    } catch {
      // keep prior value
    } finally {
      setRatingBusySk(null);
    }
  }

  async function setFavourite(
    item: LibraryMeditationItem,
    favourite: boolean,
  ) {
    const sk = item.sk;
    if (!sk) return;
    setFavouriteBusySk(sk);
    try {
      await patchMeditationFavourite(sk, favourite);
      patchLocalItem(sk, { favourite });
    } catch {
      // keep prior value
    } finally {
      setFavouriteBusySk(null);
    }
  }

  return (
    <section className="mt-8 w-full min-w-0">
      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : err ? (
        <p className="text-sm text-danger">{err}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm italic text-muted">
          None yet. Use Generate meditation when you have a vision written, or
          pick this life area in Create.
        </p>
      ) : (
        <ul className="flex w-full min-w-0 max-w-full flex-col gap-3">
          {rows.map((m) => {
            const key = rowKey(m);

            if (isPendingRow(m)) {
              return (
                <LibraryMeditationCard
                  key={key}
                  item={m}
                  viewMode="list"
                  onRemovePending={removePendingJob}
                />
              );
            }

            const cardKey = m.s3Key;
            return (
              <LibraryMeditationCard
                key={key}
                item={m}
                viewMode="list"
                hideOwnerActions={false}
                alwaysShowRowChrome={alwaysShowRowChrome}
                isSelected={nowPlaying?.s3Key === m.s3Key}
                isPlaying={playingS3Key === m.s3Key}
                playingTimeSeconds={playingTimeSeconds}
                onPlay={() => playItem(m)}
                onTogglePlay={() => toggleCurrent()}
                scriptExpanded={m.sk != null && expandedSk === m.sk}
                onToggleScript={() =>
                  setExpandedSk((v) => (v === m.sk ? null : (m.sk ?? null)))
                }
                mobileOpen={Boolean(mobileCardOpen[cardKey])}
                onToggleMobile={() =>
                  setMobileCardOpen((prev) => ({
                    ...prev,
                    [cardKey]: !prev[cardKey],
                  }))
                }
                ratingBusy={m.sk != null && ratingBusySk === m.sk}
                favouriteBusy={m.sk != null && favouriteBusySk === m.sk}
                onRating={(rating) => void setRating(m, rating)}
                onFavourite={(favourite) => void setFavourite(m, favourite)}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}
