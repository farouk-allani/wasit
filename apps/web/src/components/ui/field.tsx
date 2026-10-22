import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** shadcn/ui label without the Radix dependency: a native label is enough here. */
function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn("text-sm leading-none font-medium select-none", className)}
      {...props}
    />
  );
}

/**
 * Label, control, hint and error stacked with ids wired up: the control gets
 * `aria-describedby` through the `children` render prop.
 */
function Field({
  id,
  label,
  hint,
  error,
  className,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  className?: string;
  children: (aria: { id: string; "aria-describedby"?: string; "aria-invalid"?: true }) => ReactNode;
}) {
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ");
  return (
    <div className={cn("grid content-start gap-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        "aria-describedby": describedBy || undefined,
        "aria-invalid": error ? true : undefined,
      })}
      {hint && (
        <p id={`${id}-hint`} className="text-xs leading-relaxed text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export { Field, Label };
