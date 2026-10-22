import { useParams } from "react-router";

/** Stands in for a page whose UI comes in a later step (PLAN 4.4–4.7). */
export function Placeholder({ title }: { title: string }) {
  const { id } = useParams();
  return (
    <div className="space-y-3">
      <p className="eyebrow">Coming in this phase</p>
      <h1 className="text-3xl font-semibold tracking-tight">
        {title}
        {id !== undefined && <span className="text-muted-foreground"> #{id}</span>}
      </h1>
    </div>
  );
}
