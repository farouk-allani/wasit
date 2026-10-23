import { zodResolver } from "@hookform/resolvers/zod";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useQueryClient } from "@tanstack/react-query";
import { wasitEscrowAbi, type DealTerms } from "@wasit/sdk";
import { ArrowLeft, ArrowRight, Check, CircleAlert } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { Link, useLocation } from "react-router";
import { isAddress, parseEventLogs } from "viem";
import { useAccount } from "wagmi";
import { TxStatusPanel } from "@/components/TxStatusPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDeployment } from "@/deployment";
import { formatDuration, formatMusd } from "@/lib/format";
import { useContractTx } from "@/lib/useContractTx";
import { cn } from "@/lib/utils";
import { DealReview } from "./DealReview";
import { DeadlinesStep, OrderStep, PeopleStep, ProtectionStep, STEP_FIELDS } from "./DealSteps";
import {
  DEFAULT_VALUES,
  dealFormSchema,
  parseMusd,
  PERIODS,
  periodSeconds,
  splitOrder,
  TIMELINES,
  toDealTerms,
  type DealFormInput,
  type DealFormValues,
} from "./terms";
import { useEscrowConfig } from "./useEscrowConfig";

const STEPS = ["Order", "People", "Protection", "Deadlines"] as const;

function Notice({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="flex gap-3 rounded-xl border border-warning/50 bg-warning/10 p-4 text-sm leading-relaxed"
    >
      <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
      <span>{children}</span>
    </p>
  );
}

/** Progress rail: finished steps are links back, later steps unlock as you go. */
function Stepper({
  step,
  reached,
  onJump,
}: {
  step: number;
  reached: number;
  onJump: (i: number) => void;
}) {
  return (
    <nav aria-label="Progress">
      <p className="mb-3 text-sm text-muted-foreground sm:hidden">
        Step {step + 1} of {STEPS.length} ·{" "}
        <strong className="text-foreground">{STEPS[step]}</strong>
      </p>
      <ol className="flex items-center gap-2">
        {STEPS.map((label, i) => {
          const done = i < step;
          const current = i === step;
          return (
            <li key={label} className="flex flex-1 items-center gap-2 last:flex-none">
              <button
                type="button"
                disabled={i > reached}
                onClick={() => onJump(i)}
                aria-current={current ? "step" : undefined}
                className="group flex items-center gap-2.5 disabled:cursor-not-allowed"
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors",
                    done && "border-gold bg-gold text-white",
                    current && "border-primary bg-primary text-primary-foreground",
                    !done && !current && "border-input text-muted-foreground",
                  )}
                >
                  {done ? <Check aria-hidden className="size-4" /> : i + 1}
                </span>
                <span
                  className={cn(
                    "hidden text-sm font-semibold sm:inline",
                    !current && "text-muted-foreground group-enabled:group-hover:text-foreground",
                  )}
                >
                  {label}
                </span>
              </button>
              {i < STEPS.length - 1 && (
                <span
                  aria-hidden
                  className={cn("h-0.5 flex-1 rounded-full", done ? "bg-gold" : "bg-input")}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function SheetRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-end font-semibold">{children}</dd>
    </div>
  );
}

const dash = <span className="font-normal text-muted-foreground">—</span>;

/** The deal so far, filled in as the buyer goes through the steps. */
function LiveSheet() {
  const v = useWatch<DealFormInput>() as DealFormInput;
  const total = parseMusd(v.total);
  const split = total ? splitOrder(total, v.advancePct) : undefined;
  const roles = [v.supplier, v.inspector, v.carrier, v.arbiter].filter((a) =>
    isAddress(a.trim()),
  ).length;
  const toRelease = PERIODS.slice(0, 4).reduce((s, p) => s + periodSeconds(v.periods[p.key]), 0);
  const preset = v.timeline === "custom" ? "Custom" : TIMELINES[v.timeline].label;

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle>Deal sheet</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="divide-y">
          <SheetRow label="Order">{total ? formatMusd(total) : dash}</SheetRow>
          <SheetRow label={`Upfront (${v.advancePct}%)`}>
            {split ? formatMusd(split.advance) : dash}
          </SheetRow>
          <SheetRow label="In escrow">{split ? formatMusd(split.balance) : dash}</SheetRow>
          <SheetRow label="People">{roles ? `${roles} of 4 set` : dash}</SheetRow>
          <SheetRow label="Protection">
            {v.bondEnabled ? `BTC bond, ${v.bondRatioPct}%` : "None"}
          </SheetRow>
          <SheetRow label="Deadlines">
            {Number.isFinite(toRelease) && toRelease > 0 ? (
              <>
                {preset}
                <span className="block text-xs font-normal text-muted-foreground">
                  ~{formatDuration(toRelease)} from advance to release
                </span>
              </>
            ) : (
              dash
            )}
          </SheetRow>
          <SheetRow label="Terms file">
            {v.termsHash ? <span className="wrap-anywhere">{v.termsFileName}</span> : dash}
          </SheetRow>
        </dl>
      </CardContent>
    </Card>
  );
}

/**
 * `/deals/new`: four short steps (order, people, protection, deadlines), a review of exactly
 * what will be stored, then `createDeal`. Creating moves no money; funding happens on the deal
 * page once the supplier has accepted (ADR-028).
 */
export function NewDealPage() {
  const { address, isConnected } = useAccount();
  const deployment = useDeployment();
  const { search } = useLocation();
  const config = useEscrowConfig();
  const queryClient = useQueryClient();
  const tx = useContractTx();
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const [review, setReview] = useState<{ terms: DealTerms; fileName: string } | undefined>();

  const schema = useMemo(() => dealFormSchema(address), [address]);
  const form = useForm<DealFormInput, unknown, DealFormValues>({
    resolver: zodResolver(schema),
    defaultValues: DEFAULT_VALUES,
    mode: "onTouched",
  });

  if (!isConnected || !address)
    return (
      <div className="mx-auto max-w-lg space-y-5 py-16 text-center">
        <p className="eyebrow">New deal</p>
        <h1 className="text-3xl font-semibold tracking-tight">Connect the buyer's wallet</h1>
        <p className="text-muted-foreground">
          The wallet you connect becomes the buyer of the deal and signs its creation. Nothing is
          paid at this step.
        </p>
        <div className="flex justify-center">
          <ConnectButton />
        </div>
      </div>
    );

  const blocked = config.data?.paused
    ? "New deals are paused by the operator right now. Open deals and their exits are not affected."
    : config.data && !config.data.musdAllowed
      ? "This escrow does not accept MUSD, so a deal cannot be created on it."
      : undefined;

  const go = (i: number) => {
    setStep(i);
    setReached((r) => Math.max(r, i));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const next = async () => {
    if (!(await form.trigger(STEP_FIELDS[step], { shouldFocus: true }))) return;
    if (step < STEPS.length - 1) return go(step + 1);
    await form.handleSubmit((values) => {
      if (!config.data) return;
      const terms = toDealTerms(values, {
        buyer: address,
        token: deployment.musd,
        feeBps: config.data.feeBps,
      });
      setReview({ terms, fileName: values.termsFileName });
      tx.reset();
      window.scrollTo({ top: 0 });
    })();
  };

  const create = async () => {
    if (!review) return;
    const receipt = await tx.send({
      address: deployment.escrow,
      abi: wasitEscrowAbi,
      functionName: "createDeal",
      args: [review.terms],
    });
    if (receipt) void queryClient.invalidateQueries({ queryKey: ["deals", deployment.name] });
  };

  const createdId =
    tx.status.phase === "confirmed"
      ? parseEventLogs({
          abi: wasitEscrowAbi,
          eventName: "DealCreated",
          logs: tx.status.receipt.logs,
        })[0]?.args.dealId
      : undefined;

  if (review) {
    const busy =
      tx.status.phase === "checking" ||
      tx.status.phase === "signing" ||
      tx.status.phase === "pending";
    const done = tx.status.phase === "confirmed";
    return (
      <div className="space-y-8">
        <header className="space-y-2">
          <p className="eyebrow">Review</p>
          <h1 className="text-3xl font-semibold tracking-tight">Check the deal before you sign</h1>
          <p className="max-w-2xl text-muted-foreground">
            These terms are fixed once the deal is created. Nobody, including the operator, can
            change them later.
          </p>
        </header>

        {blocked && <Notice>{blocked}</Notice>}

        <div className="grid items-start gap-8 lg:grid-cols-[1fr_22rem]">
          <DealReview terms={review.terms} termsFileName={review.fileName} />

          <aside className="lg:sticky lg:top-24">
            <Card className="gap-5">
              <CardHeader>
                <CardTitle>{done ? "Deal created" : "Sign to create the deal"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {!done && (
                  <ol className="space-y-2 text-sm leading-relaxed">
                    {[
                      "Signing records these terms. No MUSD moves yet.",
                      "The supplier accepts, and the arbiter accepts the role.",
                      ...(review.terms.bondRatioBps > 0
                        ? ["The BTC bond is posted at the required coverage."]
                        : []),
                      "You pay the advance from the deal page.",
                    ].map((text, i) => (
                      <li key={text} className="flex gap-3">
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                          {i + 1}
                        </span>
                        {text}
                      </li>
                    ))}
                  </ol>
                )}
                <TxStatusPanel
                  status={tx.status}
                  confirmed={
                    createdId !== undefined && (
                      <p>
                        Deal <strong>#{createdId.toString()}</strong> is created. Share its page
                        with the supplier so they can accept.
                      </p>
                    )
                  }
                />
                {done ? (
                  createdId !== undefined && (
                    <Button asChild size="lg" className="w-full">
                      <Link to={`/deals/${createdId}${search}`}>
                        Open deal #{createdId.toString()} <ArrowRight />
                      </Link>
                    </Button>
                  )
                ) : (
                  <div className="space-y-2">
                    <Button
                      size="lg"
                      className="w-full"
                      disabled={busy || !!blocked}
                      onClick={() => void create()}
                    >
                      {tx.status.phase === "failed" ? "Try again" : "Create deal"}
                    </Button>
                    <Button
                      variant="ghost"
                      className="w-full"
                      disabled={busy}
                      onClick={() => setReview(undefined)}
                    >
                      <ArrowLeft /> Back to edit
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    );
  }

  return (
    <FormProvider {...form}>
      <div className="space-y-8">
        <header className="space-y-2">
          <p className="eyebrow">New deal</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Protect a production advance
          </h1>
        </header>

        <Stepper step={step} reached={reached} onJump={go} />

        {blocked && <Notice>{blocked}</Notice>}
        {config.isError && (
          <Notice>
            Could not read the escrow settings from Mezo testnet. Check your connection and reload.
          </Notice>
        )}

        <div className="grid items-start gap-8 lg:grid-cols-[1fr_20rem]">
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void next();
            }}
            className="min-w-0 space-y-8"
          >
            {step === 0 && <OrderStep />}
            {step === 1 && <PeopleStep buyer={address} />}
            {step === 2 && (
              <ProtectionStep
                feeBps={config.data?.feeBps}
                topUpRatioBps={config.data?.topUpRatioBps}
                protectRatioBps={config.data?.protectRatioBps}
              />
            )}
            {step === 3 && <DeadlinesStep />}

            <div className="flex items-center justify-between gap-3 border-t pt-6">
              {step > 0 ? (
                <Button type="button" variant="ghost" onClick={() => go(step - 1)}>
                  <ArrowLeft /> Back
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" size="lg" disabled={!config.data || !!blocked}>
                {step < STEPS.length - 1 ? "Continue" : "Review deal"} <ArrowRight />
              </Button>
            </div>
          </form>

          <aside className="lg:sticky lg:top-24">
            <LiveSheet />
          </aside>
        </div>
      </div>
    </FormProvider>
  );
}
