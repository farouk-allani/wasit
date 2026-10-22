import { ExternalLink } from "lucide-react";
import { REPO_URL } from "@/lib/links";
import { EnforcedIcon, LimitsIcon } from "../icons/StepIcons";
import { Reveal } from "../Reveal";

const COLUMNS: {
  icon: typeof EnforcedIcon;
  title: string;
  lead: string;
  items: { term: string; detail: string }[];
}[] = [
  {
    icon: EnforcedIcon,
    title: "Enforced by the contracts",
    lead: "No person can override these, including us.",
    items: [
      {
        term: "No owner access to money",
        detail:
          "The owner sets fees and adapters for new deals only. It cannot move deal funds or bond collateral.",
      },
      {
        term: "Exits never pause",
        detail:
          "A pause stops new deals. Release, refund, default claims and rulings always go through.",
      },
      {
        term: "Terms are frozen",
        detail:
          "Amounts, parties and deadlines are fixed when the deal is created. No upgradeable proxy.",
      },
      {
        term: "A public record",
        detail: "Every state change emits an event, so anyone can trace a deal on the explorer.",
      },
    ],
  },
  {
    icon: LimitsIcon,
    title: "Where it stops",
    lead: "What the code cannot do for you.",
    items: [
      {
        term: "The bond covers the advance only",
        detail: "And only up to what its BTC is worth. A sharp crash can leave it short.",
      },
      {
        term: "Signatures, not truth",
        detail:
          "Attestations are statements by named parties. The challenge window and the arbiter catch false ones.",
      },
      {
        term: "Fingerprints, not shipments",
        detail:
          "A document hash proves a file was not altered. It does not prove the goods shipped.",
      },
      {
        term: "Testnet, not audited",
        detail: "MUSD is valued at one dollar. The contracts are internally reviewed only.",
      },
    ],
  },
];

/** What the code enforces and what it cannot, as two cards in the step-card style. */
export function Principles() {
  return (
    <section
      id="limits"
      aria-labelledby="limits-title"
      className="theme-paper scroll-mt-20 py-24 sm:py-32"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl space-y-5">
            <p className="eyebrow">Limits and principles</p>
            <h2
              id="limits-title"
              className="text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-[2.6rem]"
            >
              What the code enforces, and where it stops.
            </h2>
          </div>
          <a
            href={`${REPO_URL}/blob/main/docs/security-review.md`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-foreground underline decoration-gold underline-offset-4 hover:decoration-2"
          >
            Read the security review <ExternalLink aria-hidden className="size-3.5" />
          </a>
        </Reveal>

        <div className="mt-14 grid gap-6 md:grid-cols-2">
          {COLUMNS.map(({ icon: ColumnIcon, title, lead, items }, i) => (
            <Reveal key={title} delay={i * 100} className="h-full">
              <div className="h-full rounded-2xl border border-border bg-card p-6 shadow-[0_1px_0_rgb(17_26_38/0.04),0_16px_40px_-28px_rgb(17_26_38/0.45)] sm:p-8">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-1.5">
                    <h3 className="text-xl font-semibold">{title}</h3>
                    <p className="text-sm text-muted-foreground">{lead}</p>
                  </div>
                  <ColumnIcon className="shrink-0" />
                </div>
                <dl className="mt-6 divide-y divide-border border-t border-border">
                  {items.map(({ term, detail }) => (
                    <div key={term} className="space-y-1 py-4 last:pb-0">
                      <dt className="text-[0.95rem] font-semibold">{term}</dt>
                      <dd className="text-sm leading-relaxed text-muted-foreground">{detail}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
