import {
  CircleCheck,
  ClipboardCheck,
  Factory,
  FileCheck2,
  FileUp,
  Scale,
  ShieldCheck,
  ShieldOff,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import { useFormContext, useWatch, type FieldPath } from "react-hook-form";
import { isAddress, type Address } from "viem";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { percent } from "@/landing/params";
import { formatBytes, formatDuration, formatMusd } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  feeOn,
  hashFile,
  parseMusd,
  PERIODS,
  periodSeconds,
  splitOrder,
  TIMELINES,
  type DealFormInput,
  type DealFormValues,
  type PeriodKey,
  type TimelinePreset,
} from "./terms";

/** Fields each step validates before moving on. */
export const STEP_FIELDS: FieldPath<DealFormInput>[][] = [
  ["total", "advancePct", "termsHash"],
  ["supplier", "inspector", "carrier", "arbiter"],
  ["bondEnabled", "bonder", "bondRatioPct"],
  ["timeline", "periods"],
];

const useDealForm = () => useFormContext<DealFormInput, unknown, DealFormValues>();

function useError(name: FieldPath<DealFormInput>): string | undefined {
  const { getFieldState, formState } = useDealForm();
  return getFieldState(name, formState).error?.message;
}

function ErrorText({ id, children }: { id: string; children?: string }) {
  if (!children) return null;
  return (
    <p id={id} className="text-sm font-medium text-destructive">
      {children}
    </p>
  );
}

function StepHeading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <header className="space-y-2">
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      <p className="max-w-xl leading-relaxed text-muted-foreground">{children}</p>
    </header>
  );
}

/* ───────────────────────────── Step 1: the order ───────────────────────────── */

export function OrderStep() {
  const { register, setValue } = useDealForm();
  const [total, advancePct] = useWatch<DealFormInput, ["total", "advancePct"]>({
    name: ["total", "advancePct"],
  });
  const totalError = useError("total");
  const parsed = parseMusd(total);
  const split = parsed ? splitOrder(parsed, advancePct) : undefined;

  return (
    <div className="space-y-8">
      <StepHeading title="The order">
        How much the order is worth, and how much the supplier needs upfront to start production.
      </StepHeading>

      <div className="space-y-2">
        <label htmlFor="deal-total" className="text-sm font-semibold">
          Order value
        </label>
        <div className="relative max-w-sm">
          <Input
            id="deal-total"
            {...register("total")}
            inputMode="decimal"
            placeholder="10000"
            autoComplete="off"
            aria-invalid={totalError ? true : undefined}
            aria-describedby={totalError ? "deal-total-error" : undefined}
            className="h-14 pe-20 text-2xl font-semibold"
          />
          <span className="pointer-events-none absolute inset-y-0 end-4 flex items-center text-sm font-semibold text-muted-foreground">
            MUSD
          </span>
        </div>
        <ErrorText id="deal-total-error">{totalError}</ErrorText>
      </div>

      <div className="space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <label htmlFor="deal-advance-pct" className="text-sm font-semibold">
            Paid upfront for production
          </label>
          <span className="text-2xl font-semibold text-gold">{advancePct}%</span>
        </div>
        <input
          id="deal-advance-pct"
          type="range"
          min={5}
          max={95}
          step={5}
          {...register("advancePct", { valueAsNumber: true })}
          className="w-full accent-[var(--gold)]"
        />
        <div className="flex gap-2">
          {[20, 30, 50].map((pct) => (
            <button
              key={pct}
              type="button"
              aria-pressed={advancePct === pct}
              onClick={() => setValue("advancePct", pct, { shouldDirty: true })}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                advancePct === pct
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input hover:border-foreground/40",
              )}
            >
              {pct}%
            </button>
          ))}
        </div>

        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="flex h-2.5">
            <div className="bg-gold transition-[width]" style={{ width: `${advancePct}%` }} />
            <div className="flex-1 bg-navy-700" />
          </div>
          <div className="grid divide-y text-sm sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            <div className="space-y-1 p-4">
              <p className="flex items-center gap-2 font-semibold">
                <span className="size-2 rounded-full bg-gold" />
                Upfront · {split ? formatMusd(split.advance) : "—"}
              </p>
              <p className="text-muted-foreground">
                Goes to the supplier when you pay it. Protected by the BTC bond, not by escrow.
              </p>
            </div>
            <div className="space-y-1 p-4">
              <p className="flex items-center gap-2 font-semibold">
                <span className="size-2 rounded-full bg-navy-700" />
                In escrow · {split ? formatMusd(split.balance) : "—"}
              </p>
              <p className="text-muted-foreground">
                Held until shipment is signed and your time to object has passed.
              </p>
            </div>
          </div>
        </div>
      </div>

      <TermsDrop />
    </div>
  );
}

function TermsDrop() {
  const { setValue } = useDealForm();
  const [termsHash, fileName] = useWatch<DealFormInput, ["termsHash", "termsFileName"]>({
    name: ["termsHash", "termsFileName"],
  });
  const error = useError("termsHash");
  const [hashing, setHashing] = useState(false);
  const [over, setOver] = useState(false);
  const done = termsHash !== "" && !hashing;

  async function onFile(file: File | undefined) {
    if (!file) return;
    setHashing(true);
    try {
      setValue("termsHash", await hashFile(file), { shouldValidate: true });
      setValue("termsFileName", `${file.name} (${formatBytes(file.size)})`);
    } finally {
      setHashing(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">Terms document</p>
      <label
        htmlFor="deal-terms-file"
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void onFile(e.dataTransfer.files[0]);
        }}
        className={cn(
          "flex cursor-pointer items-center gap-4 rounded-xl border-2 border-dashed bg-card p-5 transition-colors has-[:focus-visible]:border-ring",
          over ? "border-gold" : "border-input hover:border-foreground/40",
          error && !done && "border-destructive/60",
          done && "border-solid border-success/50",
        )}
      >
        <input
          id="deal-terms-file"
          type="file"
          className="sr-only"
          aria-describedby="deal-terms-help"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        {done ? (
          <FileCheck2 aria-hidden className="size-8 shrink-0 text-success" />
        ) : (
          <FileUp aria-hidden className="size-8 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 text-sm">
          {hashing ? (
            <span className="font-semibold">Reading the file…</span>
          ) : done ? (
            <>
              <span className="block font-semibold break-all">{fileName}</span>
              <span className="block text-muted-foreground">
                Fingerprint {termsHash.slice(0, 10)}…{termsHash.slice(-6)} · click to replace
              </span>
            </>
          ) : (
            <>
              <span className="block font-semibold">
                Drop your contract, pro forma or purchase order
              </span>
              <span className="block text-muted-foreground">or click to choose a file</span>
            </>
          )}
        </span>
      </label>
      <p id="deal-terms-help" className="text-sm text-muted-foreground">
        The file never leaves your device. Only its fingerprint is stored with the deal, which
        proves later that this exact file was agreed. It says nothing about the goods themselves.
      </p>
      <ErrorText id="deal-terms-error">{error}</ErrorText>
    </div>
  );
}

/* ───────────────────────────── Step 2: people ───────────────────────────── */

function AddressInput({
  name,
  icon: Icon,
  title,
  description,
  action,
}: {
  name: "supplier" | "arbiter" | "inspector" | "carrier" | "bonder";
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  const { register } = useDealForm();
  const value = useWatch<DealFormInput, typeof name>({ name });
  const error = useError(name);
  const id = `deal-${name}`;
  const ok = !error && isAddress(value.trim());

  return (
    <div className="flex gap-4 rounded-xl border bg-card p-4 sm:p-5">
      <span className="hidden size-11 shrink-0 items-center justify-center rounded-lg bg-muted sm:flex">
        <Icon aria-hidden className="size-5 text-gold" />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4">
          <label htmlFor={id} className="font-semibold">
            {title}
          </label>
          {action}
        </div>
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {description}
        </p>
        <div className="relative">
          <Input
            id={id}
            {...register(name)}
            placeholder="0x… wallet address"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
            className="pe-10 font-mono text-[0.8rem]"
          />
          {ok && (
            <CircleCheck
              aria-label="Valid address"
              className="absolute inset-y-0 end-3 my-auto size-4 text-success"
            />
          )}
        </div>
        <ErrorText id={`${id}-error`}>{error}</ErrorText>
      </div>
    </div>
  );
}

export function PeopleStep({ buyer }: { buyer: Address }) {
  return (
    <div className="space-y-6">
      <StepHeading title="Who is involved">
        Each person is a wallet address. The supplier and the arbiter accept their role before any
        money moves.
      </StepHeading>
      <div className="flex items-center justify-between gap-4 rounded-xl bg-muted px-5 py-3 text-sm">
        <span className="font-semibold">You are the buyer</span>
        <span className="font-mono text-xs text-muted-foreground">
          {buyer.slice(0, 6)}…{buyer.slice(-4)}
        </span>
      </div>
      <div className="grid gap-4">
        <AddressInput
          name="supplier"
          icon={Factory}
          title="Supplier"
          description="The factory you are buying from. Receives the advance, and the balance on release."
        />
        <AddressInput
          name="inspector"
          icon={ClipboardCheck}
          title="Inspector"
          description="Signs that the goods are ready and pass inspection."
        />
        <AddressInput
          name="carrier"
          icon={Truck}
          title="Carrier"
          description="Signs that the goods have shipped."
        />
        <AddressInput
          name="arbiter"
          icon={Scale}
          title="Arbiter"
          description="Decides if you open a dispute. Must be neither you nor the supplier."
        />
      </div>
    </div>
  );
}

/* ───────────────────────────── Step 3: protection ───────────────────────────── */

function Choice({
  selected,
  onSelect,
  icon: Icon,
  title,
  badge,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: LucideIcon;
  title: string;
  badge?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex flex-col gap-3 rounded-xl border-2 bg-card p-5 text-start transition-colors",
        selected ? "border-primary" : "border-border hover:border-foreground/30",
      )}
    >
      <span className="flex items-center justify-between gap-3">
        <Icon
          aria-hidden
          className={cn("size-6", selected ? "text-gold" : "text-muted-foreground")}
        />
        {badge && <Badge>{badge}</Badge>}
      </span>
      <span className="font-semibold">{title}</span>
      <span className="text-sm leading-relaxed text-muted-foreground">{children}</span>
    </button>
  );
}

const RATIO_MIN = 120;
const RATIO_MAX = 300;

/**
 * Coverage slider whose track is the scale: amber below the top-up line, green above it.
 * Positions use the thumb-centre formula of `.scale-range` so labels sit exactly under the thumb.
 */
function CoverageSlider({ topUpBps }: { topUpBps: number }) {
  const { register } = useDealForm();
  const ratioPct = Number(useWatch<DealFormInput, "bondRatioPct">({ name: "bondRatioPct" }));
  const frac = (pct: number) =>
    Math.min(1, Math.max(0, (pct - RATIO_MIN) / (RATIO_MAX - RATIO_MIN)));
  const at = (pct: number) => `calc(${frac(pct)} * (100% - 22px) + 11px)`;

  return (
    <div className="relative pt-9 pb-6">
      <span
        aria-hidden
        className="absolute top-0 -translate-x-1/2 rounded-md bg-primary px-2 py-0.5 text-sm font-semibold text-primary-foreground"
        style={{ insetInlineStart: at(ratioPct) }}
      >
        {ratioPct}%
      </span>
      <input
        id="deal-bond-ratio"
        type="range"
        min={RATIO_MIN}
        max={RATIO_MAX}
        step={10}
        {...register("bondRatioPct")}
        aria-valuetext={`${ratioPct}% coverage`}
        className="scale-range"
        style={{ "--split": frac(topUpBps / 100) } as CSSProperties}
      />
      <span aria-hidden className="absolute bottom-0 start-0 text-xs text-muted-foreground">
        {RATIO_MIN}% minimum
      </span>
      <span aria-hidden className="absolute end-0 bottom-0 text-xs text-muted-foreground">
        {RATIO_MAX}%
      </span>
    </div>
  );
}

export function ProtectionStep({
  feeBps,
  topUpRatioBps,
  protectRatioBps,
}: {
  feeBps?: number;
  topUpRatioBps?: number;
  protectRatioBps?: number;
}) {
  const { setValue, getValues } = useDealForm();
  const [enabled, ratioPct, total, advancePct] = useWatch<
    DealFormInput,
    ["bondEnabled", "bondRatioPct", "total", "advancePct"]
  >({ name: ["bondEnabled", "bondRatioPct", "total", "advancePct"] });
  const ratioError = useError("bondRatioPct");
  const ratioBps = Number(ratioPct) * 100;
  const parsed = parseMusd(total);
  const advance = parsed ? splitOrder(parsed, advancePct).advance : undefined;
  const bondTarget =
    advance !== undefined && feeBps !== undefined && ratioBps > 0
      ? ((advance - feeOn(advance, feeBps)) * BigInt(ratioBps)) / 10_000n
      : undefined;

  return (
    <div className="space-y-6">
      <StepHeading title="Protect the advance">
        The advance leaves escrow the moment you pay it. A BTC bond is what can bring it back if the
        supplier does not deliver.
      </StepHeading>

      <div role="radiogroup" aria-label="Protection" className="grid gap-4 sm:grid-cols-2">
        <Choice
          selected={enabled}
          onSelect={() => setValue("bondEnabled", true)}
          icon={ShieldCheck}
          title="BTC bond"
          badge="Recommended"
        >
          The supplier or their sourcing agent locks BTC. If the supplier misses a deadline, it
          repays your advance in MUSD.
        </Choice>
        <Choice
          selected={!enabled}
          onSelect={() => setValue("bondEnabled", false)}
          icon={ShieldOff}
          title="No bond"
        >
          Once paid, the advance is the supplier's and nothing on-chain can get it back. Only the
          balance stays in escrow.
        </Choice>
      </div>

      {enabled && (
        <div className="space-y-4">
          <AddressInput
            name="bonder"
            icon={ShieldCheck}
            title="Who posts the BTC"
            description="The supplier, or a sourcing agent who vouches for them."
            action={
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto px-0"
                onClick={() => setValue("bonder", getValues("supplier"), { shouldValidate: true })}
              >
                Same as supplier
              </Button>
            }
          />

          <div className="space-y-4 rounded-xl border bg-card p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <label htmlFor="deal-bond-ratio" className="font-semibold">
                Required coverage
              </label>
              <span className="text-sm text-muted-foreground">
                {bondTarget !== undefined ? (
                  <>
                    BTC worth at least{" "}
                    <strong className="text-foreground">{formatMusd(bondTarget)}</strong>
                  </>
                ) : (
                  "Enter the order value to see the amount"
                )}
              </span>
            </div>
            {topUpRatioBps !== undefined && protectRatioBps !== undefined && (
              <>
                <CoverageSlider topUpBps={topUpRatioBps} />
                <ul className="space-y-1.5 text-sm leading-relaxed text-muted-foreground">
                  <li className="flex items-baseline gap-2">
                    <span className="size-2 shrink-0 rounded-full bg-warning" />
                    Below {percent(topUpRatioBps)}, the bonder is asked to add BTC.
                  </li>
                  <li className="flex items-baseline gap-2">
                    <span className="size-2 shrink-0 rounded-full bg-destructive" />
                    Below {percent(protectRatioBps)}, anyone can convert the bond to MUSD to hold
                    its value.
                  </li>
                  <li className="flex items-baseline gap-2">
                    <span className="size-2 shrink-0 rounded-full bg-foreground/30" />
                    In a fast crash the bond can still fall short of the advance. BTC-secured, with
                    limits.
                  </li>
                </ul>
              </>
            )}
            <ErrorText id="deal-bond-ratio-error">{ratioError}</ErrorText>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── Step 4: deadlines ───────────────────────────── */

function PeriodEditor({ name, label }: { name: PeriodKey; label: string }) {
  const { register } = useDealForm();
  const error = useError(`periods.${name}.value`);
  return (
    <span className="flex gap-2">
      <Input
        aria-label={`${label}: amount`}
        {...register(`periods.${name}.value`)}
        inputMode="numeric"
        aria-invalid={error ? true : undefined}
        className="h-8 w-20"
      />
      <select
        aria-label={`${label}: unit`}
        {...register(`periods.${name}.unit`)}
        className="h-8 rounded-md border border-input bg-card px-2 text-sm"
      >
        <option value="minutes">minutes</option>
        <option value="hours">hours</option>
        <option value="days">days</option>
      </select>
    </span>
  );
}

export function DeadlinesStep() {
  const { setValue, getFieldState, formState } = useDealForm();
  const [timeline, periods] = useWatch<DealFormInput, ["timeline", "periods"]>({
    name: ["timeline", "periods"],
  });
  const custom = timeline === "custom";
  const presets: { key: TimelinePreset; label: string; description: string }[] = [
    { key: "standard", ...TIMELINES.standard },
    { key: "demo", ...TIMELINES.demo },
    { key: "custom", label: "Custom", description: "Set each deadline yourself" },
  ];
  const errorOf = (key: PeriodKey) =>
    getFieldState(`periods.${key}.value`, formState).error?.message;

  function choose(key: TimelinePreset) {
    setValue("timeline", key);
    if (key !== "custom") setValue("periods", TIMELINES[key].periods, { shouldValidate: true });
  }

  return (
    <div className="space-y-6">
      <StepHeading title="Deadlines">
        Each deadline starts when the previous step happens. If one is missed, the other side can
        claim, so leave room for real delays.
      </StepHeading>

      <div role="radiogroup" aria-label="Deadline preset" className="grid gap-3 sm:grid-cols-3">
        {presets.map((p) => (
          <button
            key={p.key}
            type="button"
            role="radio"
            aria-checked={timeline === p.key}
            onClick={() => choose(p.key)}
            className={cn(
              "rounded-xl border-2 bg-card px-4 py-3 text-start transition-colors",
              timeline === p.key ? "border-primary" : "border-border hover:border-foreground/30",
            )}
          >
            <span className="block font-semibold">{p.label}</span>
            <span className="block text-xs text-muted-foreground">{p.description}</span>
          </button>
        ))}
      </div>
      {timeline === "demo" && (
        <p className="rounded-lg bg-warning/15 px-4 py-2.5 text-sm">
          Fast demo deadlines are minutes long: fine for trying Wasit on testnet, far too short for
          a real order.
        </p>
      )}

      <ol className="rounded-xl border bg-card p-5">
        <li className="flex items-center gap-3 pb-1">
          <span className="size-3 shrink-0 rounded-full bg-gold" />
          <span className="text-sm font-semibold">You pay the advance</span>
        </li>
        {PERIODS.slice(0, 4).map(({ key, label, until, hint }) => {
          const error = errorOf(key);
          return (
            <li key={key}>
              <div className="ms-[5px] space-y-1.5 border-s-2 border-dashed border-input py-3 ps-6">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  {custom ? (
                    <PeriodEditor name={key} label={label} />
                  ) : (
                    <span className="rounded-full bg-muted px-2.5 py-0.5 text-sm font-semibold">
                      {formatDuration(periodSeconds(periods[key]))}
                    </span>
                  )}
                  <span className="text-sm">{label}</span>
                </div>
                <p className="text-xs text-muted-foreground">{hint}</p>
                {error && <p className="text-xs font-medium text-destructive">{error}</p>}
              </div>
              <div className="flex items-center gap-3 pt-1 pb-1">
                <span className="size-3 shrink-0 rounded-full border-2 border-primary bg-card" />
                <span className="text-sm font-semibold">{until}</span>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 rounded-xl bg-muted px-5 py-3 text-sm">
        <Scale aria-hidden className="size-4 text-gold" />
        <span>If you open a dispute, the arbiter has</span>
        {custom ? (
          <PeriodEditor name="arbitration" label="Arbiter's time to decide" />
        ) : (
          <strong>{formatDuration(periodSeconds(periods.arbitration))}</strong>
        )}
        <span>to decide.</span>
        {errorOf("arbitration") && (
          <span className="w-full text-xs font-medium text-destructive">
            {errorOf("arbitration")}
          </span>
        )}
      </div>
    </div>
  );
}
