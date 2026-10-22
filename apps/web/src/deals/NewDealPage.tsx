import { zodResolver } from "@hookform/resolvers/zod";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useQueryClient } from "@tanstack/react-query";
import { wasitEscrowAbi, type DealTerms } from "@wasit/sdk";
import { ArrowLeft, ArrowRight, CircleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { Link, useLocation } from "react-router";
import { parseEventLogs, parseUnits } from "viem";
import { useAccount } from "wagmi";
import { TxStatusPanel } from "@/components/TxStatusPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDeployment } from "@/deployment";
import { MUSD_DECIMALS } from "@/lib/format";
import { useContractTx } from "@/lib/useContractTx";
import {
  AmountsSection,
  BondSection,
  DeadlinesSection,
  PartiesSection,
  TermsSection,
} from "./DealForm";
import { DealReview, MoneySummary } from "./DealReview";
import {
  DEFAULT_VALUES,
  dealFormSchema,
  toDealTerms,
  type DealFormInput,
  type DealFormValues,
} from "./terms";
import { useEscrowConfig } from "./useEscrowConfig";

const toAmount = (v: string) =>
  /^\d+(\.\d{1,18})?$/.test(v.trim()) ? parseUnits(v.trim(), MUSD_DECIMALS) : 0n;

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm leading-relaxed"
    >
      <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
      <span>{children}</span>
    </p>
  );
}

/** Live money summary beside the form; zero for fields that are not valid amounts yet. */
function LiveSummary({ feeBps }: { feeBps: number }) {
  const [advance, balance, bondEnabled, bondRatioPct] = useWatch<DealFormInput>({
    name: ["advance", "balance", "bondEnabled", "bondRatioPct"],
  }) as [string, string, boolean, string];
  const ratio = /^\d+$/.test(bondRatioPct) ? Number(bondRatioPct) * 100 : 0;
  return (
    <MoneySummary
      terms={{
        advanceAmount: toAmount(advance),
        balanceAmount: toAmount(balance),
        feeBps,
        bondRatioBps: ratio,
      }}
      hasBond={bondEnabled}
    />
  );
}

/**
 * `/deals/new`: the buyer fills the terms, reviews exactly what will be stored, then signs
 * `createDeal`. Creating moves no money; funding happens on the deal page once the supplier has
 * accepted (the escrow only takes the advance in the Accepted state).
 */
export function NewDealPage() {
  const { address, isConnected } = useAccount();
  const deployment = useDeployment();
  const { search } = useLocation();
  const config = useEscrowConfig();
  const queryClient = useQueryClient();
  const tx = useContractTx();
  const [review, setReview] = useState<{ terms: DealTerms; fileName: string } | undefined>();

  const schema = useMemo(() => dealFormSchema(address), [address]);
  const form = useForm<DealFormInput, unknown, DealFormValues>({
    resolver: zodResolver(schema),
    defaultValues: DEFAULT_VALUES,
    mode: "onTouched",
  });

  if (!isConnected || !address)
    return (
      <div className="mx-auto max-w-lg space-y-5 py-10 text-center">
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

  const onValid = (values: DealFormValues) => {
    if (!config.data) return;
    const terms = toDealTerms(values, {
      buyer: address,
      token: deployment.musd,
      feeBps: config.data.feeBps,
    });
    setReview({ terms, fileName: values.termsFileName });
    tx.reset();
    window.scrollTo({ top: 0 });
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

        <DealReview terms={review.terms} termsFileName={review.fileName} />

        <Card>
          <CardHeader>
            <CardTitle>What happens next</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-1.5 ps-5 text-sm leading-relaxed text-foreground/85">
              <li>Creating the deal records these terms. No MUSD moves yet.</li>
              <li>The supplier accepts the deal and the arbiter accepts the role.</li>
              {review.terms.bondRatioBps > 0 && (
                <li>The bonder posts the BTC bond at the required coverage.</li>
              )}
              <li>You fund the advance from the deal page. It goes straight to the supplier.</li>
            </ol>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <TxStatusPanel
            status={tx.status}
            confirmed={
              createdId !== undefined && (
                <p>
                  Deal <strong>#{createdId.toString()}</strong> is created. Share its page with the
                  supplier so they can accept.
                </p>
              )
            }
          />
          <div className="flex flex-wrap gap-3">
            {done ? (
              createdId !== undefined && (
                <Button asChild size="lg">
                  <Link to={`/deals/${createdId}${search}`}>
                    Open deal #{createdId.toString()} <ArrowRight />
                  </Link>
                </Button>
              )
            ) : (
              <>
                <Button
                  variant="outline"
                  size="lg"
                  disabled={busy}
                  onClick={() => setReview(undefined)}
                >
                  <ArrowLeft /> Edit terms
                </Button>
                <Button size="lg" disabled={busy || !!blocked} onClick={() => void create()}>
                  {tx.status.phase === "failed" ? "Try again" : "Create deal"}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <FormProvider {...form}>
      <form onSubmit={(e) => void form.handleSubmit(onValid)(e)} noValidate className="space-y-8">
        <header className="space-y-2">
          <p className="eyebrow">New deal</p>
          <h1 className="text-3xl font-semibold tracking-tight">Protect a production advance</h1>
          <p className="max-w-2xl text-muted-foreground">
            Set the parties, amounts, bond and deadlines. You will review everything before signing.
          </p>
        </header>

        {blocked && <Notice>{blocked}</Notice>}
        {config.isError && (
          <Notice>
            Could not read the escrow settings from Mezo testnet. Check your connection and reload.
          </Notice>
        )}

        <div className="grid items-start gap-8 lg:grid-cols-[1fr_22rem]">
          <div className="min-w-0 space-y-6">
            <PartiesSection />
            <AmountsSection />
            <BondSection
              topUpRatioBps={config.data?.topUpRatioBps}
              protectRatioBps={config.data?.protectRatioBps}
            />
            <DeadlinesSection />
            <TermsSection />
          </div>

          <aside className="space-y-4 lg:sticky lg:top-24">
            <Card>
              <CardHeader>
                <CardTitle>Where the money goes</CardTitle>
              </CardHeader>
              <CardContent>
                {config.data ? (
                  <LiveSummary feeBps={config.data.feeBps} />
                ) : (
                  <p className="text-sm text-muted-foreground">Reading the escrow's fee…</p>
                )}
              </CardContent>
            </Card>
            <Button type="submit" size="lg" className="w-full" disabled={!config.data || !!blocked}>
              Review deal <ArrowRight />
            </Button>
            {Object.keys(form.formState.errors).length > 0 && (
              <p role="alert" className="text-center text-sm text-destructive">
                Some fields need attention.
              </p>
            )}
          </aside>
        </div>
      </form>
    </FormProvider>
  );
}
