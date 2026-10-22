import { cn } from "@/lib/utils";
import { BrandMark } from "./BrandMark";

const SIZES = {
  md: { gap: "gap-2.5", mark: "size-9", word: "text-[1.1rem]" },
  lg: { gap: "gap-3", mark: "size-11", word: "text-[1.55rem]" },
};

/** Mark + "WASIT": the header and footer signature (`lg` on the landing header). */
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
      <BrandMark className={s.mark} />
      <span
        className={cn(
          "font-medium leading-none tracking-[0.24em] text-foreground font-stretch-expanded",
          s.word,
        )}
      >
        WASIT
      </span>
    </span>
  );
}
