export const CREATE_MEDITATE_ROOT = "/meditate/create";

export type CreateMeditationPath =
  | "pending"
  | "style"
  | "freeflow"
  | "journalReflect"
  | "goal";

export type ParsedCreateMeditationRoute = {
  path: CreateMeditationPath;
  styleStep: "type" | "questions";
  mix: boolean;
  valid: boolean;
};

function partsAfterCreateRoot(pathname: string): string[] | null {
  if (pathname === CREATE_MEDITATE_ROOT) return [];
  const prefix = `${CREATE_MEDITATE_ROOT}/`;
  if (!pathname.startsWith(prefix)) return null;
  return pathname.slice(prefix.length).split("/").filter(Boolean);
}

export function parseCreateMeditationPathname(
  pathname: string,
): ParsedCreateMeditationRoute {
  const parts = partsAfterCreateRoot(pathname);
  if (parts == null) {
    return { path: "pending", styleStep: "type", mix: false, valid: true };
  }
  if (parts.length === 0) {
    return { path: "pending", styleStep: "type", mix: false, valid: true };
  }

  const mix = parts[parts.length - 1] === "mix";
  const segs = mix ? parts.slice(0, -1) : parts;
  if (mix && segs.length === 0) {
    return { path: "pending", styleStep: "type", mix: false, valid: false };
  }

  const a = segs[0];
  const b = segs[1];
  if (a === "by-type" && segs.length === 1) {
    return { path: "style", styleStep: "type", mix, valid: true };
  }
  if (a === "by-type" && b === "questions" && segs.length === 2) {
    return { path: "style", styleStep: "questions", mix, valid: true };
  }
  if (a === "from-chat" && segs.length === 1) {
    return { path: "freeflow", styleStep: "type", mix, valid: true };
  }
  if (a === "from-journal" && segs.length === 1) {
    return { path: "journalReflect", styleStep: "type", mix, valid: true };
  }
  if (a === "from-idea" && segs.length === 1) {
    return { path: "goal", styleStep: "type", mix, valid: true };
  }
  return { path: "pending", styleStep: "type", mix: false, valid: false };
}

export function createMeditationHref(opts: {
  path: CreateMeditationPath;
  styleStep?: "type" | "questions";
  mix?: boolean;
}): string {
  if (opts.path === "pending") return CREATE_MEDITATE_ROOT;
  const base =
    opts.path === "style"
      ? `${CREATE_MEDITATE_ROOT}/by-type`
      : opts.path === "freeflow"
        ? `${CREATE_MEDITATE_ROOT}/from-chat`
        : opts.path === "journalReflect"
          ? `${CREATE_MEDITATE_ROOT}/from-journal`
          : `${CREATE_MEDITATE_ROOT}/from-idea`;
  if (opts.path === "style" && opts.styleStep === "questions") {
    return opts.mix ? `${base}/questions/mix` : `${base}/questions`;
  }
  return opts.mix ? `${base}/mix` : base;
}

export function createRouteNeedsPriorState(
  parsed: ParsedCreateMeditationRoute,
): boolean {
  if (!parsed.valid) return false;
  if (parsed.mix) return true;
  return parsed.path === "style" && parsed.styleStep === "questions";
}

export function createMeditationPathStartHref(
  parsed: ParsedCreateMeditationRoute,
): string {
  if (!parsed.valid || parsed.path === "pending") return CREATE_MEDITATE_ROOT;
  return createMeditationHref({
    path: parsed.path,
    styleStep: "type",
    mix: false,
  });
}

export function createMeditationHrefWithDraft(
  href: string,
  draftSk: string | null | undefined,
): string {
  const sk = draftSk?.trim();
  if (!sk) return href;
  const join = href.includes("?") ? "&" : "?";
  return `${href}${join}draftSk=${encodeURIComponent(sk)}`;
}
