import { cn } from "@/lib/utils";
import { BrandMark } from "./BrandMark";

/** Mark + "WASIT" + "وسيط": the header and footer signature. */
export function BrandLockup({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <BrandMark className="size-10 drop-shadow-[0_4px_12px_rgb(221_184_134/0.25)]" />
      <span className="flex flex-col leading-none">
        <span className="font-display text-[1.15rem] font-normal tracking-[0.3em] text-foreground">
          WASIT
        </span>
        <span lang="ar" dir="rtl" className="mt-1 font-arabic text-sm font-semibold text-gold">
          وسيط
        </span>
      </span>
    </span>
  );
}
