import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Audio } from "expo-av";
import { Ionicons } from "@expo/vector-icons";
import {
  useFocusEffect,
  useNavigation,
} from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { SafeAreaView } from "react-native-safe-area-context";
import ChatMarkdown from "../components/ChatMarkdown";
import ModalDropdown from "../components/ui/ModalDropdown";
import { colors } from "../theme/colors";
import {
  type LibraryMeditationItem,
  getMeditationAudioJobStatus,
  libraryMeditationCategoryLabel,
  listLibraryMeditations,
  patchMeditationArchived,
  patchMeditationFavourite,
  patchMeditationRating,
} from "../lib/medimade-api";
import {
  loadPendingGenerations,
  type PendingLibraryGeneration,
  savePendingGenerations,
} from "../lib/pending-generations";
import type { RootTabParamList } from "../navigation/RootTabs";

type LibNav = BottomTabNavigationProp<RootTabParamList, "Library">;

type ViewMode = "list" | "grid";
type SortBy = "newest" | "oldest" | "title";
type LibraryMainTab = "meditations" | "drafts";

type PendingLibraryMeditationItem = {
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

type LibraryRow = LibraryMeditationItem | PendingLibraryMeditationItem;

function isPendingRow(x: LibraryRow): x is PendingLibraryMeditationItem {
  return (x as PendingLibraryMeditationItem).kind === "pending";
}

function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) {
    return "—";
  }
  const m = Math.floor(seconds / 60);
  const s = Math.max(0, Math.floor(seconds % 60));
  return `${m}m ${s}s`;
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function stripPauseMarkers(text: string): string {
  return text.replace(/\[\[PAUSE\s+[^\]]+\]\]/g, "");
}

export default function LibraryScreen() {
  const navigation = useNavigation<LibNav>();
  const [items, setItems] = useState<LibraryMeditationItem[]>([]);
  const [pending, setPending] = useState<PendingLibraryGeneration[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scriptItem, setScriptItem] = useState<LibraryMeditationItem | null>(
    null,
  );
  const [ratingBusySk, setRatingBusySk] = useState<string | null>(null);
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [favouriteBusySk, setFavouriteBusySk] = useState<string | null>(null);
  const [archiveBusySk, setArchiveBusySk] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("newest");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [libraryTab, setLibraryTab] = useState<LibraryMainTab>("meditations");
  const [nowPlaying, setNowPlaying] = useState<{
    url: string;
    title: string;
    s3Key: string;
  } | null>(null);
  const [playerBusy, setPlayerBusy] = useState(false);
  const [playerPosition, setPlayerPosition] = useState(0);
  const [playerDuration, setPlayerDuration] = useState(0);
  const [playerPlaying, setPlayerPlaying] = useState(true);
  const soundRef = useRef<Audio.Sound | null>(null);
  const pollBusyRef = useRef(false);
  const libraryFirstFocusRef = useRef(true);

  const fetchList = useCallback(async () => {
    setError(null);
    try {
      setItems(await listLibraryMeditations());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load library");
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    await fetchList();
    setLoading(false);
  }, [fetchList]);

  const refreshPendingFromStorage = useCallback(async () => {
    setPending(await loadPendingGenerations());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshPendingFromStorage();
      if (libraryFirstFocusRef.current) {
        libraryFirstFocusRef.current = false;
        setLoading(true);
        void fetchList().finally(() => setLoading(false));
      } else {
        void fetchList();
      }
    }, [refreshPendingFromStorage, fetchList]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshPendingFromStorage();
    await fetchList();
    setRefreshing(false);
  }, [fetchList, refreshPendingFromStorage]);

  const sortedItems = useMemo(() => {
    const next = [...items];
    if (sortBy === "title") {
      next.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
    } else if (sortBy === "oldest") {
      next.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
    } else {
      next.sort(
        (a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
      );
    }
    return next;
  }, [items, sortBy]);

  const pendingRows: PendingLibraryMeditationItem[] = useMemo(() => {
    const next = [...pending];
    next.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    return next.map((p) => ({
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
    }));
  }, [pending]);

  const categoryOptions = useMemo(() => {
    const base = sortedItems.filter((x) => x.catalogued);
    const afterFav = favouritesOnly ? base.filter((x) => x.favourite) : base;
    const counts: Record<string, number> = {};
    for (const x of afterFav) {
      const key = libraryMeditationCategoryLabel(x);
      if (!key || key === "—") continue;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  }, [sortedItems, favouritesOnly]);

  const categoryDropdownOptions = useMemo(
    () => [
      { label: "All categories", value: "all" },
      ...categoryOptions.map(([cat]) => ({ label: cat, value: cat })),
    ],
    [categoryOptions],
  );

  const visibleItems: LibraryRow[] = useMemo(() => {
    if (libraryTab === "drafts") {
      return sortedItems.filter((x) => x.isDraft === true);
    }
    const base = sortedItems.filter(
      (x) => x.catalogued && x.archived !== true,
    );
    const afterFav = favouritesOnly ? base.filter((x) => x.favourite) : base;
    const afterCat =
      categoryFilter === "all"
        ? afterFav
        : afterFav.filter(
            (x) => libraryMeditationCategoryLabel(x) === categoryFilter,
          );
    return [...pendingRows, ...afterCat];
  }, [
    sortedItems,
    favouritesOnly,
    categoryFilter,
    libraryTab,
    pendingRows,
  ]);

  useEffect(() => {
    if (pending.length === 0) return;

    const runPoll = async () => {
      if (pollBusyRef.current) return;
      pollBusyRef.current = true;
      try {
        const current = await loadPendingGenerations();
        if (current.length === 0) {
          setPending([]);
          return;
        }
        let changed = false;
        let needLibraryRefresh = false;
        const next: PendingLibraryGeneration[] = [];
        for (const p of current) {
          try {
            const st = await getMeditationAudioJobStatus(p.jobId);
            const nextTitle = (st.title ?? "").trim();
            const nextDesc = (st.description ?? "").trim();
            const nextP: PendingLibraryGeneration = { ...p };
            if (nextTitle && nextTitle !== p.title) {
              changed = true;
              nextP.title = nextTitle;
            }
            if (nextDesc && nextDesc !== (p.description ?? "")) {
              changed = true;
              nextP.description = nextDesc;
            }
            if (st.status === "completed") {
              changed = true;
              needLibraryRefresh = true;
              continue;
            }
            if (st.status === "failed") {
              changed = true;
              next.push({
                ...nextP,
                status: "failed",
                error: st.error ?? "Generation failed",
              });
              continue;
            }
            next.push({
              ...nextP,
              status: st.status === "running" ? "running" : "pending",
            });
          } catch {
            next.push(p);
          }
        }
        if (changed) {
          await savePendingGenerations(next);
          setPending(next);
          if (needLibraryRefresh) await fetchList();
        } else {
          setPending(next);
        }
      } finally {
        pollBusyRef.current = false;
      }
    };

    void runPoll();
    const id = setInterval(() => void runPoll(), 2000);
    return () => clearInterval(id);
  }, [pending.length, fetchList]);

  useEffect(() => {
    return () => {
      void soundRef.current?.unloadAsync();
      soundRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!nowPlaying) return;
    let cancelled = false;
    (async () => {
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          allowsRecordingIOS: false,
          staysActiveInBackground: false,
        });
        setPlayerBusy(true);
        if (soundRef.current) {
          await soundRef.current.unloadAsync();
          soundRef.current = null;
        }
        const { sound, status } = await Audio.Sound.createAsync(
          { uri: nowPlaying.url },
          { shouldPlay: true },
        );
        if (cancelled) {
          await sound.unloadAsync();
          return;
        }
        soundRef.current = sound;
        if (status.isLoaded && status.durationMillis != null) {
          setPlayerDuration(status.durationMillis / 1000);
        }
        sound.setOnPlaybackStatusUpdate((s) => {
          if (!s.isLoaded) return;
          setPlayerPlaying(s.isPlaying);
          setPlayerPosition((s.positionMillis ?? 0) / 1000);
          if (s.durationMillis != null) {
            setPlayerDuration(s.durationMillis / 1000);
          }
        });
      } catch {
        setError("Could not start in-app playback. Try Open in browser.");
      } finally {
        setPlayerBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nowPlaying?.url, nowPlaying?.s3Key]);

  async function togglePause() {
    const s = soundRef.current;
    if (!s) return;
    const st = await s.getStatusAsync();
    if (!st.isLoaded) return;
    if (st.isPlaying) await s.pauseAsync();
    else await s.playAsync();
  }

  async function setRating(item: LibraryMeditationItem, rating: number | null) {
    if (!item.sk) return;
    setRatingBusySk(item.sk);
    try {
      await patchMeditationRating(item.sk, rating);
      setItems((prev) =>
        prev.map((x) => (x.sk === item.sk ? { ...x, rating } : x)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save rating");
    } finally {
      setRatingBusySk(null);
    }
  }

  async function setFavourite(
    item: LibraryMeditationItem,
    favourite: boolean,
  ) {
    if (!item.sk) return;
    setFavouriteBusySk(item.sk);
    try {
      await patchMeditationFavourite(item.sk, favourite);
      setItems((prev) =>
        prev.map((x) => (x.sk === item.sk ? { ...x, favourite } : x)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save favourite");
    } finally {
      setFavouriteBusySk(null);
    }
  }

  async function setArchived(item: LibraryMeditationItem, archived: boolean) {
    if (!item.sk) return;
    setArchiveBusySk(item.sk);
    try {
      await patchMeditationArchived(item.sk, archived);
      setItems((prev) =>
        prev.map((x) => (x.sk === item.sk ? { ...x, archived } : x)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not archive");
    } finally {
      setArchiveBusySk(null);
    }
  }

  function confirmArchive(item: LibraryMeditationItem) {
    Alert.alert(
      "Archive meditation?",
      item.title,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Archive",
          style: "destructive",
          onPress: () => void setArchived(item, true),
        },
      ],
    );
  }

  function openDraft(item: LibraryMeditationItem) {
    if (!item.sk) return;
    navigation.navigate("Create", { draftSk: item.sk });
  }

  async function playItem(m: LibraryMeditationItem) {
    setPlayerPlaying(true);
    setNowPlaying({
      url: m.audioUrl,
      title: m.title,
      s3Key: m.s3Key,
    });
  }

  function renderStars(m: LibraryMeditationItem, compact?: boolean) {
    return (
      <View style={[styles.starsRow, compact && styles.starsRowCompact]}>
        {!compact ? <Text style={styles.starsLabel}>Rate</Text> : null}
        {[1, 2, 3, 4, 5].map((star) => (
          <Pressable
            key={star}
            disabled={!m.sk || ratingBusySk === m.sk}
            onPress={() =>
              void setRating(m, m.rating === star ? null : star)
            }
            style={styles.starBtn}
          >
            <Text
              style={[
                compact ? styles.starSm : styles.star,
                m.rating != null && star <= m.rating
                  ? styles.starOn
                  : styles.starOff,
              ]}
            >
              ★
            </Text>
          </Pressable>
        ))}
      </View>
    );
  }

  const sortLabel =
    sortBy === "newest"
      ? "Newest"
      : sortBy === "oldest"
        ? "Oldest"
        : "Title A-Z";

  const renderPending = (m: PendingLibraryMeditationItem) => (
    <View style={[styles.listRow, styles.pendingRow]}>
      <View style={styles.listMain}>
        <View style={styles.listTitleRow}>
          <Text style={styles.listTitle} numberOfLines={2}>
            {m.title}
          </Text>
          {m.status === "failed" ? (
            <Text style={styles.pendingBadgeFail}>Failed</Text>
          ) : (
            <ActivityIndicator size="small" color={colors.accent} />
          )}
        </View>
        <Text style={styles.descriptionText} numberOfLines={2}>
          {m.error ?? m.description ?? "Synthesizing audio…"}
        </Text>
        <Text style={styles.listWhen}>{formatWhen(m.createdAt)}</Text>
      </View>
    </View>
  );

  const renderListItem = ({ item: row }: { item: LibraryRow }) => {
    if (isPendingRow(row)) return renderPending(row);
    const m = row;
    if (m.isDraft) {
      return (
        <Pressable
          style={styles.listRow}
          onPress={() => openDraft(m)}
        >
          <View style={styles.listMain}>
            <View style={styles.draftBadge}>
              <Text style={styles.draftBadgeText}>Draft</Text>
            </View>
            <Text style={styles.listTitle} numberOfLines={2}>
              {m.title || "Untitled draft"}
            </Text>
            <Text style={styles.listWhen}>
              Tap to resume in Create
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.muted} />
        </Pressable>
      );
    }
    return (
      <View style={styles.listRow}>
        <View style={styles.listMain}>
          <View style={styles.listTitleRow}>
            <View style={styles.titleLenRow}>
              <Text style={styles.listTitle} numberOfLines={2}>
                {m.title}
              </Text>
              <Text style={styles.listLength}>
                {formatDuration(m.durationSeconds)}
              </Text>
            </View>
            <View style={styles.listTitleRight}>
              <Text style={styles.listBadge}>
                {libraryMeditationCategoryLabel(m)}
              </Text>
              <Pressable
                onPress={() => void setFavourite(m, !m.favourite)}
                disabled={!m.sk || favouriteBusySk === m.sk}
                style={[
                  styles.heartBtn,
                  m.favourite && styles.heartBtnOn,
                  (!m.sk || favouriteBusySk === m.sk) &&
                    styles.heartBtnDisabled,
                ]}
              >
                <Ionicons
                  name={m.favourite ? "heart" : "heart-outline"}
                  size={18}
                  color={m.favourite ? "#fff" : colors.muted}
                />
              </Pressable>
            </View>
          </View>
          <Text style={styles.descriptionText} numberOfLines={3}>
            {m.description ?? ""}
          </Text>
          <Text style={styles.listWhen}>
            {formatWhen(m.createdAt)}
            {m.speakerName ? ` · ${m.speakerName}` : ""}
          </Text>
          {renderStars(m)}
          <View style={styles.listActions}>
            <Pressable
              style={styles.listPlayBtn}
              onPress={() => void playItem(m)}
            >
              <Ionicons name="play-circle" size={18} color="#fff" />
              <Text style={styles.listPlayText}>Play</Text>
            </Pressable>
            <Pressable
              style={styles.listScriptBtn}
              onPress={() => void Linking.openURL(m.audioUrl)}
            >
              <Ionicons
                name="open-outline"
                size={16}
                color={colors.foreground}
              />
              <Text style={styles.listScriptText}>Open</Text>
            </Pressable>
            {m.scriptText ? (
              <Pressable
                style={styles.listScriptBtn}
                onPress={() => setScriptItem(m)}
              >
                <Ionicons
                  name="document-text-outline"
                  size={18}
                  color={colors.foreground}
                />
                <Text style={styles.listScriptText}>Script</Text>
              </Pressable>
            ) : null}
            {m.sk ? (
              <Pressable
                style={styles.archiveBtn}
                disabled={archiveBusySk === m.sk}
                onPress={() => confirmArchive(m)}
              >
                <Ionicons name="archive-outline" size={18} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    );
  };

  const renderGridItem = ({ item: row }: { item: LibraryRow }) => {
    if (isPendingRow(row)) {
      return (
        <View style={styles.gridCell}>
          <View style={[styles.card, styles.pendingRow]}>
            <Text style={styles.cardTitle} numberOfLines={3}>
              {row.title}
            </Text>
            <ActivityIndicator color={colors.accent} style={{ marginTop: 8 }} />
          </View>
        </View>
      );
    }
    const m = row;
    if (m.isDraft) {
      return (
        <View style={styles.gridCell}>
          <Pressable style={styles.card} onPress={() => openDraft(m)}>
            <View style={styles.draftBadge}>
              <Text style={styles.draftBadgeText}>Draft</Text>
            </View>
            <Text style={styles.cardTitle} numberOfLines={3}>
              {m.title || "Untitled"}
            </Text>
            <Text style={styles.smallMeta}>Resume in Create</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.gridCell}>
        <View style={styles.card}>
          <View style={styles.gridBadgeRow}>
            <Text style={styles.badge} numberOfLines={1}>
              {libraryMeditationCategoryLabel(m)}
            </Text>
            <Pressable
              onPress={() => void setFavourite(m, !m.favourite)}
              disabled={!m.sk || favouriteBusySk === m.sk}
              style={[
                styles.heartBtn,
                m.favourite && styles.heartBtnOn,
                (!m.sk || favouriteBusySk === m.sk) && styles.heartBtnDisabled,
              ]}
            >
              <Ionicons
                name={m.favourite ? "heart" : "heart-outline"}
                size={18}
                color={m.favourite ? "#fff" : colors.muted}
              />
            </Pressable>
          </View>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle} numberOfLines={3}>
              {m.title}
            </Text>
            <Text style={styles.cardLength}>
              {formatDuration(m.durationSeconds)}
            </Text>
          </View>
          <Text style={styles.descriptionText} numberOfLines={3}>
            {m.description ?? ""}
          </Text>
          <Text style={styles.smallMeta}>
            {formatWhen(m.createdAt)}
            {m.speakerName ? ` · ${m.speakerName}` : ""}
          </Text>
          {renderStars(m, true)}
          <View style={styles.actions}>
            <Pressable
              style={styles.primaryBtn}
              onPress={() => void playItem(m)}
            >
              <Text style={styles.primaryBtnText}>Play</Text>
            </Pressable>
            {m.scriptText ? (
              <Pressable
                style={styles.secondaryBtn}
                onPress={() => setScriptItem(m)}
              >
                <Text style={styles.secondaryBtnText}>Script</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    );
  };

  const keyExtractor = (item: LibraryRow) =>
    isPendingRow(item) ? item.pendingKey : item.s3Key;

  const listEmpty =
    libraryTab === "drafts"
      ? "No drafts yet. Save from Create → Voice & mix."
      : favouritesOnly
        ? "No favourites match."
        : "No meditations yet. Generate one from Create.";

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.top}>
        <Text style={styles.h1}>Library</Text>
        <Text style={styles.sub}>
          Meditations, in-progress jobs, and saved drafts. Play in-app or open
          the MP3 externally.
        </Text>

        <View style={styles.tabRow}>
          {(
            [
              { key: "meditations", label: "Meditations" },
              { key: "drafts", label: "Drafts" },
            ] as const
          ).map((t) => (
            <Pressable
              key={t.key}
              onPress={() => setLibraryTab(t.key)}
              style={[
                styles.tabBtn,
                libraryTab === t.key && styles.tabBtnOn,
              ]}
            >
              <Text
                style={[
                  styles.tabBtnText,
                  libraryTab === t.key && styles.tabBtnTextOn,
                ]}
              >
                {t.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {libraryTab === "meditations" ? (
          <ModalDropdown
            label="Category"
            options={categoryDropdownOptions}
            value={categoryFilter}
            onChange={(v) => setCategoryFilter(v)}
            placeholder="All categories"
          />
        ) : null}

        <View style={styles.viewToggleRow}>
          <View style={styles.favSortLeft}>
            <Pressable
              onPress={() => setFavouritesOnly((v) => !v)}
              style={[
                styles.favFilterBtn,
                favouritesOnly && styles.favFilterBtnOn,
              ]}
            >
              <Ionicons
                name={favouritesOnly ? "heart" : "heart-outline"}
                size={22}
                color={favouritesOnly ? "#fff" : colors.muted}
              />
              <Text
                style={[
                  styles.favFilterText,
                  favouritesOnly && styles.favFilterTextOn,
                ]}
              >
                Favourites
              </Text>
            </Pressable>

            <Pressable
              onPress={() =>
                setSortBy((v) =>
                  v === "newest" ? "oldest" : v === "oldest" ? "title" : "newest",
                )
              }
              style={styles.sortBtn}
            >
              <Text style={styles.sortText}>{sortLabel}</Text>
            </Pressable>
          </View>

          <View style={styles.viewToggle}>
            <Pressable
              onPress={() => setViewMode("list")}
              style={[
                styles.toggleBtn,
                viewMode === "list" && styles.toggleBtnActive,
              ]}
            >
              <Ionicons
                name="list"
                size={22}
                color={viewMode === "list" ? "#fff" : colors.muted}
              />
            </Pressable>
            <Pressable
              onPress={() => setViewMode("grid")}
              style={[
                styles.toggleBtn,
                viewMode === "grid" && styles.toggleBtnActive,
              ]}
            >
              <Ionicons
                name="grid-outline"
                size={22}
                color={viewMode === "grid" ? "#fff" : colors.muted}
              />
            </Pressable>
          </View>
        </View>
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          key={viewMode}
          data={visibleItems}
          keyExtractor={keyExtractor}
          numColumns={viewMode === "grid" ? 2 : 1}
          columnWrapperStyle={viewMode === "grid" ? styles.gridRow : undefined}
          contentContainerStyle={styles.listContent}
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
          ListEmptyComponent={<Text style={styles.empty}>{listEmpty}</Text>}
          renderItem={
            viewMode === "grid" ? renderGridItem : renderListItem
          }
        />
      )}

      {nowPlaying ? (
        <SafeAreaView edges={["bottom"]} style={styles.playerSafe}>
          <View style={styles.playerBar}>
            <View style={{ flex: 1 }}>
              <Text style={styles.playerTitle} numberOfLines={1}>
                {nowPlaying.title}
              </Text>
              <Text style={styles.playerTime}>
                {Math.floor(playerPosition)}s
                {playerDuration > 0
                  ? ` / ${Math.floor(playerDuration)}s`
                  : ""}
              </Text>
            </View>
            <Pressable
              style={styles.playerBtn}
              disabled={playerBusy}
              onPress={() => void togglePause()}
            >
              <Ionicons
                name={playerPlaying ? "pause" : "play"}
                size={22}
                color="#fff"
              />
            </Pressable>
            <Pressable
              style={styles.playerBtnSecondary}
              onPress={() => {
                void soundRef.current?.unloadAsync();
                soundRef.current = null;
                setNowPlaying(null);
              }}
            >
              <Ionicons name="close" size={20} color={colors.foreground} />
            </Pressable>
            <Pressable
              style={styles.playerBtnSecondary}
              onPress={() => void Linking.openURL(nowPlaying.url)}
            >
              <Ionicons name="open-outline" size={20} color={colors.foreground} />
            </Pressable>
          </View>
        </SafeAreaView>
      ) : null}

      <Modal
        visible={scriptItem != null}
        animationType="slide"
        transparent
        onRequestClose={() => setScriptItem(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setScriptItem(null)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} numberOfLines={2}>
                {scriptItem?.title ?? "Script"}
              </Text>
              <Pressable
                onPress={() => setScriptItem(null)}
                style={styles.modalClose}
              >
                <Text style={styles.modalCloseText}>Close</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.modalScroll}>
              <ChatMarkdown
                text={stripPauseMarkers(scriptItem?.scriptText ?? "")}
                textStyle={styles.scriptBody}
              />
              {scriptItem?.scriptTruncated ? (
                <Text style={styles.truncNote}>
                  Script was truncated for storage.
                </Text>
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  top: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
  h1: { fontSize: 26, fontWeight: "700", color: colors.foreground },
  sub: {
    marginTop: 6,
    fontSize: 14,
    color: colors.muted,
    lineHeight: 20,
  },
  tabRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
    marginBottom: 8,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    backgroundColor: colors.card,
  },
  tabBtnOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  tabBtnText: { fontSize: 14, fontWeight: "800", color: colors.muted },
  tabBtnTextOn: { color: colors.foreground },
  viewToggleRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  favSortLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  viewToggle: {
    flexDirection: "row",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 4,
    gap: 4,
  },
  favFilterBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  favFilterBtnOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  favFilterText: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.muted,
  },
  favFilterTextOn: { color: "#fff" },
  sortBtn: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sortText: { fontSize: 14, fontWeight: "800", color: colors.foreground },
  toggleBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  toggleBtnActive: {
    backgroundColor: colors.accent,
  },
  errorBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "rgba(180,60,60,0.1)",
  },
  errorText: { color: "#b03030", fontSize: 13 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { paddingHorizontal: 16, paddingBottom: 120, gap: 0 },
  gridRow: { gap: 12, justifyContent: "space-between" },
  empty: { textAlign: "center", color: colors.muted, marginTop: 32, fontSize: 15 },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pendingRow: { backgroundColor: colors.accentSoft },
  pendingBadgeFail: {
    fontSize: 12,
    fontWeight: "800",
    color: "#b03030",
  },
  listMain: { flex: 1 },
  draftBadge: {
    alignSelf: "flex-start",
    marginBottom: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  draftBadgeText: { fontSize: 11, fontWeight: "900", color: colors.accent },
  listTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  titleLenRow: { flex: 1, flexDirection: "row", gap: 8, alignItems: "flex-start" },
  listTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "800",
    color: colors.foreground,
  },
  listLength: { fontSize: 12, color: colors.muted, fontWeight: "700" },
  listTitleRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  listBadge: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.muted,
    maxWidth: 120,
  },
  heartBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  heartBtnOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  heartBtnDisabled: { opacity: 0.5 },
  descriptionText: {
    marginTop: 6,
    fontSize: 14,
    color: colors.muted,
    lineHeight: 20,
  },
  listWhen: { marginTop: 6, fontSize: 12, color: colors.muted },
  starsRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 },
  starsRowCompact: { marginTop: 6 },
  starsLabel: { fontSize: 12, fontWeight: "800", color: colors.muted, marginRight: 4 },
  starBtn: { paddingHorizontal: 2, paddingVertical: 4 },
  star: { fontSize: 22, lineHeight: 26 },
  starSm: { fontSize: 18, lineHeight: 22 },
  starOn: { color: colors.accent },
  starOff: { color: colors.border },
  listActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
    alignItems: "center",
  },
  listPlayBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.accent,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  listPlayText: { color: "#fff", fontWeight: "900", fontSize: 13 },
  listScriptBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.card,
  },
  listScriptText: { fontWeight: "800", fontSize: 13, color: colors.foreground },
  archiveBtn: {
    padding: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  gridCell: { flex: 1, maxWidth: "48%" },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
    minHeight: 200,
  },
  gridBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  badge: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.muted,
    flex: 1,
  },
  cardTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 8,
  },
  cardTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "900",
    color: colors.foreground,
  },
  cardLength: { fontSize: 11, color: colors.muted, fontWeight: "700" },
  smallMeta: { marginTop: 6, fontSize: 11, color: colors.muted },
  actions: { marginTop: 10, gap: 8 },
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  primaryBtnText: { color: "#fff", fontWeight: "900" },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: colors.background,
  },
  secondaryBtnText: { color: colors.foreground, fontWeight: "900" },
  playerSafe: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
  playerBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  playerTitle: { fontSize: 14, fontWeight: "800", color: colors.foreground },
  playerTime: { fontSize: 12, color: colors.muted, marginTop: 2 },
  playerBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  playerBtnSecondary: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  modalCard: {
    maxHeight: "88%",
    backgroundColor: colors.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 8,
  },
  modalTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "900",
    color: colors.foreground,
  },
  modalClose: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalCloseText: { fontWeight: "800", color: colors.foreground },
  modalScroll: { maxHeight: 480 },
  scriptBody: { fontSize: 15, lineHeight: 22, color: colors.foreground },
  truncNote: { marginTop: 12, fontSize: 12, color: colors.muted },
});
