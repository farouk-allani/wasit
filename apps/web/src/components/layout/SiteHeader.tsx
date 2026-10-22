import { ArrowRight } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink } from "react-router";
import { BrandLockup } from "@/components/brand/BrandLockup";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const marketingNav = [
  { href: "/#deal-flow", label: "Deal flow" },
  { href: "/#protection", label: "Protection" },
  { href: "/#limits", label: "Limits" },
];

const appNav = [
  { to: "/deals", label: "My deals", end: true },
  { to: "/deals/new", label: "New deal", end: true },
];

/**
 * `marketing` floats over the landing hero and turns solid once the page scrolls; `app` is solid
 * and shows `actions` (the wallet button, which lives in the lazily loaded app shell).
 */
export function SiteHeader({
  variant,
  actions,
}: {
  variant: "marketing" | "app";
  actions?: ReactNode;
}) {
  const scrolled = useScrolled(24);
  const solid = variant === "app" || scrolled;
  return (
    <header
      className={cn(
        "sticky top-0 z-40 transition-[background-color,border-color,backdrop-filter] duration-300",
        variant === "marketing" && "-mb-20",
        solid
          ? "border-b border-border bg-navy-900/80 backdrop-blur-xl"
          : "border-b border-transparent",
      )}
    >
      <div
        className={cn(
          "mx-auto flex max-w-7xl items-center gap-8 px-4 sm:px-6 lg:px-8",
          variant === "marketing" ? "h-20" : "h-[4.5rem]",
        )}
      >
        <Link to="/" aria-label="Wasit home" className="rounded-md">
          <BrandLockup size={variant === "marketing" ? "lg" : "md"} />
        </Link>
        <nav aria-label="Main" className="hidden flex-1 items-center gap-1 md:flex">
          {variant === "marketing"
            ? marketingNav.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-3 py-2 text-sm font-medium text-foreground/75 transition-colors hover:text-foreground"
                >
                  {item.label}
                </a>
              ))
            : appNav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      isActive ? "text-gold" : "text-foreground/75 hover:text-foreground",
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
        </nav>
        <div className="ms-auto flex items-center gap-3">
          {variant === "marketing" ? (
            <Button asChild>
              <Link to="/deals">
                Launch app <ArrowRight aria-hidden className="rtl:-scale-x-100" />
              </Link>
            </Button>
          ) : (
            actions
          )}
        </div>
      </div>
    </header>
  );
}

function useScrolled(threshold: number) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > threshold);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [threshold]);
  return scrolled;
}
