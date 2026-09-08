const COLLAPSE_KEY = "mm_ideate_section_collapse_v1";

export type IdeateCollapsibleSectionId =
  | "values"
  | "questions"
  | "regrets"
  | "quotes"
  | "lifeAreas";

export type IdeateSectionCollapseState = Record<
  IdeateCollapsibleSectionId,
  boolean
>;

const DEFAULTS: IdeateSectionCollapseState = {
  values: false,
  questions: false,
  regrets: false,
  quotes: false,
  lifeAreas: false,
};

/** `true` = collapsed. Default: all expanded (false). */
export function loadIdeateSectionCollapse(): IdeateSectionCollapseState {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const raw = window.localStorage.getItem(COLLAPSE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<IdeateSectionCollapseState>;
    return {
      values: Boolean(parsed.values),
      questions: Boolean(parsed.questions),
      regrets: Boolean(parsed.regrets),
      quotes: Boolean(parsed.quotes),
      lifeAreas: Boolean(parsed.lifeAreas),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveIdeateSectionCollapse(
  state: IdeateSectionCollapseState,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify(state));
  } catch {
    /* */
  }
}
