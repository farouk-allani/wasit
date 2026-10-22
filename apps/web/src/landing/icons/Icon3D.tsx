import { cn } from "@/lib/utils";
import alert from "./alert.webp";
import btcCoin from "./btc-coin.webp";
import coinsBtc from "./coins-btc.webp";
import contract from "./contract.webp";
import docCheck from "./doc-check.webp";
import dollarCoin from "./dollar-coin.webp";
import padlock from "./padlock.webp";
import shield from "./shield.webp";
import swap from "./swap.webp";

const ICONS = {
  alert,
  "btc-coin": btcCoin,
  "coins-btc": coinsBtc,
  contract,
  "doc-check": docCheck,
  "dollar-coin": dollarCoin,
  padlock,
  shield,
  swap,
};

export type Icon3DName = keyof typeof ICONS;

/** One of the Blender-rendered 3D icons (scripts/icons); decorative, so empty alt text. */
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
