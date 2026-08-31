/**
 * Asymmetric color-block mosaic used for vision board previews
 * (marketing pitch + /ideate/my card).
 */

export const VISION_BOARD_EXAMPLE_COLORS = [
  "#C4A882",
  "#8FA89A",
  "#A8B5C4",
  "#D4A090",
  "#C9B896",
] as const;

/** Muted desaturated tones when the board has no real items yet. */
export const VISION_BOARD_EMPTY_COLORS = [
  "#E8E0D4",
  "#DCD6CA",
  "#D4CFC4",
  "#E2D9CE",
  "#D8D2C6",
] as const;

type Props = {
  colors: readonly string[];
  className?: string;
  /** Overall size of the mosaic box */
  sizeClassName?: string;
};

export function VisionBoardMosaic({
  colors,
  className = "",
  sizeClassName = "h-[140px] w-[140px]",
}: Props) {
  const palette =
    colors.length > 0 ? colors : [...VISION_BOARD_EMPTY_COLORS];
  const c = (i: number) => palette[i % palette.length]!;

  return (
    <div
      className={`grid shrink-0 grid-cols-3 grid-rows-3 gap-1.5 overflow-hidden rounded-xl ${sizeClassName} ${className}`}
      aria-hidden
    >
      <div
        className="col-span-2 row-span-2 rounded-md"
        style={{ backgroundColor: c(0) }}
      />
      <div className="rounded-md" style={{ backgroundColor: c(1) }} />
      <div className="rounded-md" style={{ backgroundColor: c(2) }} />
      <div
        className="col-span-2 rounded-md"
        style={{ backgroundColor: c(3) }}
      />
      <div className="rounded-md" style={{ backgroundColor: c(4) }} />
    </div>
  );
}
