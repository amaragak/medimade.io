/**
 * Vision board preview mosaic.
 * `asymmetric` — marketing pitch collage.
 * `grid` — straight 3×2 square grid (/ideate/my).
 * Slots prefer images when provided; remaining slots use color fills.
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
  "#E0DAD0",
] as const;

export const VISION_BOARD_MOSAIC_SLOT_COUNT = 5;
export const VISION_BOARD_GRID_SLOT_COUNT = 6;

type Layout = "asymmetric" | "grid";

type Props = {
  colors: readonly string[];
  /**
   * Image URLs for mosaic slots (board order).
   * Empty / missing entries fall back to `colors`.
   */
  images?: readonly (string | null | undefined)[];
  /** Default asymmetric (marketing). Use `grid` for My Ideas. */
  layout?: Layout;
  className?: string;
  /** Overall size of the mosaic box */
  sizeClassName?: string;
  /** Grid gap (Dream hero uses 3px). */
  gapClassName?: string;
  /** Outer radius; pass `rounded-none` for flush editorial hero. */
  radiusClassName?: string;
  /** Cell corner radius. */
  cellRadiusClassName?: string;
};

function MosaicCell({
  color,
  imageSrc,
  className,
  objectPositionClassName = "object-center",
  objectPosition,
}: {
  color: string;
  imageSrc?: string | null;
  className?: string;
  objectPositionClassName?: string;
  /** CSS object-position when class utilities aren't enough (e.g. center 20%). */
  objectPosition?: string;
}) {
  if (imageSrc) {
    return (
      <div className={`relative min-h-0 min-w-0 overflow-hidden ${className ?? ""}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageSrc}
          alt=""
          className={`absolute inset-0 h-full w-full object-cover ${objectPosition ? "" : objectPositionClassName}`}
          style={objectPosition ? { objectPosition } : undefined}
          draggable={false}
        />
      </div>
    );
  }
  return (
    <div
      className={`min-h-0 min-w-0 ${className ?? ""}`}
      style={{ backgroundColor: color }}
    />
  );
}

export function VisionBoardMosaic({
  colors,
  images,
  layout = "asymmetric",
  className = "",
  sizeClassName = "h-[140px] w-[140px]",
  gapClassName = "gap-1.5",
  radiusClassName = "rounded-xl",
  cellRadiusClassName = "rounded-md",
}: Props) {
  const palette =
    colors.length > 0 ? colors : [...VISION_BOARD_EMPTY_COLORS];
  const c = (i: number) => palette[i % palette.length]!;
  const img = (i: number) => {
    const src = images?.[i];
    return typeof src === "string" && src.trim() ? src : null;
  };

  if (layout === "grid") {
    return (
      <div
        className={`grid w-full shrink-0 ${gapClassName} ${radiusClassName} ${sizeClassName} ${className}`}
        style={{
          gridTemplateColumns: "repeat(3, 1fr)",
        }}
        aria-hidden
      >
        {Array.from({ length: VISION_BOARD_GRID_SLOT_COUNT }, (_, i) => (
          <MosaicCell
            key={i}
            className={`aspect-[4/3] w-full ${cellRadiusClassName}`}
            color={c(i)}
            imageSrc={img(i)}
            objectPosition="center 20%"
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={`grid shrink-0 grid-cols-3 grid-rows-3 overflow-hidden ${gapClassName} ${radiusClassName} ${sizeClassName} ${className}`}
      aria-hidden
    >
      <MosaicCell
        className={`col-span-2 row-span-2 ${cellRadiusClassName}`}
        color={c(0)}
        imageSrc={img(0)}
      />
      <MosaicCell
        className={cellRadiusClassName}
        color={c(1)}
        imageSrc={img(1)}
      />
      <MosaicCell
        className={cellRadiusClassName}
        color={c(2)}
        imageSrc={img(2)}
      />
      <MosaicCell
        className={`col-span-2 ${cellRadiusClassName}`}
        color={c(3)}
        imageSrc={img(3)}
      />
      <MosaicCell
        className={cellRadiusClassName}
        color={c(4)}
        imageSrc={img(4)}
      />
    </div>
  );
}
