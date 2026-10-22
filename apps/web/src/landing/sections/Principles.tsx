import { ExternalLink } from "lucide-react";
import { REPO_URL } from "@/lib/links";
import { Icon3D, type Icon3DName } from "../icons/Icon3D";
import { Reveal } from "../Reveal";

const COLUMNS: { title: string; icon: Icon3DName; items: string[] }[] = [
  {
    title: "Enforced by the contracts",
    icon: "shield",
    items: [
      "Nobody, including Wasit's owner, can move deal funds or bond collateral.",
      "Release, refunds, default claims and dispute rulings can never be paused.",
      "A deal's terms never change once it is created. There is no upgradeable proxy.",
      "Every state change is an on-chain event, so each deal has a full public history.",
    ],
  },
  {
    title: "Honest limits",
    icon: "warning",
    items: [
      "The bond secures only the advance, and only up to what it is worth.",
      "Attestations are signed statements by named parties, not proof of truth. The challenge window and the arbiter exist for that reason.",
      "A document fingerprint proves a file was not altered. It does not prove the goods shipped.",
      "MUSD is treated as one dollar. Testnet only; internally reviewed, not audited.",
    ],
  },
];

/** What the code enforces and what it cannot, in plain words. */
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

        <div className="mt-14 grid gap-10 md:grid-cols-2 md:gap-8">
          {COLUMNS.map((column, i) => (
            <Reveal key={column.title} delay={i * 100} className="space-y-5">
              <div className="flex items-center gap-4 border-b border-border pb-4">
                <Icon3D name={column.icon} className="size-14" />
                <h3 className="text-lg font-semibold">{column.title}</h3>
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
