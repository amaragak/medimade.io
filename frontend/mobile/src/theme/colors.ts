/** Light theme — warm paper tones; slightly deeper than web for small screens */
export const colorsLight = {
  background: "#f1e8de",
  foreground: "#2c2621",
  muted: "#6f665e",
  card: "#faf5ef",
  border: "#e5d9cc",
  accent: "#b86b48",
  accentSoft: "#f0e0d6",
  gold: "#c49a6c",
  deep: "#1a1410",
  /** Web `bg-border/40` user bubbles */
  userBubble: "rgba(235, 226, 214, 0.55)",
  /** Web `bg-accent-soft/80` guide chat bubbles */
  assistantBubble: "rgba(240, 224, 214, 0.85)",
  /** Web script bubble `border-gold/45 bg-gold/5` */
  scriptBubbleBg: "rgba(196, 154, 108, 0.08)",
  scriptBubbleBorder: "rgba(196, 154, 108, 0.45)",
  /** Web mobile nav pills `border-neutral-200 bg-white` */
  pillBorder: "#e5e5e5",
  pillBg: "#ffffff",
  pillText: "#171717",
} as const;

export const colors = colorsLight;

