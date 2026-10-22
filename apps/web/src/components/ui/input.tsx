import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** shadcn/ui input; `aria-invalid` turns the border red. */
function Input({ className, type, ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-10 w-full min-w-0 rounded-md border border-input bg-navy-950/40 px-3 py-2 text-sm transition-[border-color,box-shadow] outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 file:me-3 file:border-0 file:bg-transparent file:text-sm file:font-semibold file:text-gold",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
