/* Inline SVG icon set. 24x24 grid, stroke = currentColor. Decorative by default (aria-hidden). */
import type { ReactNode, SVGProps } from "react";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  size?: number;
  /** When set, the icon is announced with this label instead of hidden. */
  title?: string;
}

function make(name: string, body: ReactNode, opts: { fill?: boolean } = {}) {
  const Icon = ({ size = 16, title, ...rest }: IconProps) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={opts.fill ? "currentColor" : "none"}
      stroke={opts.fill ? "none" : "currentColor"}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {body}
    </svg>
  );
  Icon.displayName = `Icon${name}`;
  return Icon;
}

/** Neutral satellite glyph (body + two solar panels). Not an agency insignia. */
export const IconSatellite = make(
  "Satellite",
  <>
    <rect x="9.5" y="9.5" width="5" height="5" rx="1" transform="rotate(45 12 12)" />
    <path d="M8.2 8.2 5 5M15.8 15.8 19 19" />
    <rect x="1.8" y="2.6" width="5" height="3" rx=".6" transform="rotate(45 4.3 4.1)" />
    <rect x="17.2" y="18.4" width="5" height="3" rx=".6" transform="rotate(45 19.7 19.9)" />
    <path d="M15 4.5a4.5 4.5 0 0 1 4.5 4.5M15 1.8A7.2 7.2 0 0 1 22.2 9" />
  </>,
);
export const IconPlay = make("Play", <path d="M7 4.5v15l12.5-7.5z" />, { fill: true });
export const IconSearch = make("Search", <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>);
export const IconLayers = make("Layers", <><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></>);
export const IconWind = make(
  "Wind",
  <path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8" />,
);
export const IconRain = make(
  "Rain",
  <><path d="M7 15a5 5 0 1 1 1.6-9.8A6 6 0 0 1 20 9a4 4 0 0 1-1 6" /><path d="m8 18-1 3M12 17l-1 4M16 18l-1 3" /></>,
);
export const IconFrost = make(
  "Frost",
  <path d="M12 2v20M4 6l16 12M20 6 4 18M9 3.5 12 6l3-2.5M9 20.5l3-2.5 3 2.5" />,
);
export const IconHeat = make(
  "Heat",
  <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
);
export const IconDrought = make(
  "Drought",
  <><path d="M12 3s5 6 5 9.5a5 5 0 0 1-10 0C7 9 12 3 12 3z" /><path d="M3 21h18M6 21l2-3M12 21v-3M18 21l-2-3" /></>,
);
export const IconSprout = make(
  "Sprout",
  <><path d="M12 21v-9" /><path d="M12 12c0-4-3-6-7-6 0 4 3 6 7 6zM12 10c0-3.5 2.5-6 7-6 0 4-2.5 6-7 6z" /></>,
);
export const IconAlert = make(
  "Alert",
  <><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17v.01" /></>,
);
export const IconCheck = make("Check", <path d="m5 12.5 4.5 4.5L19 7.5" />);
export const IconInfo = make(
  "Info",
  <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.01" /></>,
);
export const IconDownload = make("Download", <path d="M12 4v11m-5-5 5 5 5-5M4 20h16" />);
export const IconUpload = make("Upload", <path d="M12 16V5m-5 5 5-5 5 5M4 20h16" />);
export const IconBell = make(
  "Bell",
  <path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0" />,
);
export const IconGlobe = make(
  "Globe",
  <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" /></>,
);
export const IconMap = make("Map", <path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14" />);
export const Icon2D = make(
  "2D",
  <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 10h3l-3 4h3M13 10v4h1.5a2 2 0 0 0 0-4z" /></>,
);
export const Icon3D = make(
  "3D",
  <><path d="m12 2 9 5v10l-9 5-9-5V7z" /><path d="m3 7 9 5 9-5M12 12v10" /></>,
);
export const IconCompass = make(
  "Compass",
  <><circle cx="12" cy="12" r="9" /><path d="m12 5 2.5 7h-5z" fill="currentColor" /><path d="m9.5 12 2.5 7 2.5-7" /></>,
);
export const IconPolygon = make(
  "Polygon",
  <><path d="m5 7 9-3 6 8-7 8-8-4z" /><circle cx="5" cy="7" r="1.6" fill="currentColor" /><circle cx="14" cy="4" r="1.6" fill="currentColor" /><circle cx="20" cy="12" r="1.6" fill="currentColor" /><circle cx="13" cy="20" r="1.6" fill="currentColor" /><circle cx="5" cy="16" r="1.6" fill="currentColor" /></>,
);
export const IconClose = make("Close", <path d="M6 6l12 12M18 6 6 18" />);
export const IconChevronRight = make("ChevronRight", <path d="m9 5 7 7-7 7" />);
export const IconChevronLeft = make("ChevronLeft", <path d="m15 5-7 7 7 7" />);
export const IconChevronDown = make("ChevronDown", <path d="m5 9 7 7 7-7" />);
export const IconExternal = make("External", <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />);
export const IconLoader = make("Loader", <path d="M12 3a9 9 0 1 0 9 9" />);
export const IconClock = make("Clock", <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
export const IconBan = make("Ban", <><circle cx="12" cy="12" r="9" /><path d="m5.7 5.7 12.6 12.6" /></>);
export const IconEyeOff = make(
  "EyeOff",
  <path d="M3 3l18 18M10.6 6.1A9.7 9.7 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-2.4 3M6.6 6.6C4.3 8.1 3 12 3 12s4 6 9 6a8.6 8.6 0 0 0 4.4-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2" />,
);
