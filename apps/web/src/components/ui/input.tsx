import { forwardRef, type ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * shadcn/ui input; `aria-invalid` turns the border red. forwardRef because React 18 drops `ref`
 * on function components, and react-hook-form's `register` needs it to set and focus the field.
 */
const Input = forwardRef<HTMLInputElement, ComponentProps<"input">>(function Input(
  { className, type, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      data-slot="input"
      className={cn(
        "flex h-10 w-full min-w-0 rounded-md border border-input bg-card px-3 py-2 text-sm transition-[border-color,box-shadow] outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        className,
      )}
      {...props}
    />
  );
});

export { Input };
