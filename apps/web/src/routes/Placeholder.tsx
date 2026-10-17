import { useParams } from "react-router";

/** Stands in for a page whose UI waits for the design (PLAN 4.2–4.7). */
export function Placeholder({ title }: { title: string }) {
  const { id } = useParams();
  return (
    <h1>
      {title}
      {id !== undefined && ` #${id}`}
    </h1>
  );
}
