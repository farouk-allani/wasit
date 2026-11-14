import { ExternalLink } from "lucide-react";
import { Link } from "react-router";
import { BrandLockup } from "@/components/brand/BrandLockup";
import { useDeployment } from "@/deployment";
import { explorerAddress, REPO_URL } from "@/lib/links";

/** The three contract sets on Mezo testnet (deployments/). */
const SETS = [
  ["mezo-testnet", "Live (BTC bond)"],
  ["mezo-testnet-trove", "Trove-backed bond"],
  ["mezo-testnet-demo-sim", "Demo (simulated price feed)"],
] as const;

/** Every page ends with what Wasit is, where it runs, and that it is not audited. */
export function SiteFooter() {
  const deployment = useDeployment();
  return (
    <footer className="border-t border-border bg-navy-950">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr] lg:px-8">
        <div className="space-y-4">
          <BrandLockup />
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            Protected advance payments for stablecoin trade, settled in MUSD on Mezo.
          </p>
        </div>
        <FooterLinks
          title="Project"
          links={[
            { href: REPO_URL, label: "Source code" },
            { href: `${REPO_URL}/blob/main/docs/security-review.md`, label: "Security review" },
          ]}
        />
        <FooterLinks
          title="Contracts"
          links={[
            { href: explorerAddress(deployment.escrow), label: "Escrow on explorer" },
            { href: explorerAddress(deployment.bond), label: "Bond on explorer" },
          ]}
        />
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-5 text-xs tracking-wide text-muted-foreground sm:px-6 lg:px-8">
          <span>Mezo testnet · Not audited</span>
          <nav aria-label="Contract set" className="flex flex-wrap gap-x-4 gap-y-1">
            <span>Contract set:</span>
            {SETS.map(([name, label]) => (
              <Link
                key={name}
                to={`/deals?deployment=${name}`}
                aria-current={deployment.name === name ? "true" : undefined}
                className={deployment.name === name ? "text-gold" : "hover:text-gold"}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}

function FooterLinks({
  title,
  links,
}: {
  title: string;
  links: { href: string; label: string }[];
}) {
  return (
    <div>
      <h2 className="eyebrow mb-4">{title}</h2>
      <ul className="space-y-2.5">
        {links.map((link) => (
          <li key={link.href}>
            <a
              href={link.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-sm text-sm text-foreground/80 transition-colors hover:text-gold"
            >
              {link.label}
              <ExternalLink aria-hidden className="size-3.5 opacity-60" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
