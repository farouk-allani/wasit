/** First focusable element on every page: jumps keyboard users past the header. */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only z-50 rounded-md bg-primary px-4 py-2 font-semibold text-primary-foreground focus:not-sr-only focus:fixed focus:start-4 focus:top-4"
    >
      Skip to content
    </a>
  );
}
