/** Light theme — navy + gold-tan (aligned with web `theme-colors.ts`). */
export const colorsLight = {
  background: "#FAF8F3",
  foreground: "#1E2530",
  muted: "#7A7566",
  card: "#FFFFFF",
  border: "#E5E0D2",
  accent: "#D9A24F",
  accentSoft: "#F3E6C8",
  gold: "#D9A24F",
  deep: "#1E2530",
  onAccent: "#3D2E10",
  accentLink: "#B8703A",
  nav: "#33465C",
  faint: "#A39C8C",
  selected: "#33465C",
  onSelected: "#FFFFFF",
  starIdle: "#B5AF9F",
  /** Web `bg-border/40` user bubbles */
  userBubble: "rgba(229, 224, 210, 0.55)",
  /** Web `bg-accent-soft/80` guide chat bubbles */
  assistantBubble: "rgba(243, 230, 200, 0.85)",
  /** Web script bubble `border-gold/45 bg-gold/5` */
  scriptBubbleBg: "rgba(217, 162, 79, 0.08)",
  scriptBubbleBorder: "rgba(217, 162, 79, 0.45)",
  /** Web mobile nav pills */
  pillBorder: "#E5E0D2",
  pillBg: "#ffffff",
  pillText: "#1E2530",
} as const;

export const colors = colorsLight;
