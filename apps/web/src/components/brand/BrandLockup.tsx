import { cn } from "@/lib/utils";
import { BrandMark } from "./BrandMark";

const SIZES = {
  md: { gap: "gap-3", mark: "size-10", word: "text-[1.1rem]", arabic: "text-sm" },
  lg: { gap: "gap-3.5", mark: "size-14", word: "text-[1.55rem]", arabic: "text-lg" },
};

/** Mark + "WASIT" + "وسيط": the header and footer signature (`lg` on the landing header). */
export function BrandLockup({
  className,
  size = "md",
}: {
  className?: string;
  size?: keyof typeof SIZES;
}) {
  const s = SIZES[size];
  return (
    <span className={cn("inline-flex items-center", s.gap, className)}>
      <BrandMark className={cn(s.mark, "drop-shadow-[0_4px_12px_rgb(221_184_134/0.25)]")} />
      <span className="flex flex-col items-center leading-none">
        <span
          className={cn(
            "font-medium tracking-[0.24em] text-foreground font-stretch-expanded",
            s.word,
          )}
        >
          WASIT
        </span>
        <span
          lang="ar"
          dir="rtl"
          className={cn("mt-1 font-arabic font-semibold text-gold", s.arabic)}
        >
          وسيط
        </span>
      </span>
    </span>
  );
}
