/**
 * Seeds trove-backed deals on the `mezo-testnet-trove` set (PLAN 8.3d). Team wallets only.
 *
 *   trove default <orderMusd> <btc>    supplier misses the production deadline; the buyer is paid
 *                                      in MUSD from the vault; the bonder repays and closes
 *   trove released <orderMusd> <btc>   inspector and carrier sign, the balance is released; the
 *                                      bonder repays fee + interest and closes
 *
 * 30% up front, bond ratio 120% (the escrow's minimum), so a trade-size order borrows the
 * 1,800 MUSD floor. <btc> is the trove collateral the agent posts. Buyer MUSD comes from team
 * wallets, topped up with a BTC → MUSD swap on the Mezo pool if short; never from borrowing.
 * Usage: pnpm --filter @wasit/scripts trove default 3000 0.035   (after `forge build`)
 */
import {
  formatUnits,
  hashTypedData,
  keccak256,
  parseEventLogs,
  parseUnits,
  toBytes,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import type { HDAccount } from "viem/accounts";
import { chain, connect, loadAbi, loadDeployment, type Ctx } from "./lib.js";

const ESCROW = loadAbi("WasitEscrow");
const BOND = loadAbi("TroveBond");
const ERC20 = loadAbi("IERC20");
const SORTED = loadAbi("IMusdBorrowing", "ISortedTroves");
const BO = loadAbi("IMusdBorrowing", "IBorrowerOperations");
const ADAPTER = loadAbi("MezoRouterAdapter");
const ROUTER = loadAbi("MezoRouterAdapter", "IMezoRouter");

const MINUTE = 60;
const DAY = 86_400;
const units = (v: string) => parseUnits(v, 18);
const trove = loadDeployment("mezo-testnet-trove");
const live = loadDeployment("mezo-testnet");
if (trove.bondKind !== "trove") throw new Error("not the trove set");

const balanceOf = (ctx: Ctx, who: Address) =>
  ctx.pub.readContract({
    address: trove.musd,
    abi: ERC20,
    functionName: "balanceOf",
    args: [who],
  }) as Promise<bigint>;

/** Brings `who` to `amount` MUSD from other team wallets, then a pool swap if still short. */
async function ensureMusd(ctx: Ctx, who: HDAccount, amount: bigint) {
  const a = ctx.accounts;
  let have = await balanceOf(ctx, who.address);
  for (const from of [a.supplier, a.deployer, a.agent, a.buyer]) {
    if (have >= amount || from.address === who.address) continue;
    const spare = await balanceOf(ctx, from.address);
    const send = spare < amount - have ? spare : amount - have;
    if (send === 0n) continue;
    await ctx.call(`team MUSD ${formatUnits(send, 18)} to ${who.address}`, from, {
      address: trove.musd,
      abi: ERC20,
      functionName: "transfer",
      args: [who.address, send],
    });
    have += send;
  }
  if (have >= amount) return;
  const need = amount - have;
  const factory = (await ctx.pub.readContract({
    address: live.swapAdapter,
    abi: ADAPTER,
    functionName: "factory",
  })) as Address;
  const route = [{ from: live.btc, to: live.musd, stable: false, factory }];
  const probe = units("0.0001");
  const quote = (await ctx.pub.readContract({
    address: live.router,
    abi: ROUTER,
    functionName: "getAmountsOut",
    args: [probe, route],
  })) as readonly bigint[];
  const btcIn = (((need * probe) / (quote[1] ?? 1n)) * 103n) / 100n;
  const gas = units("0.0001");
  const btc = await ctx.pub.getBalance({ address: who.address });
  if (btc < btcIn + gas)
    await ctx.transfer("BTC for the swap", a.deployer, who.address, btcIn + gas - btc);
  await ctx.call("approve the router (BTC)", who, {
    address: live.btc,
    abi: ERC20,
    functionName: "approve",
    args: [live.router, btcIn],
  });
  await ctx.call(`swap ${formatUnits(btcIn, 18)} BTC for MUSD`, who, {
    address: live.router,
    abi: ROUTER,
    functionName: "swapExactTokensForTokens",
    args: [btcIn, need, route, who.address, BigInt(Math.floor(Date.now() / 1000) + 600)],
  });
}

async function attest(
  ctx: Ctx,
  id: bigint,
  kind: 1 | 2,
  signer: HDAccount,
  prev: TransactionReceipt,
) {
  const evidenceHash = keccak256(
    toBytes(`${kind === 1 ? "inspection" : "bill of lading"} trove deal ${id}`),
  );
  const after = await ctx.blockTime(prev);
  const latest = (await ctx.pub.getBlock()).timestamp;
  const issuedAt = latest > after ? latest : after;
  const nonce = kind === 1 ? 0n : 1n;
  const typedData = {
    domain: { name: "Wasit", version: "1", chainId: chain.id, verifyingContract: trove.escrow },
    types: {
      Attestation: [
        { name: "dealId", type: "uint256" },
        { name: "kind", type: "uint8" },
        { name: "evidenceHash", type: "bytes32" },
        { name: "issuedAt", type: "uint64" },
        { name: "nonce", type: "uint256" },
      ],
    },
    primaryType: "Attestation",
    message: { dealId: id, kind, evidenceHash, issuedAt, nonce },
  } as const;
  const digest = (await ctx.pub.readContract({
    address: trove.escrow,
    abi: ESCROW,
    functionName: "attestationDigest",
    args: [id, kind, evidenceHash, issuedAt, nonce],
  })) as Hex;
  if (digest !== hashTypedData(typedData)) throw new Error("EIP-712 digest differs from contract");
  return ctx.call(kind === 1 ? "inspector signs READY" : "carrier signs SHIPPED", signer, {
    address: trove.escrow,
    abi: ESCROW,
    functionName: "submitAttestation",
    args: [id, kind, evidenceHash, issuedAt, await signer.signTypedData(typedData)],
  });
}

async function run(ctx: Ctx, scenario: "default" | "released", order: bigint, btc: bigint) {
  const a = ctx.accounts;
  const advance = (order * 30n) / 100n;
  const balance = order - advance;
  const periods =
    scenario === "default"
      ? { p: 2 * MINUTE, b: DAY, s: DAY, c: DAY, r: DAY }
      : { p: DAY, b: DAY, s: DAY, c: MINUTE, r: DAY };
  const document = [
    `Wasit trove-mode test deal (${scenario}), Mezo testnet, team wallets, no real goods`,
    `Order ${formatUnits(order, 18)} MUSD = ${formatUnits(advance, 18)} up front + ${formatUnits(balance, 18)}`,
    `Bond: trove-backed, 120% of the net advance, ${formatUnits(btc, 18)} BTC collateral`,
  ].join("\n");
  const feeBps = (await ctx.pub.readContract({
    address: trove.escrow,
    abi: ESCROW,
    functionName: "defaultFeeBps",
  })) as number;

  await ensureMusd(ctx, a.buyer, scenario === "default" ? advance : order);
  const agentBtc = await ctx.pub.getBalance({ address: a.agent.address });
  const want = btc + units("0.0002");
  if (agentBtc < want)
    await ctx.transfer("BTC to the agent", a.deployer, a.agent.address, want - agentBtc);

  const created = await ctx.call("buyer creates the deal", a.buyer, {
    address: trove.escrow,
    abi: ESCROW,
    functionName: "createDeal",
    args: [
      {
        buyer: a.buyer.address,
        supplier: a.supplier.address,
        inspector: a.inspector.address,
        carrier: a.carrier.address,
        arbiter: a.arbiter.address,
        bonder: a.agent.address,
        token: trove.musd,
        advanceAmount: advance,
        balanceAmount: balance,
        feeBps,
        bondRatioBps: 12_000,
        productionPeriod: periods.p,
        balanceWindow: periods.b,
        shippingPeriod: periods.s,
        challengeWindow: periods.c,
        arbitrationPeriod: periods.r,
        termsHash: keccak256(toBytes(document)),
      },
    ],
  });
  const [ev] = parseEventLogs({ abi: ESCROW, logs: created.logs, eventName: "DealCreated" });
  const id = (ev?.args as { dealId: bigint } | undefined)?.dealId;
  if (id === undefined) throw new Error("no DealCreated event");
  console.log(`trove deal ${id} on ${trove.escrow}`);
  const deal = { address: trove.escrow, abi: ESCROW, args: [id] } as const;
  await ctx.call("supplier accepts", a.supplier, { ...deal, functionName: "accept" });
  await ctx.call("arbiter accepts", a.arbiter, { ...deal, functionName: "acceptArbiter" });

  // Sorted-list hints for the new trove (ADR-036): NICR = coll * 1e20 / composite debt
  const [, covered] = (await ctx.pub.readContract({
    ...deal,
    functionName: "bondTerms",
  })) as readonly [Address, bigint];
  const minNet = (await ctx.pub.readContract({
    address: trove.borrowerOperations!,
    abi: BO,
    functionName: "minNetDebt",
  })) as bigint;
  const needed = (covered * 12_000n + 9_999n) / 10_000n;
  const debt = needed > minNet ? needed : minNet;
  const composite = debt + debt / 1_000n + units("200");
  const sorted = (await ctx.pub.readContract({
    address: trove.borrowerOperations!,
    abi: BO,
    functionName: "sortedTroves",
  })) as Address;
  const [upper, lower] = (await ctx.pub.readContract({
    address: sorted,
    abi: SORTED,
    functionName: "findInsertPosition",
    args: [
      (btc * 10n ** 20n) / composite,
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000",
    ],
  })) as readonly [Address, Address];
  await ctx.call(
    `agent posts ${formatUnits(btc, 18)} BTC into a trove (${formatUnits(debt, 18)} MUSD)`,
    a.agent,
    {
      address: trove.bond,
      abi: BOND,
      functionName: "post",
      args: [id, upper, lower],
      value: btc,
    } as never,
  );
  const vault = (await ctx.pub.readContract({
    address: trove.bond,
    abi: BOND,
    functionName: "vaultOf",
    args: [id],
  })) as Address;
  console.log(`  vault ${vault} holds ${formatUnits(await balanceOf(ctx, vault), 18)} MUSD`);

  await ctx.call("buyer approves MUSD", a.buyer, {
    address: trove.musd,
    abi: ERC20,
    functionName: "approve",
    args: [trove.escrow, scenario === "default" ? advance : order],
  });
  const advanced = await ctx.call("buyer pays the advance", a.buyer, {
    ...deal,
    functionName: "fundAdvance",
  });

  if (scenario === "default") {
    console.log("  waiting for the 2-minute production deadline");
    await ctx.call(
      "buyer claims the missed deadline (paid from the vault in MUSD)",
      a.buyer,
      { ...deal, functionName: "claimSupplierDefault" },
      "DeadlineNotReached",
    );
  } else {
    await attest(ctx, id, 1, a.inspector, advanced);
    const funded = await ctx.call("buyer funds the balance", a.buyer, {
      ...deal,
      functionName: "fundBalance",
    });
    await attest(ctx, id, 2, a.carrier, funded);
    console.log("  waiting for the 1-minute challenge window");
    await ctx.call(
      "release",
      a.supplier,
      { ...deal, functionName: "release" },
      "DeadlineNotReached",
    );
  }

  // The bonder repays the shortfall and takes the BTC back
  // Debt to repay is the drawn amount + 0.1% fee + interest; 5 MUSD covers days of interest.
  // Only the exact shortfall is pulled; the rest of the allowance stays unused.
  const held = await balanceOf(ctx, vault);
  const shortfall = debt + debt / 1_000n + units("5") - held;
  await ensureMusd(ctx, a.agent, shortfall);
  await ctx.call("agent approves MUSD for the close", a.agent, {
    address: trove.musd,
    abi: ERC20,
    functionName: "approve",
    args: [trove.bond, shortfall],
  });
  await ctx.call("agent closes the trove (BTC back)", a.agent, {
    address: trove.bond,
    abi: BOND,
    functionName: "close",
    args: [id],
  });
  return id;
}

const [scenario, orderArg, btcArg] = process.argv.slice(2);
if ((scenario !== "default" && scenario !== "released") || !orderArg || !btcArg)
  throw new Error("usage: trove default|released <orderMusd> <btc>");
const ctx = await connect();
const id = await run(ctx, scenario, units(orderArg), units(btcArg));
console.log(JSON.stringify({ deal: `${trove.escrow} #${id}`, txs: ctx.sent }, null, 2));
