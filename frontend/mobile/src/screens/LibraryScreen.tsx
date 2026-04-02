import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView as SafeArea } from "react-native-safe-area-context";
import {
  type LibraryMeditationItem,
  listLibraryMeditations,
  patchMeditationFavourite,
  patchMeditationRating,
} from "../lib/medimade-api";
import { colors } from "../theme/colors";
import ChatMarkdown from "../components/ChatMarkdown";

type ViewMode = "list" | "grid";
type SortBy = "newest" | "oldest" | "title";

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

export default function LibraryScreen() {
  const [items, setItems] = useState<LibraryMeditationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scriptItem, setScriptItem] = useState<LibraryMeditationItem | null>(
    null,
  );
  const [ratingBusySk, setRatingBusySk] = useState<string | null>(null);
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [favouriteBusySk, setFavouriteBusySk] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("newest");
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  const sortedItems = useMemo(() => {
    const next = [...items];
    if (sortBy === "title") {
      next.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
    } else if (sortBy === "oldest") {
      next.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
    } else {
      // "newest"
      next.sort(
        (a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
      );
    }
    return next;
  }, [items, sortBy]);

  const visibleItems = useMemo(() => {
    const catalogued = sortedItems.filter((x) => x.catalogued);
    return favouritesOnly
      ? catalogued.filter((x) => x.favourite)
      : catalogued;
  }, [sortedItems, favouritesOnly]);

  const sortLabel =
    sortBy === "newest"
      ? "Newest"
      : sortBy === "oldest"
        ? "Oldest"
        : "Title A-Z";

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

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchList();
    setRefreshing(false);
  }, [fetchList]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const renderListItem = ({ item: m }: { item: LibraryMeditationItem }) => (
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
              {m.meditationStyle || m.meditationType || "—"}
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
              accessibilityRole="button"
              accessibilityLabel={
                m.favourite ? "Remove from favourites" : "Add to favourites"
              }
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
        </Text>
        {renderStars(m)}
        <View style={styles.listActions}>
          <Pressable
            style={styles.listPlayBtn}
            onPress={() => void Linking.openURL(m.audioUrl)}
          >
            <Ionicons name="play-circle" size={18} color="#fff" />
            <Text style={styles.listPlayText}>Play</Text>
          </Pressable>
          {m.scriptText ? (
            <Pressable
              style={styles.listScriptBtn}
              onPress={() => setScriptItem(m)}
            >
              <Ionicons name="document-text-outline" size={18} color={colors.foreground} />
              <Text style={styles.listScriptText}>Script</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );

  const renderGridItem = ({ item: m }: { item: LibraryMeditationItem }) => (
    <View style={styles.gridCell}>
      <View style={styles.card}>
        <View style={styles.gridBadgeRow}>
          <Text style={styles.badge}>
            {m.meditationStyle || m.meditationType || "—"}
          </Text>
          <Pressable
            onPress={() => void setFavourite(m, !m.favourite)}
            disabled={!m.sk || favouriteBusySk === m.sk}
            style={[
              styles.heartBtn,
              m.favourite && styles.heartBtnOn,
              (!m.sk || favouriteBusySk === m.sk) && styles.heartBtnDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel={
              m.favourite ? "Remove from favourites" : "Add to favourites"
            }
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
        </Text>
        {renderStars(m)}
        <View style={styles.actions}>
          <Pressable
            style={styles.primaryBtn}
            onPress={() => void Linking.openURL(m.audioUrl)}
          >
            <Text style={styles.primaryBtnText}>Play audio</Text>
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

  return (
    <SafeArea style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.top}>
        <Text style={styles.h1}>Library</Text>
        <Text style={styles.sub}>
          Bucket audio merged with generation metadata. Tap stars to rate; open
          script for the full text.
        </Text>
        <View style={styles.viewToggleRow} accessibilityRole="toolbar">
          <View style={styles.favSortLeft}>
            <Pressable
              onPress={() => setFavouritesOnly((v) => !v)}
              style={[
                styles.favFilterBtn,
                favouritesOnly && styles.favFilterBtnOn,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: favouritesOnly }}
              accessibilityLabel="Favourites filter"
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
                setSortBy((v) => (v === "newest" ? "oldest" : v === "oldest" ? "title" : "newest"))
              }
              style={styles.sortBtn}
              accessibilityRole="button"
              accessibilityLabel="Sort order"
            >
              <Text style={styles.sortText}>{sortLabel}</Text>
            </Pressable>
          </View>

          <View style={styles.viewToggle} accessibilityRole="toolbar">
            <Pressable
              onPress={() => setViewMode("list")}
              style={[
                styles.toggleBtn,
                viewMode === "list" && styles.toggleBtnActive,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: viewMode === "list" }}
              accessibilityLabel="List view"
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
              accessibilityRole="button"
              accessibilityState={{ selected: viewMode === "grid" }}
              accessibilityLabel="Card grid view"
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
          keyExtractor={(item) => item.s3Key}
          numColumns={viewMode === "grid" ? 2 : 1}
          columnWrapperStyle={
            viewMode === "grid" ? styles.gridRow : undefined
          }
          contentContainerStyle={styles.listContent}
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {favouritesOnly
                ? "No favourite meditations yet."
                : "No meditations yet. Create one and it will show here after generation."}
            </Text>
          }
          renderItem={
            viewMode === "grid" ? renderGridItem : renderListItem
          }
        />
      )}

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
                text={scriptItem?.scriptText ?? ""}
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
    </SafeArea>
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
  viewToggleRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  favSortLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  viewToggle: {
    flexDirection: "row",
    alignSelf: "flex-start",
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
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sortText: { fontSize: 14, fontWeight: "800", color: colors.foreground },
  listTitleRight: { flexDirection: "row", alignItems: "center", gap: 8 },
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
  gridBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
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
    padding: 12,
    borderRadius: 12,
    backgroundColor: "rgba(180, 60, 60, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(180, 60, 60, 0.35)",
  },
  errorText: { fontSize: 13, color: colors.foreground },
  centered: { paddingTop: 40, alignItems: "center" },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  gridRow: {
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
    paddingHorizontal: 0,
  },
  gridCell: { flex: 1, minWidth: 0 },
  empty: { marginTop: 24, fontSize: 14, color: colors.muted },
  listRow: {
    marginBottom: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 14,
  },
  listMain: { gap: 0 },
  listTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  listTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
    color: colors.foreground,
  },
  titleLenRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  listLength: {
    marginTop: 6,
    color: colors.muted,
    fontWeight: "800",
    fontSize: 12,
    width: 58,
    textAlign: "right",
  },
  descriptionText: {
    marginTop: 4,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  typePill: {
    marginTop: 4,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    alignSelf: "flex-start",
  },
  typePillText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
    color: colors.accent,
    textTransform: "uppercase",
  },
  listBadge: {
    fontSize: 10,
    fontWeight: "800",
    color: colors.accent,
    textTransform: "uppercase",
  },
  listMeta: { marginTop: 4, fontSize: 13, color: colors.muted },
  listWhen: { marginTop: 4, fontSize: 12, color: colors.muted },
  listActions: {
    marginTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  listPlayBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  listPlayText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  listScriptBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: colors.background,
  },
  listScriptText: { color: colors.foreground, fontWeight: "700", fontSize: 14 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 14,
    flex: 1,
  },
  badge: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
    color: colors.accent,
    textTransform: "uppercase",
  },
  cardTitle: {
    marginTop: 8,
    fontSize: 16,
    fontWeight: "700",
    color: colors.foreground,
  },
  cardTitleRow: {
    marginTop: 8,
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
  },
  cardLength: {
    color: colors.muted,
    fontWeight: "800",
    fontSize: 12,
    width: 64,
    textAlign: "right",
    marginTop: 6,
  },
  meta: { marginTop: 4, fontSize: 12, color: colors.muted },
  smallMeta: { marginTop: 6, fontSize: 11, color: colors.muted },
  starsRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
  starsRowCompact: { marginTop: 8 },
  starsLabel: { fontSize: 12, color: colors.muted, marginRight: 6 },
  starBtn: { paddingHorizontal: 3, paddingVertical: 2 },
  star: { fontSize: 20, lineHeight: 24 },
  starSm: { fontSize: 16, lineHeight: 20 },
  starOn: { color: colors.gold },
  starOff: { color: colors.border },
  actions: { marginTop: 12, flexDirection: "column", gap: 8 },
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingVertical: 11,
    alignItems: "center",
  },
  primaryBtnText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 11,
    alignItems: "center",
    backgroundColor: colors.background,
  },
  secondaryBtnText: { color: colors.foreground, fontWeight: "700", fontSize: 13 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  modalCard: {
    maxHeight: "85%",
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "800",
    color: colors.foreground,
  },
  modalClose: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  modalCloseText: { fontSize: 12, fontWeight: "800", color: colors.foreground },
  modalScroll: { maxHeight: 480, padding: 16 },
  scriptBody: {
    fontSize: 14,
    lineHeight: 22,
    color: colors.foreground,
  },
  truncNote: { marginTop: 12, fontSize: 12, color: colors.muted },
});
