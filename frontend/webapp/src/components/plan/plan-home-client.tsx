"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconArrowRight, IconChevronDown, IconEye, IconLoader2, IconPencil, IconRefresh, IconSparkles, IconWind } from "@tabler/icons-react";
import {
  createPlanDream,
  dreamExcerpt,
  loadPlanDreamsStore,
  savePlanDreamsStore,
  upsertPlanDream,
  type PlanDream,
} from "@/lib/plan-dreams";
import { PlanResistanceThreadBanner } from "@/components/plan/plan-resistance-thread-banner";
import { IdeateCollapsibleSection } from "@/components/plan/ideate-collapsible-section";
import { loadIdeateStore } from "@/lib/plan-ideate-store";
import { globalResistanceThreads } from "@/lib/plan-resistance-threads";
import {
  loadIdeateVisionBoardStore,
  type VisionBoardItem,
} from "@/lib/ideate-vision-board";
import {
  getVisionMedia,
  visionMediaToObjectUrl,
} from "@/lib/ideate-vision-media";
import {
  addCustomQuestion,
  addPresetQuestion,
  availablePresets,
  loadIdeateReflectionQuestionsStore,
  patchQuestionAnswer,
  saveIdeateReflectionQuestionsStore,
  type IdeateReflectionQuestion,
} from "@/lib/ideate-reflection-questions";
import {
  addIdeateValue,
  loadIdeateValuesStore,
  patchIdeateValue,
  removeIdeateValue,
  saveIdeateValuesStore,
  type IdeateValue,
} from "@/lib/ideate-values";
import {
  addIdeateRegret,
  loadIdeateRegretsStore,
  removeIdeateRegret,
  saveIdeateRegretsStore,
  type IdeateRegret,
} from "@/lib/ideate-regrets";
import {
  addIdeateQuote,
  addIdeateQuotes,
  loadIdeateQuotesStore,
  patchIdeateQuote,
  removeIdeateQuote,
  saveIdeateQuotesStore,
  type IdeateQuote,
} from "@/lib/ideate-quotes";
import { fetchFamousAuthorQuotes } from "@/lib/medimade-api";
import {
  loadIdeateSectionCollapse,
  saveIdeateSectionCollapse,
  type IdeateCollapsibleSectionId,
  type IdeateSectionCollapseState,
} from "@/lib/ideate-section-collapse";
import {
  writePlanCreateHandoff,
  type PlanCreateHandoffV2,
} from "@/lib/plan-create-handoff";
import { useRouter } from "next/navigation";
import {
  VisionBoardMosaic,
  VISION_BOARD_EMPTY_COLORS,
  VISION_BOARD_GRID_SLOT_COUNT,
} from "@/components/plan/vision-board-mosaic";
import { useIdeateCloud } from "@/components/plan/ideate-cloud-provider";
import { resetIdeateLocalToGuestDemos } from "@/lib/ideate-demo-seed";
import { isMedimadeSessionActive } from "@/lib/auth-session";
import { lifeAreaCardBgVars } from "@/lib/ideate-life-area-colors";
import {
  ensureIdeateManifesto,
  manifestoFingerprint,
  loadCachedManifesto,
  saveIdeateManifestoManual,
} from "@/lib/ideate-manifesto";
import {
  loadIdeateHeroBg,
  saveIdeateHeroBg,
  getIdeateHeroBgOption,
  IDEATE_HERO_BG_OPTIONS,
  type IdeateHeroBgId,
} from "@/lib/ideate-hero-bg";

function lifeAreaSnippet(d: PlanDream): string | null {
  const raw = (d.dreamText || d.firstThought || d.visionText || "").trim();
  if (!raw) return null;
  return dreamExcerpt(d) === "—" ? null : dreamExcerpt(d);
}

function mosaicColors(items: VisionBoardItem[]): readonly string[] {
  if (items.length === 0) return VISION_BOARD_EMPTY_COLORS;
  return items.map((i) => i.color);
}

function mosaicImages(
  items: VisionBoardItem[],
  resolved: Record<string, string>,
): string[] {
  const urls: string[] = [];
  for (const item of items) {
    if (urls.length >= VISION_BOARD_GRID_SLOT_COUNT) break;
    const src =
      (typeof item.imageUrl === "string" && item.imageUrl.trim()
        ? item.imageUrl
        : null) ||
      resolved[item.id] ||
      null;
    if (src) urls.push(src);
  }
  return urls;
}

function formatIndex(n: number): string {
  return String(n).padStart(2, "0");
}

function formatCheckInDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

export function PlanHomeClient() {
  const router = useRouter();
  const [dreams, setDreams] = useState<PlanDream[]>([]);
  const [visionItems, setVisionItems] = useState<VisionBoardItem[]>([]);
  const [visionTileUrls, setVisionTileUrls] = useState<Record<string, string>>(
    {},
  );
  const visionBlobUrlsRef = useRef<Record<string, string>>({});
  const [questions, setQuestions] = useState<IdeateReflectionQuestion[]>([]);
  const [values, setValues] = useState<IdeateValue[]>([]);
  const [regrets, setRegrets] = useState<IdeateRegret[]>([]);
  const [quotes, setQuotes] = useState<IdeateQuote[]>([]);
  const [collapsed, setCollapsed] = useState<IdeateSectionCollapseState>({
    values: false,
    questions: false,
    regrets: false,
    quotes: false,
    lifeAreas: false,
  });
  const [manifesto, setManifesto] = useState<string>("");
  const [manifestoLoading, setManifestoLoading] = useState(false);
  const [editingManifesto, setEditingManifesto] = useState(false);
  const [manifestoDraft, setManifestoDraft] = useState("");
  const [manifestoRefreshing, setManifestoRefreshing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDream, setNewDream] = useState("");
  const [newObstacle, setNewObstacle] = useState("");
  const [newVision, setNewVision] = useState("");
  const [addQuestionOpen, setAddQuestionOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState("");
  const [writingCustom, setWritingCustom] = useState(false);
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const [draftAnswer, setDraftAnswer] = useState("");
  const [addingValue, setAddingValue] = useState(false);
  const [valueDraft, setValueDraft] = useState("");
  const [editingValueId, setEditingValueId] = useState<string | null>(null);
  const [editValueDraft, setEditValueDraft] = useState("");
  const [addingRegret, setAddingRegret] = useState(false);
  const [regretDraft, setRegretDraft] = useState("");
  const [regretCategoryDraft, setRegretCategoryDraft] = useState("");
  const [addingQuote, setAddingQuote] = useState(false);
  const [quoteAddMode, setQuoteAddMode] = useState<"choose" | "author" | "original">(
    "choose",
  );
  const [quoteDraft, setQuoteDraft] = useState("");
  const [quoteAttributionDraft, setQuoteAttributionDraft] = useState("");
  const [authorQueryDraft, setAuthorQueryDraft] = useState("");
  const [authorFetchLoading, setAuthorFetchLoading] = useState(false);
  const [authorFetchError, setAuthorFetchError] = useState<string | null>(null);
  const [authorResolvedName, setAuthorResolvedName] = useState<string | null>(
    null,
  );
  const [authorFetchedQuotes, setAuthorFetchedQuotes] = useState<string[]>([]);
  const [authorSelectedQuotes, setAuthorSelectedQuotes] = useState<Set<string>>(
    () => new Set(),
  );
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const [editQuoteDraft, setEditQuoteDraft] = useState("");
  const [editQuoteAttributionDraft, setEditQuoteAttributionDraft] =
    useState("");
  const [scrollHintVisible, setScrollHintVisible] = useState(true);
  const [heroBg, setHeroBg] = useState<IdeateHeroBgId>("black");
  const [heroBgPickerOpen, setHeroBgPickerOpen] = useState(false);
  const addPickerRef = useRef<HTMLDivElement>(null);
  const heroBgPickerRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const manifestoReqRef = useRef(0);

  const refresh = useCallback(() => {
    // Guests only — always force seeded samples (never leftover account rows).
    if (!isMedimadeSessionActive()) {
      resetIdeateLocalToGuestDemos();
    }
    setDreams(loadPlanDreamsStore().dreams);
    setVisionItems(loadIdeateVisionBoardStore().items);
    setQuestions(loadIdeateReflectionQuestionsStore().questions);
    setValues(loadIdeateValuesStore().values);
    setRegrets(loadIdeateRegretsStore().regrets);
    setQuotes(loadIdeateQuotesStore().quotes);
  }, []);

  useEffect(() => {
    setCollapsed(loadIdeateSectionCollapse());
    setHeroBg(loadIdeateHeroBg());
  }, []);

  useEffect(() => {
    if (!heroBgPickerOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (heroBgPickerRef.current?.contains(t)) return;
      setHeroBgPickerOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHeroBgPickerOpen(false);
    };
    const t = window.setTimeout(() => {
      document.addEventListener("mousedown", onDoc);
      document.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [heroBgPickerOpen]);

  const toggleSection = useCallback((id: IdeateCollapsibleSectionId) => {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      saveIdeateSectionCollapse(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;

    let scrollRoot: HTMLElement | Window = window;
    let node: HTMLElement | null = hero.parentElement;
    while (node) {
      const { overflowY } = getComputedStyle(node);
      if (overflowY === "auto" || overflowY === "scroll") {
        scrollRoot = node;
        break;
      }
      node = node.parentElement;
    }

    const onScroll = () => {
      const scrollTop =
        scrollRoot === window
          ? window.scrollY
          : (scrollRoot as HTMLElement).scrollTop;
      if (scrollTop >= hero.offsetHeight) {
        setScrollHintVisible(false);
      }
    };

    scrollRoot.addEventListener("scroll", onScroll, { passive: true });
    return () => scrollRoot.removeEventListener("scroll", onScroll);
  }, []);

  const resolveVisionTiles = useCallback(async (items: VisionBoardItem[]) => {
    const next: Record<string, string> = {};
    for (const item of items) {
      if (typeof item.imageUrl === "string" && item.imageUrl.trim()) {
        next[item.id] = item.imageUrl;
        continue;
      }
      if (!item.mediaId) continue;
      try {
        const rec = await getVisionMedia(item.mediaId);
        if (!rec) continue;
        next[item.id] = visionMediaToObjectUrl(rec);
      } catch {
        /* ignore */
      }
    }
    for (const u of Object.values(visionBlobUrlsRef.current)) {
      if (u.startsWith("blob:")) URL.revokeObjectURL(u);
    }
    visionBlobUrlsRef.current = next;
    setVisionTileUrls(next);
  }, []);

  const { ready: cloudReady, revision, signedIn } = useIdeateCloud();
  const sessionActive = isMedimadeSessionActive();

  // Guests never wait on the cloud provider — missing provider used to brick /ideate/my
  // on eternal "Loading…". Seed + paint from local demos immediately.
  useEffect(() => {
    if (sessionActive) return;
    refresh();
  }, [refresh, sessionActive]);

  useEffect(() => {
    if (!cloudReady) return;
    const id = requestAnimationFrame(() => refresh());
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onFocus);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onFocus);
    };
  }, [refresh, cloudReady, revision, signedIn]);

  useEffect(() => {
    void resolveVisionTiles(visionItems);
  }, [visionItems, resolveVisionTiles]);

  useEffect(() => {
    return () => {
      for (const u of Object.values(visionBlobUrlsRef.current)) {
        if (u.startsWith("blob:")) URL.revokeObjectURL(u);
      }
      visionBlobUrlsRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (!addQuestionOpen) return;
    function onDoc(e: MouseEvent) {
      if (!addPickerRef.current?.contains(e.target as Node)) {
        setAddQuestionOpen(false);
        setWritingCustom(false);
        setCustomDraft("");
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setAddQuestionOpen(false);
        setWritingCustom(false);
        setCustomDraft("");
      }
    }
    // Defer so the opening click doesn't immediately close the picker.
    const t = window.setTimeout(() => {
      document.addEventListener("mousedown", onDoc);
    }, 0);
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [addQuestionOpen]);

  const sortedDreams = useMemo(
    () =>
      [...dreams].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [dreams],
  );

  /** Oldest-first index for cycling the fixed sandy palette. */
  const lifeAreaCreationIndex = useMemo(() => {
    const byAge = [...dreams].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    const map = new Map<string, number>();
    byAge.forEach((d, i) => map.set(d.id, i));
    return map;
  }, [dreams]);

  const unusedPresets = useMemo(
    () => availablePresets({ v: 1, questions }),
    [questions],
  );

  const activeQuestion = useMemo(
    () => questions.find((q) => q.id === activeQuestionId) ?? null,
    [questions, activeQuestionId],
  );

  const valueTexts = useMemo(
    () => values.map((v) => v.text.trim()).filter(Boolean),
    [values],
  );

  const lifeAreaTitles = useMemo(
    () => sortedDreams.map((d) => d.title.trim()).filter(Boolean),
    [sortedDreams],
  );

  useEffect(() => {
    if (valueTexts.length === 0) {
      setManifesto("");
      setManifestoLoading(false);
      setEditingManifesto(false);
      return;
    }
    const fp = manifestoFingerprint(valueTexts, lifeAreaTitles);
    const cached = loadCachedManifesto(fp);
    if (cached) {
      setManifesto(cached);
      setManifestoLoading(false);
      return;
    }
    const req = ++manifestoReqRef.current;
    setManifestoLoading(true);
    void ensureIdeateManifesto({
      values: valueTexts,
      lifeAreaTitles,
    }).then((text) => {
      if (manifestoReqRef.current !== req) return;
      setManifesto(text);
      setManifestoLoading(false);
    });
  }, [valueTexts, lifeAreaTitles]);

  function beginEditManifesto() {
    if (!manifesto || manifestoRefreshing) return;
    setManifestoDraft(manifesto);
    setEditingManifesto(true);
  }

  function cancelEditManifesto() {
    setEditingManifesto(false);
    setManifestoDraft("");
  }

  function saveEditManifesto() {
    if (valueTexts.length === 0) return;
    const text = saveIdeateManifestoManual({
      values: valueTexts,
      lifeAreaTitles,
      text: manifestoDraft,
    });
    if (text) setManifesto(text);
    setEditingManifesto(false);
    setManifestoDraft("");
  }

  function refreshManifesto() {
    if (valueTexts.length === 0 || manifestoRefreshing || editingManifesto) return;
    const req = ++manifestoReqRef.current;
    setManifestoRefreshing(true);
    void ensureIdeateManifesto({
      values: valueTexts,
      lifeAreaTitles,
      force: true,
    })
      .then((text) => {
        if (manifestoReqRef.current !== req) return;
        setManifesto(text);
      })
      .finally(() => {
        if (manifestoReqRef.current !== req) return;
        setManifestoRefreshing(false);
      });
  }

  function addDream(opts?: { skipReflections?: boolean }) {
    const title = newTitle.trim();
    if (!title) return;
    const store = loadPlanDreamsStore();
    const dream = createPlanDream({
      title,
      dreamText: opts?.skipReflections ? "" : newDream,
      obstacleText: opts?.skipReflections ? "" : newObstacle,
      visionText: opts?.skipReflections ? "" : newVision,
    });
    savePlanDreamsStore(upsertPlanDream(store, dream));
    setNewTitle("");
    setNewDream("");
    setNewObstacle("");
    setNewVision("");
    setModalOpen(false);
    refresh();
  }

  function persistQuestions(next: IdeateReflectionQuestion[]) {
    saveIdeateReflectionQuestionsStore({ v: 1, questions: next });
    setQuestions(next);
  }

  function persistValues(next: IdeateValue[]) {
    saveIdeateValuesStore({ v: 1, values: next });
    setValues(next);
  }

  function persistRegrets(next: IdeateRegret[]) {
    saveIdeateRegretsStore({ v: 1, regrets: next });
    setRegrets(next);
  }

  function persistQuotes(next: IdeateQuote[]) {
    saveIdeateQuotesStore({ v: 1, quotes: next });
    setQuotes(next);
  }

  function handleAddValue() {
    const next = addIdeateValue({ v: 1, values }, valueDraft);
    if (next.values.length === values.length) return;
    persistValues(next.values);
    setValueDraft("");
    setAddingValue(false);
  }

  function handleAddRegret() {
    const next = addIdeateRegret(
      { v: 1, regrets },
      { statement: regretDraft, category: regretCategoryDraft },
    );
    if (next.regrets.length === regrets.length) return;
    persistRegrets(next.regrets);
    setRegretDraft("");
    setRegretCategoryDraft("");
    setAddingRegret(false);
  }

  function handleRemoveRegret(id: string) {
    persistRegrets(removeIdeateRegret({ v: 1, regrets }, id).regrets);
  }

  function handleAddQuote() {
    const next = addIdeateQuote(
      { v: 1, quotes },
      { text: quoteDraft, attribution: quoteAttributionDraft },
    );
    if (next.quotes.length === quotes.length) return;
    persistQuotes(next.quotes);
    resetQuoteComposer();
  }

  function resetQuoteComposer() {
    setAddingQuote(false);
    setQuoteAddMode("choose");
    setQuoteDraft("");
    setQuoteAttributionDraft("");
    setAuthorQueryDraft("");
    setAuthorFetchLoading(false);
    setAuthorFetchError(null);
    setAuthorResolvedName(null);
    setAuthorFetchedQuotes([]);
    setAuthorSelectedQuotes(new Set());
  }

  async function handleFetchAuthorQuotes() {
    const q = authorQueryDraft.trim();
    if (q.length < 2 || authorFetchLoading) return;
    setAuthorFetchLoading(true);
    setAuthorFetchError(null);
    setAuthorFetchedQuotes([]);
    setAuthorSelectedQuotes(new Set());
    setAuthorResolvedName(null);
    try {
      const result = await fetchFamousAuthorQuotes(q);
      setAuthorResolvedName(result.author);
      setAuthorFetchedQuotes(result.quotes);
      setAuthorSelectedQuotes(new Set(result.quotes));
    } catch (e) {
      setAuthorFetchError(
        e instanceof Error ? e.message : "Could not find quotes for that person",
      );
    } finally {
      setAuthorFetchLoading(false);
    }
  }

  function toggleAuthorQuote(text: string) {
    setAuthorSelectedQuotes((prev) => {
      const next = new Set(prev);
      if (next.has(text)) next.delete(text);
      else next.add(text);
      return next;
    });
  }

  function handleAddSelectedAuthorQuotes() {
    if (!authorResolvedName || authorSelectedQuotes.size === 0) return;
    const existingTexts = new Set(
      quotes.map((q) => q.text.trim().toLowerCase()),
    );
    const inputs = authorFetchedQuotes
      .filter((t) => authorSelectedQuotes.has(t))
      .filter((t) => !existingTexts.has(t.trim().toLowerCase()))
      .map((text) => ({ text, attribution: authorResolvedName }));
    if (inputs.length === 0) {
      resetQuoteComposer();
      return;
    }
    const next = addIdeateQuotes({ v: 1, quotes }, inputs);
    persistQuotes(next.quotes);
    resetQuoteComposer();
  }

  function handleRemoveQuote(id: string) {
    persistQuotes(removeIdeateQuote({ v: 1, quotes }, id).quotes);
    if (editingQuoteId === id) {
      setEditingQuoteId(null);
      setEditQuoteDraft("");
      setEditQuoteAttributionDraft("");
    }
  }

  function openEditQuote(q: IdeateQuote) {
    setEditingQuoteId(q.id);
    setEditQuoteDraft(q.text);
    setEditQuoteAttributionDraft(q.attribution ?? "");
    setAddingQuote(false);
  }

  function saveEditQuote() {
    if (!editingQuoteId) return;
    const next = patchIdeateQuote(
      { v: 1, quotes },
      editingQuoteId,
      {
        text: editQuoteDraft,
        attribution: editQuoteAttributionDraft.trim()
          ? editQuoteAttributionDraft
          : null,
      },
    );
    persistQuotes(next.quotes);
    setEditingQuoteId(null);
    setEditQuoteDraft("");
    setEditQuoteAttributionDraft("");
  }

  function exploreRegretInIdeate(regret: IdeateRegret) {
    const store = loadPlanDreamsStore();
    const match =
      store.dreams.find(
        (d) =>
          regret.category &&
          d.title.toLowerCase().includes(regret.category.toLowerCase()),
      ) ?? store.dreams[0];
    if (match) {
      router.push(
        `/ideate/goal/${encodeURIComponent(match.id)}?focus=regret&note=${encodeURIComponent(regret.statement.slice(0, 120))}`,
      );
      return;
    }
    setModalOpen(true);
    setNewTitle(regret.category?.trim() || "Regret to minimise");
    setNewDream(regret.statement);
  }

  function openEditValue(v: IdeateValue) {
    setEditingValueId(v.id);
    setEditValueDraft(v.text);
    setAddingValue(false);
    setValueDraft("");
  }

  function saveEditValue() {
    if (!editingValueId) return;
    const next = patchIdeateValue(
      { v: 1, values },
      editingValueId,
      editValueDraft,
    );
    persistValues(next.values);
    setEditingValueId(null);
    setEditValueDraft("");
  }

  function handleRemoveValue(id: string) {
    const next = removeIdeateValue({ v: 1, values }, id);
    persistValues(next.values);
    if (editingValueId === id) {
      setEditingValueId(null);
      setEditValueDraft("");
    }
  }

  function handleAddPreset(presetId: string, openAfter = false) {
    const next = addPresetQuestion({ v: 1, questions }, presetId);
    persistQuestions(next.questions);
    setAddQuestionOpen(false);
    setWritingCustom(false);
    setCustomDraft("");
    if (openAfter) {
      const added = next.questions.find((q) => q.presetId === presetId);
      if (added) openQuestion(added);
    }
  }

  function handleAddCustom() {
    const next = addCustomQuestion({ v: 1, questions }, customDraft);
    if (next.questions.length === questions.length) return;
    persistQuestions(next.questions);
    setCustomDraft("");
    setWritingCustom(false);
    setAddQuestionOpen(false);
  }

  function openQuestion(q: IdeateReflectionQuestion) {
    setActiveQuestionId(q.id);
    setDraftAnswer(q.answer);
  }

  function saveActiveAnswer() {
    if (!activeQuestionId) return;
    const next = patchQuestionAnswer(
      { v: 1, questions },
      activeQuestionId,
      draftAnswer,
    );
    persistQuestions(next.questions);
    setActiveQuestionId(null);
    setDraftAnswer("");
  }

  const resistanceThreads = globalResistanceThreads(loadIdeateStore());
  const questionCells =
    questions.length > 0
      ? questions
      : unusedPresets.slice(0, 4).map((p) => ({
          id: `preset-preview-${p.id}`,
          text: p.text,
          description: p.description,
          answer: "",
          presetId: p.id,
          isPreview: true as const,
        }));

  if (sessionActive && !cloudReady) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] pb-16">
        <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
          <p className="text-sm text-muted">Loading…</p>
        </section>
      </div>
    );
  }

  const valuesSummary =
    values.length === 0
      ? "No values yet"
      : values
          .map((v) => v.text.trim())
          .filter(Boolean)
          .slice(0, 3)
          .join(" · ");
  const questionsSummary =
    questions.length === 0
      ? "No questions yet"
      : questions[0]!.text.trim() || "Untitled question";
  const regretsSummary =
    regrets.length === 0
      ? "No entries yet"
      : regrets[0]!.statement.trim() || "Untitled";
  const quotesSummary =
    quotes.length === 0
      ? "No quotes yet"
      : quotes[0]!.text.trim() || "Untitled";

  const heroBgOption = getIdeateHeroBgOption(heroBg);

  return (
    <div className="min-h-[calc(100vh-3.5rem)] pb-20">
      {/* Vision board hero — editable mandala band */}
      <section
        ref={heroRef}
        className={`home-hero group/hero relative w-full ${heroBgOption.className}`}
        aria-label="Vision board"
      >
        <div
          ref={heroBgPickerRef}
          className="home-hero-chrome absolute right-3 top-3 z-[5] sm:right-5 sm:top-4"
        >
          <button
            type="button"
            onClick={() => setHeroBgPickerOpen((o) => !o)}
            aria-label="Change hero background"
            aria-expanded={heroBgPickerOpen}
            title="Background"
            className={`inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-white/50 bg-black/60 text-white shadow-[0_2px_10px_rgb(0_0_0_/_0.35)] backdrop-blur-sm transition-[opacity,colors] hover:border-white hover:bg-black/80 hover:text-white ${
              heroBgPickerOpen
                ? "opacity-100"
                : "opacity-0 group-hover/hero:opacity-100 group-focus-within/hero:opacity-100 max-md:opacity-70"
            }`}
          >
            <IconPencil size={15} stroke={1.75} aria-hidden />
          </button>
          {heroBgPickerOpen ? (
            <div
              role="listbox"
              aria-label="Hero background"
              className="absolute right-0 top-full z-20 mt-2 grid w-[14.5rem] grid-cols-3 gap-3 rounded-xl border border-white/20 bg-black/80 p-3 shadow-lg backdrop-blur-md"
            >
              {IDEATE_HERO_BG_OPTIONS.map((opt) => {
                const selected = opt.id === heroBg;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    aria-label={opt.label}
                    title={opt.label}
                    onClick={() => {
                      setHeroBg(opt.id);
                      saveIdeateHeroBg(opt.id);
                      setHeroBgPickerOpen(false);
                    }}
                    className={`mx-auto h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-full border bg-cover bg-center transition-[box-shadow] ${
                      selected
                        ? "border-transparent ring-2 ring-white ring-offset-2 ring-offset-black"
                        : "border-white/30 hover:border-white/70"
                    }`}
                    style={{
                      backgroundColor: opt.swatch,
                      backgroundImage: opt.swatchImage
                        ? `url(${opt.swatchImage})`
                        : undefined,
                    }}
                  />
                );
              })}
            </div>
          ) : null}
        </div>
        <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6 sm:py-5">
          <div className="relative w-full">
            <div
              className="w-full"
              style={{
                filter:
                  "grayscale(32%) sepia(22%) contrast(0.88) brightness(0.82) saturate(0.7)",
              }}
            >
              <VisionBoardMosaic
                layout="grid"
                colors={mosaicColors(visionItems)}
                images={mosaicImages(visionItems, visionTileUrls)}
                sizeClassName="w-full"
                gapClassName="gap-2.5 sm:gap-3"
                radiusClassName="rounded-none"
                cellRadiusClassName="rounded-md shadow-[0_10px_28px_rgb(30_37_48_/_0.32),0_2px_8px_rgb(30_37_48_/_0.18)]"
              />
            </div>

            <div className="absolute left-1/2 top-1/2 z-[2] w-[min(100%,34rem)] -translate-x-1/2 -translate-y-1/2 px-6 text-center sm:w-[min(100%,38rem)]">
              <div
                className="pointer-events-none absolute -inset-x-4 -inset-y-5 -z-10 overflow-hidden rounded-2xl sm:-inset-x-5 sm:-inset-y-6"
                style={{
                  background:
                    "radial-gradient(ellipse 85% 80% at center, rgba(0,0,0,0.74) 0%, rgba(0,0,0,0.52) 45%, rgba(0,0,0,0.24) 72%, transparent 100%)",
                  backdropFilter: "blur(8px)",
                  WebkitBackdropFilter: "blur(8px)",
                  maskImage:
                    "radial-gradient(ellipse 85% 80% at center, #000 0%, #000 45%, rgba(0,0,0,0.65) 72%, transparent 100%)",
                  WebkitMaskImage:
                    "radial-gradient(ellipse 85% 80% at center, #000 0%, #000 45%, rgba(0,0,0,0.65) 72%, transparent 100%)",
                }}
                aria-hidden
              />
              {valueTexts.length === 0 ? (
                <p className="font-display text-[23px] font-normal italic leading-[1.45] text-white/80">
                  Add a few values below — we&apos;ll distil what you stand for
                  into one sentence.
                </p>
              ) : manifestoLoading && !manifesto ? (
                <p className="font-display text-[23px] font-normal italic leading-[1.45] text-white/80">
                  Distilling…
                </p>
              ) : editingManifesto ? (
                <form
                  className="flex flex-col items-center gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveEditManifesto();
                  }}
                >
                  <label className="sr-only" htmlFor="ideate-manifesto-edit">
                    Edit manifesto
                  </label>
                  <textarea
                    id="ideate-manifesto-edit"
                    autoFocus
                    rows={3}
                    value={manifestoDraft}
                    onChange={(e) => setManifestoDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        cancelEditManifesto();
                      }
                    }}
                    className="w-full resize-none rounded-xl border border-white/35 bg-black/35 px-3 py-2.5 text-center font-display text-[23px] font-normal italic leading-[1.45] text-white outline-none ring-white/25 focus:ring-2"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={cancelEditManifesto}
                      className="cursor-pointer rounded-full px-3 py-1.5 text-xs font-medium text-white/70 hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={!manifestoDraft.trim()}
                      className="cursor-pointer rounded-full border border-white bg-black px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                    >
                      Save
                    </button>
                  </div>
                </form>
              ) : (
                <div className="group/manifesto relative">
                  <p
                    className={`font-display text-[23px] font-normal italic leading-[1.45] text-white transition-opacity ${
                      manifestoRefreshing ? "opacity-60" : ""
                    }`}
                  >
                    &ldquo;{manifesto}&rdquo;
                  </p>
                  <div className="pointer-events-none absolute -right-1 -top-1 flex items-center gap-1 opacity-0 transition-opacity group-hover/manifesto:pointer-events-auto group-hover/manifesto:opacity-100 group-focus-within/manifesto:pointer-events-auto group-focus-within/manifesto:opacity-100 sm:-right-2 sm:-top-2">
                    <button
                      type="button"
                      onClick={beginEditManifesto}
                      aria-label="Edit manifesto"
                      title="Edit"
                      className="pointer-events-auto inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-white/40 bg-black/55 text-white/90 backdrop-blur-sm transition-colors hover:border-white hover:bg-black/75 hover:text-white"
                    >
                      <IconPencil size={14} stroke={1.75} aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={refreshManifesto}
                      disabled={manifestoRefreshing}
                      aria-label="Regenerate manifesto"
                      title="Regenerate"
                      className="pointer-events-auto inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-white/40 bg-black/55 text-white/90 backdrop-blur-sm transition-colors hover:border-white hover:bg-black/75 hover:text-white disabled:cursor-wait disabled:opacity-70"
                    >
                      {manifestoRefreshing ? (
                        <IconLoader2
                          size={14}
                          stroke={1.75}
                          className="animate-spin"
                          aria-hidden
                        />
                      ) : (
                        <IconRefresh size={14} stroke={1.75} aria-hidden />
                      )}
                    </button>
                  </div>
                </div>
              )}

              <Link
                href="/ideate/my/vision-board"
                className="mt-6 inline-flex items-center justify-center rounded-full border border-white bg-black px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              >
                Open vision board →
              </Link>
            </div>

            <div
              className="absolute bottom-3 left-1/2 z-[1] -translate-x-1/2 transition-opacity duration-300"
              style={{ opacity: scrollHintVisible ? 1 : 0 }}
              aria-hidden={!scrollHintVisible}
            >
              <IconChevronDown
                size={18}
                stroke={1.75}
                className="ideate-scroll-hint text-white/70"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 sm:px-6">
        {resistanceThreads[0] ? (
          <div className="pt-10">
            <PlanResistanceThreadBanner theme={resistanceThreads[0]} />
          </div>
        ) : null}

        {/* —— Life areas —— */}
        <section className="pt-8 sm:pt-10" aria-labelledby="ideate-life-areas-heading">
          <h2
            id="ideate-life-areas-heading"
            className="mb-1.5 font-sans text-[15px] font-medium uppercase tracking-[0.08em] text-[#1E2530] dark:text-foreground"
          >
            Your life areas
          </h2>
          <p className="mb-5 max-w-xl font-sans text-sm text-muted sm:mb-6">
            Add the areas of your life you want to grow.
          </p>
          <ul className="grid grid-cols-2 gap-[10px] sm:grid-cols-4">
            {sortedDreams.map((d) => {
              const snippet = lifeAreaSnippet(d);
              const bgVars = lifeAreaCardBgVars(
                lifeAreaCreationIndex.get(d.id) ?? 0,
              );
              const lastInteracted = formatCheckInDate(
                d.updatedAt || d.createdAt,
              );
              return (
                <li key={d.id} className="min-w-0">
                  <Link
                    href={`/ideate/goal/${encodeURIComponent(d.id)}`}
                    className="life-area-card group relative flex aspect-square cursor-pointer flex-col rounded-[4px] p-[22px] shadow-[0_4px_14px_rgba(0,0,0,0.06)] transition-[transform,box-shadow] duration-150 hover:-translate-y-[3px] hover:shadow-[0_10px_28px_rgba(0,0,0,0.09)] dark:shadow-none dark:hover:shadow-none"
                    style={bgVars}
                  >
                    <h3 className="shrink-0 pr-2 font-display text-xl font-medium leading-snug tracking-tight text-[#1E2530] dark:text-[#F4F0E8] sm:text-[1.375rem]">
                      {d.title.trim() || "Untitled"}
                    </h3>
                    <p
                      className={`mt-2 line-clamp-3 min-h-0 flex-1 font-sans text-sm leading-relaxed text-[rgba(60,35,15,0.6)] dark:text-[#A8B0BC] ${
                        snippet ? "" : "italic"
                      }`}
                    >
                      {snippet ?? "Nothing written yet"}
                    </p>
                    <p className="mt-auto shrink-0 pt-3 pr-11 font-sans text-[11px] leading-snug text-[rgba(60,35,15,0.4)] dark:text-[#A8B0BC]/70">
                      Last interacted on {lastInteracted}
                    </p>
                    <span
                      aria-hidden
                      className="pointer-events-none absolute bottom-[16px] right-[16px] inline-flex h-9 w-9 translate-x-1 items-center justify-center rounded-full border border-[#1E2530] bg-transparent text-[#1E2530] opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100 max-md:hidden dark:border-[#F4F0E8] dark:text-[#F4F0E8]"
                    >
                      <IconArrowRight size={16} stroke={2} />
                    </span>
                  </Link>
                </li>
              );
            })}

            <li className="min-w-0">
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                aria-label="Add a life area"
                className="flex aspect-square w-full cursor-pointer flex-col items-center justify-center rounded-[4px] border-2 border-dashed bg-transparent transition-colors"
                style={{
                  borderColor: "rgba(180,140,80,0.35)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "rgba(180,140,80,0.6)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "rgba(180,140,80,0.35)";
                }}
              >
                <span
                  className="font-sans font-light leading-none"
                  style={{ color: "rgba(180,140,80,0.45)", fontSize: "36px" }}
                  aria-hidden
                >
                  +
                </span>
              </button>
            </li>
          </ul>
        </section>

        {/* —— Meaningful quotes —— */}
        <IdeateCollapsibleSection
          eyebrow="Meaningful quotes"
          summary={quotesSummary}
          collapsed={collapsed.quotes}
          onToggle={() => toggleSection("quotes")}
        >
          <p className="mb-5 max-w-2xl font-sans text-[13px] font-normal italic leading-relaxed text-muted">
            Lines that keep you oriented — from thinkers you admire, or your
            own.
          </p>

          {quotes.length === 0 && !addingQuote ? (
            <p className="font-sans text-sm italic text-faint">
              No quotes yet — add one when something sticks.
            </p>
          ) : (
            <ul>
              {quotes.map((q, i) => (
                <li
                  key={q.id}
                  className={`group relative border-b-[0.5px] border-border py-5 ${
                    i === 0 ? "border-t-0" : ""
                  }`}
                >
                  {editingQuoteId === q.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        saveEditQuote();
                      }}
                      className="flex flex-col gap-2"
                    >
                      <label
                        className="sr-only"
                        htmlFor={`ideate-quote-edit-${q.id}`}
                      >
                        Edit quote
                      </label>
                      <textarea
                        id={`ideate-quote-edit-${q.id}`}
                        autoFocus
                        value={editQuoteDraft}
                        onChange={(e) => setEditQuoteDraft(e.target.value)}
                        rows={3}
                        maxLength={400}
                        className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 font-display text-xl outline-none ring-accent/30 focus:ring-2"
                      />
                      <label
                        className="sr-only"
                        htmlFor={`ideate-quote-attr-edit-${q.id}`}
                      >
                        Attribution
                      </label>
                      <input
                        id={`ideate-quote-attr-edit-${q.id}`}
                        value={editQuoteAttributionDraft}
                        onChange={(e) =>
                          setEditQuoteAttributionDraft(e.target.value)
                        }
                        placeholder="Attribution (optional)"
                        maxLength={80}
                        className="w-full max-w-sm rounded-lg border border-border bg-background px-3 py-2 font-sans text-sm outline-none ring-accent/30 focus:ring-2"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingQuoteId(null);
                            setEditQuoteDraft("");
                            setEditQuoteAttributionDraft("");
                          }}
                          className="rounded-full px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={!editQuoteDraft.trim()}
                          className="rounded-full accent-fill-gradient px-3 py-1.5 text-xs font-medium text-on-accent disabled:opacity-40"
                        >
                          Save
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => openEditQuote(q)}
                        className="w-full cursor-pointer text-left"
                      >
                        <p className="font-display text-[22px] font-normal italic leading-[1.4] text-foreground transition-opacity hover:opacity-80">
                          &ldquo;{q.text}&rdquo;
                        </p>
                        {q.attribution?.trim() ? (
                          <p className="mt-2 font-sans text-[13px] font-normal text-muted">
                            — {q.attribution.trim()}
                          </p>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveQuote(q.id)}
                        className="absolute right-0 top-5 cursor-pointer font-sans text-xs text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
                        aria-label="Remove quote"
                      >
                        Remove
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          {addingQuote ? (
            <div className="mt-4 flex flex-col gap-3">
              {quoteAddMode === "choose" ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <button
                    type="button"
                    onClick={() => setQuoteAddMode("author")}
                    className="cursor-pointer rounded-full border border-border px-4 py-2 font-sans text-sm font-medium text-foreground transition-colors hover:border-[#F0A855]/60 hover:bg-accent-soft/30"
                  >
                    From a thinker
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuoteAddMode("original")}
                    className="cursor-pointer rounded-full border border-border px-4 py-2 font-sans text-sm font-medium text-foreground transition-colors hover:border-[#F0A855]/60 hover:bg-accent-soft/30"
                  >
                    Write your own
                  </button>
                  <button
                    type="button"
                    onClick={resetQuoteComposer}
                    className="cursor-pointer rounded-full px-3 py-2 font-sans text-xs font-medium text-muted hover:text-foreground sm:ml-1"
                  >
                    Cancel
                  </button>
                </div>
              ) : null}

              {quoteAddMode === "author" ? (
                <div className="flex flex-col gap-3">
                  <p className="max-w-xl font-sans text-[13px] text-muted">
                    Type a famous person — we&apos;ll find ten well-known lines
                    and remember them for next time.
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleFetchAuthorQuotes();
                    }}
                    className="flex flex-col gap-2 sm:flex-row sm:items-center"
                  >
                    <label className="sr-only" htmlFor="ideate-quote-author">
                      Famous person
                    </label>
                    <input
                      id="ideate-quote-author"
                      autoFocus
                      value={authorQueryDraft}
                      onChange={(e) => setAuthorQueryDraft(e.target.value)}
                      placeholder="e.g. Alan Watts, Maya Angelou…"
                      maxLength={80}
                      disabled={authorFetchLoading}
                      className="w-full max-w-md rounded-lg border border-border bg-background px-3 py-2 font-sans text-sm outline-none ring-accent/30 focus:ring-2 disabled:opacity-60"
                    />
                    <button
                      type="submit"
                      disabled={
                        authorQueryDraft.trim().length < 2 || authorFetchLoading
                      }
                      className="inline-flex items-center justify-center gap-2 rounded-full accent-fill-gradient px-4 py-2 text-xs font-medium text-on-accent disabled:opacity-40"
                    >
                      {authorFetchLoading ? (
                        <>
                          <IconLoader2
                            size={14}
                            stroke={1.75}
                            className="animate-spin"
                            aria-hidden
                          />
                          Finding…
                        </>
                      ) : (
                        "Find quotes"
                      )}
                    </button>
                  </form>
                  {authorFetchError ? (
                    <p className="font-sans text-sm text-red-700/80 dark:text-red-300/90">
                      {authorFetchError}
                    </p>
                  ) : null}
                  {authorResolvedName && authorFetchedQuotes.length > 0 ? (
                    <div className="flex flex-col gap-3">
                      <p className="font-sans text-[13px] text-muted">
                        Quotes by{" "}
                        <span className="font-medium text-foreground">
                          {authorResolvedName}
                        </span>
                        . Pick the ones to keep.
                      </p>
                      <ul className="flex flex-col gap-2">
                        {authorFetchedQuotes.map((text) => {
                          const selected = authorSelectedQuotes.has(text);
                          return (
                            <li key={text}>
                              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/80 px-3 py-2.5 transition-colors hover:border-[#F0A855]/45">
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  onChange={() => toggleAuthorQuote(text)}
                                  className="mt-1.5 shrink-0"
                                />
                                <span className="min-w-0 font-display text-[17px] font-normal italic leading-[1.4] text-foreground">
                                  &ldquo;{text}&rdquo;
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setQuoteAddMode("choose");
                            setAuthorFetchedQuotes([]);
                            setAuthorSelectedQuotes(new Set());
                            setAuthorResolvedName(null);
                            setAuthorFetchError(null);
                          }}
                          className="rounded-full px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground"
                        >
                          Back
                        </button>
                        <button
                          type="button"
                          onClick={handleAddSelectedAuthorQuotes}
                          disabled={authorSelectedQuotes.size === 0}
                          className="rounded-full accent-fill-gradient px-3 py-1.5 text-xs font-medium text-on-accent disabled:opacity-40"
                        >
                          Add selected ({authorSelectedQuotes.size})
                        </button>
                      </div>
                    </div>
                  ) : !authorFetchLoading ? (
                    <button
                      type="button"
                      onClick={() => setQuoteAddMode("choose")}
                      className="self-start rounded-full px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground"
                    >
                      Back
                    </button>
                  ) : null}
                </div>
              ) : null}

              {quoteAddMode === "original" ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleAddQuote();
                  }}
                  className="flex flex-col gap-2"
                >
                  <label className="sr-only" htmlFor="ideate-quote-new">
                    Quote
                  </label>
                  <textarea
                    id="ideate-quote-new"
                    autoFocus
                    value={quoteDraft}
                    onChange={(e) => setQuoteDraft(e.target.value)}
                    placeholder="A line that keeps you oriented…"
                    rows={3}
                    maxLength={400}
                    className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 font-display text-xl outline-none ring-accent/30 focus:ring-2"
                  />
                  <label className="sr-only" htmlFor="ideate-quote-attr">
                    Attribution
                  </label>
                  <input
                    id="ideate-quote-attr"
                    value={quoteAttributionDraft}
                    onChange={(e) => setQuoteAttributionDraft(e.target.value)}
                    placeholder="Attribution (optional)"
                    maxLength={80}
                    className="w-full max-w-sm rounded-lg border border-border bg-background px-3 py-2 font-sans text-sm outline-none ring-accent/30 focus:ring-2"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setQuoteAddMode("choose")}
                      className="rounded-full px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={!quoteDraft.trim()}
                      className="rounded-full accent-fill-gradient px-3 py-1.5 text-xs font-medium text-on-accent disabled:opacity-40"
                    >
                      Add
                    </button>
                  </div>
                </form>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setAddingQuote(true);
                setQuoteAddMode("choose");
                setEditingQuoteId(null);
              }}
              className="mt-5 cursor-pointer font-sans text-sm font-medium text-accent-link transition-opacity hover:opacity-80"
            >
              + Add a quote
            </button>
          )}
        </IdeateCollapsibleSection>

        {/* —— Values —— */}
        <IdeateCollapsibleSection
          eyebrow="Values"
          summary={valuesSummary}
          collapsed={collapsed.values}
          onToggle={() => toggleSection("values")}
        >
          {values.length === 0 && !addingValue ? (
            <p className="font-sans text-sm italic text-faint">
              No values yet — add one when you&apos;re ready.
            </p>
          ) : (
            <ul>
              {values.map((v, i) => (
                <li
                  key={v.id}
                  className={`group border-b-[0.5px] border-border py-4 ${
                    i === 0 ? "border-t-0" : ""
                  }`}
                >
                  {editingValueId === v.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        saveEditValue();
                      }}
                      className="flex flex-col gap-2"
                    >
                      <label
                        className="sr-only"
                        htmlFor={`ideate-value-edit-${v.id}`}
                      >
                        Edit value
                      </label>
                      <input
                        id={`ideate-value-edit-${v.id}`}
                        autoFocus
                        value={editValueDraft}
                        onChange={(e) => setEditValueDraft(e.target.value)}
                        maxLength={120}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 font-display text-2xl outline-none ring-accent/30 focus:ring-2"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingValueId(null);
                            setEditValueDraft("");
                          }}
                          className="rounded-full px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={!editValueDraft.trim()}
                          className="rounded-full accent-fill-gradient px-3 py-1.5 text-xs font-medium text-on-accent disabled:opacity-40"
                        >
                          Save
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex items-start gap-4">
                      <span className="mt-1.5 min-w-6 shrink-0 font-sans text-xs text-muted">
                        {formatIndex(i + 1)}
                      </span>
                      <button
                        type="button"
                        onClick={() => openEditValue(v)}
                        className="min-w-0 flex-1 cursor-pointer text-left font-display text-[26px] font-normal leading-[1.2] text-foreground transition-opacity hover:opacity-80"
                      >
                        {v.text}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveValue(v.id)}
                        className="mt-1.5 shrink-0 cursor-pointer font-sans text-xs text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
                        aria-label={`Remove ${v.text}`}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {addingValue ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleAddValue();
              }}
              className="mt-4 flex flex-col gap-2"
            >
              <label className="sr-only" htmlFor="ideate-value-new">
                New value
              </label>
              <input
                id="ideate-value-new"
                autoFocus
                value={valueDraft}
                onChange={(e) => setValueDraft(e.target.value)}
                placeholder="e.g. Honesty, Presence, Craft"
                maxLength={120}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 font-display text-xl outline-none ring-accent/30 focus:ring-2"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAddingValue(false);
                    setValueDraft("");
                  }}
                  className="rounded-full px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!valueDraft.trim()}
                  className="rounded-full accent-fill-gradient px-3 py-1.5 text-xs font-medium text-on-accent disabled:opacity-40"
                >
                  Add
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                setAddingValue(true);
                setEditingValueId(null);
                setEditValueDraft("");
              }}
              className="mt-5 cursor-pointer font-sans text-sm font-medium text-accent-link transition-opacity hover:opacity-80"
            >
              + Add a value
            </button>
          )}
        </IdeateCollapsibleSection>

        {/* —— Questions —— */}
        <IdeateCollapsibleSection
          eyebrow="Questions to yourself"
          summary={questionsSummary}
          collapsed={collapsed.questions}
          onToggle={() => toggleSection("questions")}
        >
          <ul>
            {questionCells.map((q, i) => {
              const isPreview = "isPreview" in q && q.isPreview;
              const answer = !isPreview ? q.answer.trim() : "";
              const openOrAdd = () => {
                if (isPreview && "presetId" in q && q.presetId) {
                  handleAddPreset(q.presetId, true);
                  return;
                }
                openQuestion(q as IdeateReflectionQuestion);
              };
              return (
                <li
                  key={q.id}
                  className={`group border-l-2 border-[#F0A855] pl-5 ${
                    i === questionCells.length - 1 ? "mb-0" : "mb-5"
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <button
                      type="button"
                      onClick={openOrAdd}
                      className="min-w-0 flex-1 cursor-pointer text-left"
                    >
                      <span className="block font-display text-[19px] font-normal leading-[1.4] text-foreground">
                        {q.text}
                      </span>
                      {answer ? (
                        <span className="mt-2 block whitespace-pre-wrap font-sans text-base font-normal leading-[1.6] text-muted">
                          {answer}
                        </span>
                      ) : (
                        <span className="mt-2 block font-sans text-base font-medium text-accent-link">
                          Add your answer →
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={openOrAdd}
                      className="mt-0.5 shrink-0 cursor-pointer font-sans text-xs text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
                    >
                      Edit
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="relative mt-5" ref={addPickerRef}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setAddQuestionOpen((o) => !o);
                setWritingCustom(false);
                setCustomDraft("");
              }}
              className="cursor-pointer font-sans text-sm font-medium text-accent-link transition-opacity hover:opacity-80"
            >
              {questions.length === 0 ? "+ Add another" : "+ Add a question"}
            </button>

            {addQuestionOpen ? (
              <div
                role="dialog"
                aria-label="Add a reflection question"
                className="absolute left-0 z-30 mt-2 w-[min(100%,22rem)] overflow-hidden rounded-xl border border-border bg-card shadow-lg"
              >
                <ul className="max-h-56 overflow-y-auto py-1">
                  {unusedPresets.length === 0 ? (
                    <li className="px-3 py-2.5 text-sm text-muted">
                      All suggested questions are already added.
                    </li>
                  ) : (
                    unusedPresets.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => handleAddPreset(p.id)}
                          className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-accent-soft/25"
                        >
                          <span className="min-w-0 flex-1 leading-snug">
                            {p.text}
                          </span>
                          <span
                            className="shrink-0 text-base font-medium text-accent-link"
                            aria-hidden
                          >
                            +
                          </span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
                <div className="border-t border-border bg-accent-soft/15 px-3 py-2.5">
                  {writingCustom ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleAddCustom();
                      }}
                      className="flex flex-col gap-2"
                    >
                      <label className="sr-only" htmlFor="ideate-custom-q">
                        Write your own question
                      </label>
                      <input
                        id="ideate-custom-q"
                        autoFocus
                        value={customDraft}
                        onChange={(e) => setCustomDraft(e.target.value)}
                        placeholder="Your question…"
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none ring-accent/30 focus:ring-2"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setWritingCustom(false);
                            setCustomDraft("");
                          }}
                          className="rounded-full px-3 py-1 text-xs font-medium text-muted hover:text-foreground"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={!customDraft.trim()}
                          className="rounded-full accent-fill-gradient px-3 py-1 text-xs font-medium text-on-accent disabled:opacity-40"
                        >
                          Add
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setWritingCustom(true)}
                      className="flex w-full cursor-pointer items-center gap-2 text-left text-sm text-foreground transition-opacity hover:opacity-80"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="shrink-0 text-accent-link"
                        aria-hidden
                      >
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                      Write your own question…
                    </button>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </IdeateCollapsibleSection>

        {/* —— Regrets —— */}
        <IdeateCollapsibleSection
          eyebrow="Regret minimisation"
          summary={regretsSummary}
          collapsed={collapsed.regrets}
          onToggle={() => toggleSection("regrets")}
        >
          <p className="mb-5 max-w-2xl font-sans text-[13px] font-normal italic leading-relaxed text-muted">
            Imagine yourself at 80, looking back. What would you regret not
            having tried?
          </p>

          {regrets.length === 0 && !addingRegret ? (
            <p className="font-sans text-sm italic text-faint">
              No regrets captured yet — add one when you&apos;re ready.
            </p>
          ) : (
            <ul>
              {regrets.map((r, i) => (
                <li
                  key={r.id}
                  className={`group relative border-b-[0.5px] border-border py-4 ${
                    i === 0 ? "border-t-0" : ""
                  }`}
                >
                  <p className="mb-1.5 font-sans text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
                    {r.category?.trim() || "—"}
                  </p>
                  <p className="font-display text-[20px] font-normal leading-[1.35] text-foreground">
                    {r.statement}
                  </p>
                  <button
                    type="button"
                    onClick={() => exploreRegretInIdeate(r)}
                    className="mt-2 cursor-pointer font-sans text-[13px] font-medium text-accent-link opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    Explore in Ideate →
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveRegret(r.id)}
                    className="absolute right-0 top-4 cursor-pointer font-sans text-xs text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
                    aria-label="Remove regret"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          {addingRegret ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleAddRegret();
              }}
              className="mt-4 flex flex-col gap-2"
            >
              <label className="sr-only" htmlFor="ideate-regret-cat">
                Category
              </label>
              <input
                id="ideate-regret-cat"
                value={regretCategoryDraft}
                onChange={(e) => setRegretCategoryDraft(e.target.value)}
                placeholder="Category (optional) — Work, Creative…"
                maxLength={40}
                className="w-full max-w-xs rounded-lg border border-border bg-background px-3 py-2 font-sans text-sm outline-none ring-accent/30 focus:ring-2"
              />
              <label className="sr-only" htmlFor="ideate-regret-new">
                Regret statement
              </label>
              <textarea
                id="ideate-regret-new"
                autoFocus
                value={regretDraft}
                onChange={(e) => setRegretDraft(e.target.value)}
                placeholder="What would you regret not having tried?"
                rows={3}
                maxLength={280}
                className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 font-display text-xl outline-none ring-accent/30 focus:ring-2"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAddingRegret(false);
                    setRegretDraft("");
                    setRegretCategoryDraft("");
                  }}
                  className="rounded-full px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!regretDraft.trim()}
                  className="rounded-full accent-fill-gradient px-3 py-1.5 text-xs font-medium text-on-accent disabled:opacity-40"
                >
                  Add
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setAddingRegret(true)}
              className="mt-5 cursor-pointer font-sans text-sm font-medium text-accent-link transition-opacity hover:opacity-80"
            >
              + Add an entry
            </button>
          )}
        </IdeateCollapsibleSection>
      </section>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-overlay/45 p-4 backdrop-blur-[2px] sm:items-center"
          role="presentation"
          onClick={() => {
            setModalOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-labelledby="ideate-add-dream-title"
            className="max-h-[min(92vh,40rem)] w-full max-w-lg overflow-y-auto rounded-[16px] border border-[#E5DFD0] bg-[#FAF8F3] p-6 shadow-xl dark:border-border dark:bg-card"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="ideate-add-dream-title"
              className="font-display text-xl font-medium text-[#1E2530] dark:text-foreground"
            >
              New life area
            </h2>
            <p className="mt-1 text-sm text-muted">
              Name it, and optionally seed the dream, resistance, and vision.
            </p>

            <label className="mt-5 block text-sm font-medium text-foreground">
              Title
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Music, Health, This app"
                autoFocus
                className="mt-1.5 w-full rounded-xl border border-[#E5DFD0] bg-card px-3 py-2.5 text-sm outline-none ring-accent/30 focus:ring-2 dark:border-border"
              />
            </label>

            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#B8703A]/15 text-[#B8703A]">
                    <IconSparkles size={15} stroke={1.75} aria-hidden />
                  </span>
                  The dream
                </span>
                <textarea
                  value={newDream}
                  onChange={(e) => setNewDream(e.target.value)}
                  placeholder="Say it messy. No one is grading this."
                  rows={3}
                  className="mt-2 w-full resize-none rounded-xl border border-[#E5DFD0] bg-card px-3 py-2.5 text-sm leading-relaxed outline-none ring-accent/30 focus:ring-2 dark:border-border"
                />
              </label>

              <label className="block">
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#A65252]/15 text-[#A65252]">
                    <IconWind size={15} stroke={1.75} aria-hidden />
                  </span>
                  What&apos;s in the way?
                </span>
                <textarea
                  value={newObstacle}
                  onChange={(e) => setNewObstacle(e.target.value)}
                  placeholder="Name it without fixing it yet."
                  rows={3}
                  className="mt-2 w-full resize-none rounded-xl border border-[#E5DFD0] bg-card px-3 py-2.5 text-sm leading-relaxed outline-none ring-accent/30 focus:ring-2 dark:border-border"
                />
              </label>

              <label className="block">
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#5A7A5E]/15 text-[#5A7A5E]">
                    <IconEye size={15} stroke={1.75} aria-hidden />
                  </span>
                  The vision
                </span>
                <textarea
                  value={newVision}
                  onChange={(e) => setNewVision(e.target.value)}
                  placeholder="A single moment when this has already happened."
                  rows={3}
                  className="mt-2 w-full resize-none rounded-xl border border-[#E5DFD0] bg-card px-3 py-2.5 text-sm leading-relaxed outline-none ring-accent/30 focus:ring-2 dark:border-border"
                />
              </label>
            </div>

            <div className="mt-6 flex items-center justify-between gap-3">
              <button
                type="button"
                disabled={!newTitle.trim()}
                onClick={() => addDream({ skipReflections: true })}
                className="cursor-pointer text-sm font-medium text-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                Skip for now
              </button>
              <button
                type="button"
                disabled={!newTitle.trim()}
                onClick={() => addDream()}
                className="cursor-pointer rounded-full bg-[#F0A855] px-5 py-2.5 text-sm font-medium text-[#1E2530] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeQuestion ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-overlay/45 p-4 backdrop-blur-[2px] sm:items-center"
          role="presentation"
          onClick={() => {
            setActiveQuestionId(null);
            setDraftAnswer("");
          }}
        >
          <div
            role="dialog"
            aria-labelledby="ideate-reflect-q-title"
            className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="ideate-reflect-q-title"
              className="font-display text-xl font-medium text-foreground"
            >
              {activeQuestion.text}
            </h2>
            {activeQuestion.description ? (
              <p className="mt-1 text-sm text-muted">
                {activeQuestion.description}
              </p>
            ) : null}
            <textarea
              value={draftAnswer}
              onChange={(e) => setDraftAnswer(e.target.value)}
              placeholder="Write freely — no need to polish."
              rows={8}
              autoFocus
              className="mt-5 w-full resize-none rounded-2xl border border-border bg-background px-4 py-3 text-sm leading-relaxed outline-none ring-accent/25 focus:ring-2"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setActiveQuestionId(null);
                  setDraftAnswer("");
                }}
                className="rounded-full border border-border px-4 py-2 text-sm font-medium text-muted transition-colors hover:bg-accent-soft/30 hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => saveActiveAnswer()}
                className="rounded-full accent-fill-gradient px-4 py-2 text-sm font-medium text-on-accent transition-opacity hover:opacity-90"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
