import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { createGlobe } from "./createGlobe";

/** Mounts the three.js globe; fades it in on its first frame and reports a WebGL failure. */
export default function GlobeCanvas({
  className,
  onFail,
}: {
  className?: string;
  onFail: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    try {
      const globe = createGlobe(element, { reducedMotion, onFirstFrame: () => setShown(true) });
      return () => globe.destroy();
    } catch (error) {
      console.warn("Globe disabled:", error);
      onFail();
    }
  }, [onFail]);

  return (
    <div
      ref={container}
      aria-hidden
      className={cn(
        "transition-[opacity,scale] duration-[1600ms] ease-out-quint",
        shown ? "scale-100 opacity-100" : "scale-95 opacity-0",
        className,
      )}
    />
  );
}
