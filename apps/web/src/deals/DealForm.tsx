import { FileCheck2, ShieldAlert, Upload } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useFormContext, type FieldError } from "react-hook-form";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { percent } from "@/landing/params";
import { cn } from "@/lib/utils";
import { hashFile, PERIODS, type DealFormInput, type DealFormValues } from "./terms";

type Values = DealFormInput;

function Section({
  step,
  title,
  description,
  children,
}: {
  step: number;
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <p className="eyebrow">Step {step}</p>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription className="leading-relaxed">{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 sm:grid-cols-2">{children}</CardContent>
    </Card>
  );
}

function AddressField({ name, label, hint }: { name: keyof Values; label: string; hint: string }) {
  const { register, formState } = useFormContext<Values, unknown, DealFormValues>();
  const error = formState.errors[name] as FieldError | undefined;
  return (
    <Field id={`deal-${name}`} label={label} hint={hint} error={error?.message}>
      {(aria) => (
        <Input
          {...aria}
          {...register(name)}
          placeholder="0x…"
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
        />
      )}
    </Field>
  );
}

function AmountField({
  name,
  label,
  hint,
}: {
  name: "advance" | "balance";
  label: string;
  hint: string;
}) {
  const { register, formState } = useFormContext<Values, unknown, DealFormValues>();
  return (
    <Field id={`deal-${name}`} label={label} hint={hint} error={formState.errors[name]?.message}>
      {(aria) => (
        <div className="relative">
          <Input
            {...aria}
            {...register(name)}
            inputMode="decimal"
            placeholder="0.00"
            className="pe-16"
          />
          <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs font-semibold text-muted-foreground">
            MUSD
          </span>
        </div>
      )}
    </Field>
  );
}

export function PartiesSection() {
  return (
    <Section
      step={1}
      title="Who is in this deal"
      description="You are the buyer (your connected wallet). Each role below is a wallet address. The supplier and arbiter accept their roles before any money moves."
    >
      <AddressField
        name="supplier"
        label="Supplier"
        hint="Receives the advance and, on release, the balance."
      />
      <AddressField
        name="arbiter"
        label="Arbiter"
        hint="Decides disputes. Cannot be you or the supplier."
      />
      <AddressField
        name="inspector"
        label="Inspector"
        hint="Signs that goods are ready and inspected."
      />
      <AddressField name="carrier" label="Carrier" hint="Signs that goods have shipped." />
    </Section>
  );
}

export function AmountsSection() {
  return (
    <Section
      step={2}
      title="How much, and when it moves"
      description="The advance goes straight to the supplier when you fund it, for production. The balance waits in escrow until delivery is attested and the challenge window ends."
    >
      <AmountField
        name="advance"
        label="Production advance"
        hint="Paid to the supplier when you fund it."
      />
      <AmountField name="balance" label="Balance" hint="Held in escrow, released after shipment." />
    </Section>
  );
}

export function BondSection({
  topUpRatioBps,
  protectRatioBps,
}: {
  topUpRatioBps?: number;
  protectRatioBps?: number;
}) {
  const { register, watch, formState } = useFormContext<Values, unknown, DealFormValues>();
  const enabled = watch("bondEnabled");
  const ratio = Number(watch("bondRatioPct")) * 100;
  const belowWarning = enabled && topUpRatioBps !== undefined && ratio > 0 && ratio < topUpRatioBps;

  return (
    <Section
      step={3}
      title="BTC bond behind the advance"
      description="The advance leaves escrow the moment you fund it, so the bond is what protects it. The supplier or their agent posts BTC; if the supplier defaults, the bond pays your advance back."
    >
      <label className="flex cursor-pointer items-start gap-3 sm:col-span-2">
        <input
          type="checkbox"
          {...register("bondEnabled")}
          className="mt-0.5 size-4 accent-[var(--gold-400)]"
        />
        <span className="text-sm">
          <span className="font-medium">Require a BTC bond</span>
          <span className="block text-muted-foreground">
            The deal cannot be funded until the bond is posted at the required coverage.
          </span>
        </span>
      </label>

      {enabled ? (
        <>
          <AddressField
            name="bonder"
            label="Bonder"
            hint="Posts the BTC: the supplier or their sourcing agent."
          />
          <Field
            id="deal-bondRatioPct"
            label="Required coverage"
            hint="BTC value as a share of the net advance, at the time it is posted."
            error={formState.errors.bondRatioPct?.message}
          >
            {(aria) => (
              <div className="relative">
                <Input
                  {...aria}
                  {...register("bondRatioPct")}
                  inputMode="numeric"
                  className="pe-10"
                />
                <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs font-semibold text-muted-foreground">
                  %
                </span>
              </div>
            )}
          </Field>
          {topUpRatioBps !== undefined && protectRatioBps !== undefined && (
            <p className="rounded-lg border bg-navy-950/30 p-4 text-sm leading-relaxed text-foreground/85 sm:col-span-2">
              If BTC falls and coverage drops below <strong>{percent(topUpRatioBps)}</strong>, the
              bonder is asked to top up. Below <strong>{percent(protectRatioBps)}</strong>, anyone
              can convert the bond to MUSD to hold its value. In a fast crash the bond can still
              fall short of the advance: BTC-secured, with limits.
              {belowWarning && (
                <span className="mt-2 block font-medium text-warning">
                  This coverage starts below the {percent(topUpRatioBps)} top-up line, so the bonder
                  will be asked to top up from day one.
                </span>
              )}
            </p>
          )}
        </>
      ) : (
        <p
          role="note"
          className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm leading-relaxed sm:col-span-2"
        >
          <ShieldAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
          Without a bond, the advance goes straight to the supplier and nothing on-chain can get it
          back. Only the balance stays protected in escrow.
        </p>
      )}
    </Section>
  );
}

export function DeadlinesSection() {
  const { register, formState } = useFormContext<Values, unknown, DealFormValues>();
  return (
    <Section
      step={4}
      title="Deadlines"
      description="Each period starts when the previous step happens. Missing one lets the other side claim a default, so leave room for real delays."
    >
      {PERIODS.map(({ key, label, hint }) => (
        <Field
          key={key}
          id={`deal-period-${key}`}
          label={label}
          hint={hint}
          error={formState.errors.periods?.[key]?.value?.message}
        >
          {(aria) => (
            <div className="flex gap-2">
              <Input
                {...aria}
                {...register(`periods.${key}.value`)}
                inputMode="numeric"
                className="w-24"
              />
              <select
                aria-label={`${label} unit`}
                {...register(`periods.${key}.unit`)}
                className="h-10 flex-1 rounded-md border border-input bg-navy-950/40 px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
              >
                <option value="minutes">minutes</option>
                <option value="hours">hours</option>
                <option value="days">days</option>
              </select>
            </div>
          )}
        </Field>
      ))}
    </Section>
  );
}

export function TermsSection() {
  const { register, setValue, watch, formState } = useFormContext<
    Values,
    unknown,
    DealFormValues
  >();
  const [hashing, setHashing] = useState(false);
  const termsHash = watch("termsHash");
  const fileName = watch("termsFileName");

  async function onFile(file: File | undefined) {
    if (!file) return;
    setHashing(true);
    try {
      setValue("termsHash", await hashFile(file), { shouldValidate: true });
      setValue("termsFileName", `${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
    } finally {
      setHashing(false);
    }
  }

  return (
    <Section
      step={5}
      title="Terms document"
      description="Your contract, pro forma invoice or purchase order. The file stays on your device: only its keccak256 fingerprint is recorded with the deal."
    >
      <input type="hidden" {...register("termsHash")} />
      <Field
        id="deal-terms-file"
        label="Terms file"
        className="sm:col-span-2"
        hint="Keep the original. The fingerprint proves this exact file was agreed and not altered later. It does not prove anything about the goods themselves."
        error={formState.errors.termsHash?.message}
      >
        {(aria) => (
          // Native picker hidden: its button text follows the browser language
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <input
              {...aria}
              type="file"
              disabled={hashing}
              onChange={(e) => void onFile(e.target.files?.[0])}
              className="peer sr-only"
            />
            <label
              htmlFor={aria.id}
              className={cn(
                buttonVariants({ variant: "outline" }),
                "cursor-pointer peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/40 peer-disabled:opacity-50",
              )}
            >
              <Upload aria-hidden />
              {termsHash ? "Choose another file" : "Choose file"}
            </label>
            <span className="text-sm text-muted-foreground">
              {hashing ? "Computing fingerprint…" : fileName || "No file chosen"}
            </span>
          </div>
        )}
      </Field>
      {termsHash && !hashing && (
        <p className="flex min-w-0 gap-3 rounded-lg border bg-navy-950/30 p-4 text-sm sm:col-span-2">
          <FileCheck2 aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
          <span className="min-w-0">
            <span className="block font-medium">{fileName}</span>
            <span className="block font-mono text-xs break-all text-muted-foreground">
              {termsHash}
            </span>
          </span>
        </p>
      )}
    </Section>
  );
}
