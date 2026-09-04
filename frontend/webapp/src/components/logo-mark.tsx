/** Brand sun mark. Swap this file to replace the logo everywhere it is used. */
export const LOGO_MARK_FILL = "#F0A855";

export function LogoMark({
  size = 34,
  className,
  fill = "currentColor",
}: {
  size?: number;
  className?: string;
  /** Defaults to `currentColor` so parents can theme light (clay) vs dark (gold). */
  fill?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
      focusable="false"
    >
      <circle cx="18" cy="18" r="7" fill={fill} />
      <g fill={fill}>
        <polygon points="18,0 20,7 16,7" />
        <polygon points="18,36 20,29 16,29" />
        <polygon points="0,18 7,20 7,16" />
        <polygon points="36,18 29,20 29,16" />
        <polygon points="5.8,5.8 11.5,9 9,11.5" />
        <polygon points="30.2,30.2 24.5,27 27,24.5" />
        <polygon points="5.8,30.2 9,24.5 11.5,27" />
        <polygon points="30.2,5.8 27,11.5 24.5,9" />
      </g>
    </svg>
  );
}
