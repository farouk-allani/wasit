import { Check, LockKeyhole } from "lucide-react";
import { useId } from "react";
import { cn } from "@/lib/utils";
import bitcoinLogo from "../logos/bitcoin.svg";

// Flat illustrations in the style of Farouk's mockup: a grey outline object with one bright accent
const LINE = "#4a5363";
const PAPER = "#ffffff";

function Frame({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 96 80"
      fill="none"
      aria-hidden
      className={cn("h-[5.5rem] w-[6.5rem] drop-shadow-[0_8px_10px_rgb(17_26_38/0.12)]", className)}
    >
      {children}
    </svg>
  );
}

/** A contract with a gold padlock: the terms are fixed before money moves. */
export function TermsIcon({ className }: { className?: string }) {
  const gold = useId();
  return (
    <Frame className={className}>
      <defs>
        <linearGradient id={gold} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f6d08f" />
          <stop offset="1" stopColor="#d4934a" />
        </linearGradient>
      </defs>
      <rect
        x="24"
        y="6"
        width="40"
        height="54"
        rx="5"
        fill={PAPER}
        stroke={LINE}
        strokeWidth="2.2"
      />
      <path
        d="M32 18h24M32 26h24M32 34h24M32 42h14"
        stroke={LINE}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="64" cy="56" r="14" fill={`url(#${gold})`} />
      <LockKeyhole x="55" y="47" width="18" height="18" color="#fff" strokeWidth={2.4} />
    </Frame>
  );
}

/** The advance as a coin stack, with the BTC bond that backs it. */
export function AdvanceIcon({ className }: { className?: string }) {
  const coins = [58, 49, 40];
  return (
    <Frame className={className}>
      {coins.map((y) => (
        <g key={y} stroke={LINE} strokeWidth="2.2" fill={PAPER}>
          <path d={`M14 ${y}v7a16 6 0 0 0 32 0v-7`} />
          <ellipse cx="30" cy={y} rx="16" ry="6" />
        </g>
      ))}
      <image href={bitcoinLogo} x="44" y="30" width="36" height="36" />
    </Frame>
  );
}

/** A shipped box with a green check: inspector and carrier have signed. */
export function AttestationIcon({ className }: { className?: string }) {
  return (
    <Frame className={className}>
      <g stroke={LINE} strokeWidth="2.2" strokeLinejoin="round" fill={PAPER}>
        <path d="M44 8l24 12-24 12-24-12z" />
        <path d="M20 20v28l24 12V32z" />
        <path d="M68 20v28L44 60V32z" fill="#f1f2f4" />
      </g>
      <path d="M32 14l24 12v8" stroke={LINE} strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="68" cy="58" r="13" fill="#2fa36b" />
      <Check x="60" y="50" width="16" height="16" color="#fff" strokeWidth={3} />
    </Frame>
  );
}

/** Two arrows: the balance released to the supplier, or refunded to the buyer. */
export function SettleIcon({ className }: { className?: string }) {
  const orange = useId();
  const blue = useId();
  return (
    <Frame className={className}>
      <defs>
        <linearGradient id={orange} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#f8b24c" />
          <stop offset="1" stopColor="#ef7d2d" />
        </linearGradient>
        <linearGradient id={blue} x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="#5aa0f2" />
          <stop offset="1" stopColor="#2f6fe0" />
        </linearGradient>
      </defs>
      <g strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 28h44M56 17l11 11-11 11" stroke={`url(#${orange})`} />
        <path d="M74 52H30M40 41L29 52l11 11" stroke={`url(#${blue})`} />
      </g>
    </Frame>
  );
}
