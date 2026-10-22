import { cn } from "@/lib/utils";
import balanceScale from "./balance-scale.webp";
import coin from "./coin.webp";
import dollarBanknote from "./dollar-banknote.webp";
import handshake from "./handshake.webp";
import locked from "./locked.webp";
import moneyBag from "./money-bag.webp";
import packageBox from "./package.webp";
import shield from "./shield.webp";
import warning from "./warning.webp";

// Fluent Emoji 3D by Microsoft, MIT (see LICENSE-fluent-emoji.txt)
const ICONS = {
  "balance-scale": balanceScale,
  coin,
  "dollar-banknote": dollarBanknote,
  handshake,
  locked,
  "money-bag": moneyBag,
  package: packageBox,
  shield,
  warning,
};

export type Icon3DName = keyof typeof ICONS;

/** A colored 3D icon; decorative, so empty alt text. */
export function Icon3D({ name, className }: { name: Icon3DName; className?: string }) {
  return (
    <img
      src={ICONS[name]}
      alt=""
      width={256}
      height={256}
      loading="lazy"
      decoding="async"
      draggable={false}
      className={cn("size-12 shrink-0 select-none", className)}
    />
  );
}
