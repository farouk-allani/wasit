import { ExternalLink } from "lucide-react";
import { REPO_URL } from "@/lib/links";
import { Reveal } from "../Reveal";

const COLUMNS: { title: string; note?: string; items: string[] }[] = [
  {
    title: "Enforced by the contracts",
    items: [
      "Nobody, including Wasit's owner, can move deal funds or bond collateral.",
      "Release, refunds, default claims and dispute rulings can never be paused.",
      "A deal's terms never change once it is created. There is no upgradeable proxy.",
      "Every state change is an on-chain event, so each deal has a full public history.",
    ],
  },
  {
    title: "Honest limits",
    items: [
      "The bond secures only the advance, and only up to what it is worth.",
      "Attestations are signed statements by named parties, not proof of truth. The challenge window and the arbiter exist for that reason.",
      "A document fingerprint proves a file was not altered. It does not prove the goods shipped.",
      "MUSD is treated as one dollar. Testnet only; internally reviewed, not audited.",
    ],
  },
  {
    title: "Designed to avoid interest",
    note: "Shariah review pending",
    items: [
      "No lending or borrowing anywhere in a deal.",
      "No yield on held funds: escrow and bond collateral are never deposited, staked or lent.",
      "Fees pay for the service: only on value settled to the supplier, never on refunds, never by time.",
      "The bonder is not paid for guaranteeing, and every amount, party and deadline is fixed before money moves.",
    ],
  },
];

/** What the code enforces, what it cannot, and the HALAL.md constraints, in plain words. */
export function Principles() {
  return (
    <section
      id="limits"
      aria-labelledby="limits-title"
      className="theme-paper scroll-mt-20 py-24 sm:py-32"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="max-w-2xl space-y-5">
          <p className="eyebrow">Limits and principles</p>
          <h2
            id="limits-title"
            className="text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-[2.6rem]"
          >
            What Wasit is, and what it is not.
          </h2>
        </Reveal>

        <div className="mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
          {COLUMNS.map((column, i) => (
            <Reveal key={column.title} delay={i * 100} className="space-y-5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border pb-4">
                <h3 className="text-lg font-semibold">{column.title}</h3>
                {column.note && (
                  <span className="text-xs font-semibold tracking-wide text-gold uppercase">
                    {column.note}
                  </span>
                )}
              </div>
              <ul className="space-y-4">
                {column.items.map((item) => (
                  <li
                    key={item}
                    className="flex gap-3 text-sm leading-relaxed text-muted-foreground"
                  >
                    <span aria-hidden className="mt-2 h-px w-3 shrink-0 bg-gold" />
                    {item}
                  </li>
                ))}
              </ul>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-12">
          <a
            href={`${REPO_URL}/blob/main/docs/security-review.md`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-foreground underline decoration-gold underline-offset-4 hover:decoration-2"
          >
            Read the security review <ExternalLink aria-hidden className="size-3.5" />
          </a>
        </Reveal>
      </div>
    </section>
  );
}
