"use client";

import {
  LIFE_AREA_COLORS,
  type LifeAreaColorId,
} from "@/lib/ideate-life-area-colors";

type Props = {
  value: string | null;
  onChange: (id: LifeAreaColorId | null) => void;
  /** Allow clearing to default warm card (optional null swatch). */
  allowNone?: boolean;
};

export function LifeAreaColorPicker({
  value,
  onChange,
  allowNone = true,
}: Props) {
  return (
    <div
      role="radiogroup"
      aria-label="Card colour"
      className="flex flex-wrap items-center gap-2"
    >
      {allowNone ? (
        <button
          type="button"
          role="radio"
          aria-checked={value == null}
          aria-label="Default"
          onClick={() => onChange(null)}
          className={`h-5 w-5 shrink-0 cursor-pointer rounded-full border border-border bg-card transition-[box-shadow,transform] ${
            value == null
              ? "ring-2 ring-accent/70 ring-offset-2 ring-offset-[var(--background,#FAF8F3)]"
              : "hover:scale-105"
          }`}
        />
      ) : null}
      {LIFE_AREA_COLORS.map((c) => {
        const selected = value === c.id;
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={c.id.replace(/-/g, " ")}
            onClick={() => onChange(c.id)}
            className={`h-5 w-5 shrink-0 cursor-pointer rounded-full transition-[box-shadow,transform] ${
              selected
                ? "ring-2 ring-accent/70 ring-offset-2 ring-offset-[var(--background,#FAF8F3)]"
                : "hover:scale-105"
            }`}
            style={{ backgroundColor: c.swatch }}
          />
        );
      })}
    </div>
  );
}
