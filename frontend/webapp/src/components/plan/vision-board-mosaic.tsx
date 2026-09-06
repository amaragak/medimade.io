/**
 * Vision board preview mosaic.
 * `asymmetric` — marketing pitch collage.
 * `grid` — straight 3×2 square grid (/dream/my).
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
};

function MosaicCell({
  color,
  imageSrc,
  className,
}: {
  color: string;
  imageSrc?: string | null;
  className?: string;
}) {
  if (imageSrc) {
    return (
      <div className={`relative overflow-hidden rounded-md ${className ?? ""}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageSrc}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
      </div>
    );
  }
  return (
    <div
      className={`rounded-md ${className ?? ""}`}
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
        className={`grid shrink-0 grid-cols-3 gap-1.5 overflow-hidden rounded-xl ${sizeClassName} ${className}`}
        aria-hidden
      >
        {Array.from({ length: VISION_BOARD_GRID_SLOT_COUNT }, (_, i) => (
          <MosaicCell
            key={i}
            className="aspect-square"
            color={c(i)}
            imageSrc={img(i)}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={`grid shrink-0 grid-cols-3 grid-rows-3 gap-1.5 overflow-hidden rounded-xl ${sizeClassName} ${className}`}
      aria-hidden
    >
      <MosaicCell
        className="col-span-2 row-span-2"
        color={c(0)}
        imageSrc={img(0)}
      />
      <MosaicCell color={c(1)} imageSrc={img(1)} />
      <MosaicCell color={c(2)} imageSrc={img(2)} />
      <MosaicCell className="col-span-2" color={c(3)} imageSrc={img(3)} />
      <MosaicCell color={c(4)} imageSrc={img(4)} />
    </div>
  );
}
