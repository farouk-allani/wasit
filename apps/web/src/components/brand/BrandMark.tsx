import { useId } from "react";

// A flat metal band around the globe seen in perspective: the outline between two ellipses offset
// by the band height. `back` is the half behind the globe (its inner face), `front` the half before it.
const band = (rx: number, ry: number, h: number, half: "back" | "front") => {
  const top = -h / 2;
  const bottom = h / 2;
  return half === "back"
    ? `M${rx} ${top}A${rx} ${ry} 0 0 0 ${-rx} ${top}V${bottom}A${rx} ${ry} 0 0 1 ${rx} ${bottom}Z`
    : `M${-rx} ${top}A${rx} ${ry} 0 0 0 ${rx} ${top}V${bottom}A${rx} ${ry} 0 0 1 ${-rx} ${bottom}Z`;
};

const GOLD = { rx: 27, ry: 8.5, h: 5.5, angle: -24 };
const STEEL = { rx: 27, ry: 11, h: 4.5, angle: 34 };
const LIGHTS = [
  [25, 24, 0.7],
  [27.6, 26.4, 0.45],
  [38.5, 22.5, 0.55],
  [41.5, 28.6, 0.7],
  [36, 37, 0.45],
  [23, 34.5, 0.5],
  [31, 20.5, 0.4],
  [44.5, 34, 0.4],
] as const;

/**
 * The Wasit mark: a night globe held by a gold and a steel band (the two parties), each passing
 * behind and in front of it. Drawn as SVG so it stays sharp from favicon to hero size.
 */
export function BrandMark({ className, title }: { className?: string; title?: string }) {
  const id = useId();
  const url = (name: string) => `url(#${id}-${name})`;
  const place = ({ angle }: { angle: number }) => `rotate(${angle} 32 32) translate(32 32)`;
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <defs>
        <radialGradient id={`${id}-globe`} cx="36%" cy="30%" r="78%">
          <stop offset="0" stopColor="#34506f" />
          <stop offset="0.5" stopColor="#14263c" />
          <stop offset="1" stopColor="#050b14" />
        </radialGradient>
        <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#9a7040" />
          <stop offset="0.35" stopColor="#f3dcb4" />
          <stop offset="0.7" stopColor="#cfa36b" />
          <stop offset="1" stopColor="#8a6236" />
        </linearGradient>
        <linearGradient id={`${id}-steel`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#6b7687" />
          <stop offset="0.4" stopColor="#c3ccd8" />
          <stop offset="0.75" stopColor="#f4f7fa" />
          <stop offset="1" stopColor="#7f8a9b" />
        </linearGradient>
        <linearGradient id={`${id}-gold-in`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#4f381d" />
          <stop offset="0.5" stopColor="#8c6639" />
          <stop offset="1" stopColor="#4f381d" />
        </linearGradient>
        <linearGradient id={`${id}-steel-in`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#323b49" />
          <stop offset="0.5" stopColor="#6a7586" />
          <stop offset="1" stopColor="#323b49" />
        </linearGradient>
      </defs>
      <path
        transform={place(STEEL)}
        d={band(STEEL.rx, STEEL.ry, STEEL.h, "back")}
        fill={url("steel-in")}
      />
      <path
        transform={place(GOLD)}
        d={band(GOLD.rx, GOLD.ry, GOLD.h, "back")}
        fill={url("gold-in")}
      />
      <circle cx="32" cy="32" r="21.5" fill={url("globe")} />
      <g fill="none" stroke="#ffffff" strokeOpacity="0.1" strokeWidth="0.5">
        <ellipse cx="32" cy="32" rx="8" ry="21.5" />
        <ellipse cx="32" cy="32" rx="16" ry="21.5" />
        <ellipse cx="32" cy="32" rx="21.5" ry="7" />
      </g>
      <g fill="#f3d3a0">
        {LIGHTS.map(([cx, cy, r]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} />
        ))}
      </g>
      <path
        transform={place(STEEL)}
        d={band(STEEL.rx, STEEL.ry, STEEL.h, "front")}
        fill={url("steel")}
      />
      <path
        transform={place(GOLD)}
        d={band(GOLD.rx, GOLD.ry, GOLD.h, "front")}
        fill={url("gold")}
      />
    </svg>
  );
}
