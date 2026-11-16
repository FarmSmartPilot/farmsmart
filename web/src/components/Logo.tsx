/* FarmSmart mark: a leaf-shaped tile with a sprout (the next crop). From the FarmSmart brand files
   (docs/brand/farmsmart-logo.svg). No agency insignia. */
export const LOGO_COLORS = { tile: "#214D35", sprout: "#DDF3AA", ink: "#243B30", tag: "#81947F" };

export function LogoMark({ size = 28, title }: { size?: number; title?: string }) {
  const { tile, sprout } = LOGO_COLORS;
  return (
    <svg
      width={size}
      height={size}
      viewBox="7.5 12 40 40"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className="logo-mark"
    >
      <path d="M20 12.5H42Q45 12.5 45 15.5V41.5Q45 51.5 35 51.5H13Q10 51.5 10 48.5V22.5Q10 12.5 20 12.5Z" fill={tile} />
      <g
        transform="translate(15 19.5) scale(1.0416667)"
        fill="none"
        stroke={sprout}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M7 20h10" />
        <path d="M10 20c5.5-2.5.8-6.4 3-10" />
        <path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z" />
        <path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z" />
      </g>
    </svg>
  );
}

/** The FarmSmart wordmark as text: "Farm" heavy, "Smart" medium, one word (screen readers read "FarmSmart"). */
export function BrandName({ className }: { className?: string }) {
  return (
    <span className={className ? `brand-word ${className}` : "brand-word"}>
      <span className="brand-word__farm">Farm</span>
      <span className="brand-word__smart">Smart</span>
    </span>
  );
}
