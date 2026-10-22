import { useId } from "react";

/**
 * The Wasit mark: a steel and a gold chevron (the two parties) holding an ivory diamond (the
 * escrowed value) between them. Flat SVG so it stays sharp from favicon to hero size.
 */
export function BrandMark({ className, title }: { className?: string; title?: string }) {
  const id = useId();
  const url = (name: string) => `url(#${id}-${name})`;
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <defs>
        <linearGradient id={`${id}-steel`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#eef2f6" />
          <stop offset="1" stopColor="#8d98a8" />
        </linearGradient>
        <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f3dcb4" />
          <stop offset="1" stopColor="#b8895a" />
        </linearGradient>
      </defs>
      <g fill="none" strokeWidth="7" strokeLinejoin="miter">
        <path d="M24 11 L9 32 L24 53" stroke={url("steel")} />
        <path d="M40 11 L55 32 L40 53" stroke={url("gold")} />
      </g>
      <path d="M32 21 L43 32 L32 43 L21 32Z" fill="#f6efe2" />
    </svg>
  );
}
