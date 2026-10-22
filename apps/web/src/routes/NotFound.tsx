import { Link, useLocation } from "react-router";

/** Any path the app does not know. */
export function NotFound() {
  const { search } = useLocation();
  return (
    <div className="mx-auto max-w-lg space-y-4 py-16 text-center">
      <p className="eyebrow">Not found</p>
      <h1 className="text-3xl font-semibold tracking-tight">There is no page here</h1>
      <p className="text-muted-foreground">Check the link, or go to your deals.</p>
      <Link to={`/deals${search}`} className="font-semibold text-gold hover:underline">
        My deals
      </Link>
    </div>
  );
}
