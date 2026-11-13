import { DealState } from "@wasit/sdk";
import { LoaderCircle, Wallet } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { isAddressEqual, type Address } from "viem";
import { useAccount } from "wagmi";
import { expectedAttestation } from "@/attest/attestation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useDealLive } from "@/deals/useDealLive";
import { formatMusd } from "@/lib/format";
import { usePilotWallet } from "./usePilotWallet";

const ROLES = ["inspector", "carrier", "buyer", "supplier", "arbiter", "bonder"] as const;
type Role = (typeof ROLES)[number];
const isRole = (r: string | undefined): r is Role => ROLES.includes(r as Role);

const NAME: Record<Role, string> = {
  inspector: "inspector",
  carrier: "carrier",
  buyer: "buyer",
  supplier: "supplier",
  arbiter: "arbiter",
  bonder: "bond poster",
};

/** What the person is asked to do, and what it proves; plain words (PLAN 9.2). */
const ASK: Record<Role, { ask: string; proves: string; signs: boolean }> = {
  inspector: {
    ask: "confirm that the goods for this order are ready and inspected.",
    proves: "that the wallet this deal names as inspector signed that statement, for this deal.",
    signs: true,
  },
  carrier: {
    ask: "confirm that the goods have been handed over for shipment.",
    proves: "that the wallet this deal names as carrier signed that statement, for this deal.",
    signs: true,
  },
  buyer: {
    ask: "pay the advance of this test order, and later its balance, in test MUSD.",
    proves: "that the buyer's wallet paid, on the test network.",
    signs: false,
  },
  supplier: {
    ask: "accept the terms of this test order.",
    proves: "that the wallet this deal names as supplier accepted the terms.",
    signs: false,
  },
  arbiter: {
    ask: "accept the role of arbiter, who decides if buyer and supplier disagree.",
    proves: "that the wallet this deal names as arbiter accepted the role.",
    signs: false,
  },
  bonder: {
    ask: "lock test BTC as a bond behind the supplier's advance.",
    proves: "that this wallet posted the bond, on the test network.",
    signs: false,
  },
};

function Shell({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-lg space-y-6">{children}</div>;
}

/**
 * `/invite/:dealId/:role`: the one screen an invited person reads. It says who invited them, which
 * order, what they confirm and what that does and does not prove, then one button that opens the
 * test wallet (or their own) and takes them to their step.
 */
export function InvitePage() {
  const { id: raw, role } = useParams();
  const { search } = useLocation();
  const navigate = useNavigate();
  const from = new URLSearchParams(search).get("from")?.slice(0, 40);
  const id = raw && /^\d+$/.test(raw) ? BigInt(raw) : undefined;
  const live = useDealLive(id);
  const { address } = useAccount();
  const pilot = usePilotWallet();
  const [error, setError] = useState<ReactNode>();

  if (id === undefined || !isRole(role) || live.isError || (live.data && !live.data.found))
    return (
      <Shell>
        <h1 className="text-2xl font-semibold">This invite link does not work</h1>
        <p className="text-muted-foreground">
          Ask the person who sent it for a new one. If Mezo testnet did not answer, reload.
        </p>
      </Shell>
    );
  if (!live.data)
    return (
      <Shell>
        <LoaderCircle aria-hidden className="mx-auto size-6 animate-spin text-gold" />
      </Shell>
    );

  const { deal } = live.data;
  const t = deal.terms;
  const named: Address = t[role];
  const total = t.advanceAmount + t.balanceAmount;
  const pct = total > 0n ? Number((t.advanceAmount * 100n) / total) : 0;
  const ask = ASK[role];
  const exp = expectedAttestation(deal);
  const stepOpen = !ask.signs || exp?.role === role;
  const closed = deal.state >= DealState.Released;
  const signedAlready =
    (role === "inspector" && deal.state >= DealState.GoodsReady) ||
    (role === "carrier" && deal.state >= DealState.Shipped);
  const next = ask.signs ? `/attest/${raw}${search}` : `/deals/${raw}${search}`;

  const go = async () => {
    setError(undefined);
    if (address && isAddressEqual(address, named)) return navigate(next);
    try {
      const mine = await pilot.connect();
      if (isAddressEqual(mine, named)) return navigate(next);
      setError(
        <>
          This deal names <span className="font-mono">{named}</span> as the {NAME[role]}, and the
          test wallet on this phone is <span className="font-mono">{mine}</span>. Open the link on
          the phone where you made your wallet, or send this address to the person who invited you.
        </>,
      );
    } catch {
      setError("The test wallet could not start. Reload the page and try again.");
    }
  };

  return (
    <Shell>
      <header className="space-y-3">
        <p className="text-xs font-semibold tracking-[0.2em] text-gold uppercase">
          Test network · no real money
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          You are the {NAME[role]} on test deal #{raw}
        </h1>
        <p className="leading-relaxed text-muted-foreground">
          {from ? `${from} invited you` : "The Wasit team invited you"} to take one role in a test
          order on Wasit, a project in the Mezo buildathon. There are no real goods and no real
          money: it runs on a test network.
        </p>
      </header>

      <Card>
        <CardContent className="space-y-4 text-sm leading-relaxed">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-muted-foreground">Order value</p>
              <p className="text-lg font-semibold">{formatMusd(total)}</p>
              <p className="text-xs text-muted-foreground">test tokens</p>
            </div>
            <div>
              <p className="text-muted-foreground">Paid up front</p>
              <p className="text-lg font-semibold">{pct}%</p>
            </div>
          </div>
          <div className="border-t pt-4">
            <p className="font-semibold">You are asked to {ask.ask}</p>
          </div>
          <div className="space-y-2 border-t pt-4">
            <p>
              <strong>What your action proves:</strong> {ask.proves}
            </p>
            <p>
              <strong>What it does not prove:</strong> that any goods exist or moved, or who you
              are. It shows that a key on your phone acted.
            </p>
            {ask.signs && (
              <p className="text-muted-foreground">
                You need no tokens: you sign on your phone, then send the signed statement back, and
                whoever receives it puts it on the test network.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {stepOpen ? (
        <Button size="lg" className="w-full" disabled={pilot.connecting} onClick={() => void go()}>
          {pilot.connecting ? <LoaderCircle className="animate-spin" /> : <Wallet />} Continue as{" "}
          {NAME[role]}
        </Button>
      ) : (
        <p className="rounded-lg border bg-card p-4 text-sm">
          {closed
            ? "This test deal is closed. There is nothing left to do, thank you."
            : signedAlready
              ? "This step has already been signed. Thank you."
              : "Your step is not open yet. Open this link again when the person who invited you says so."}
        </p>
      )}
      {error && <p className="text-sm break-words text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">
        The button opens a test wallet kept in this browser (its key never leaves this phone). If
        you connected your own wallet at the top and the deal names it, that one is used instead.
      </p>
    </Shell>
  );
}
