/**
 * Seeds the demo deals on Mezo testnet (PLAN 3.4, DEMO-SCRIPT):
 *   happy    live set: bond, advance, READY, balance, SHIPPED, challenge window, release
 *   default  live set: bond, advance, production deadline missed, buyer claims, bond refunds
 *   protect  demo-sim set (simulated price feed): bond, advance, price drop, protect()
 *   dispute  live set: shipped, then the buyer disputes; left open for the arbiter (30 days)
 *   fund     only the top-up below, so a demo can be recorded live from the role wallets
 * Usage (after `forge build` in contracts/): pnpm --filter @wasit/scripts seed [scenario|all]
 * Every scenario first tops up the role accounts from the deployer. Amounts are small on purpose;
 * the buyer's MUSD comes from a BTC → MUSD swap on the Mezo pool, never from borrowing.
 */
import {
  formatUnits,
  hashTypedData,
  keccak256,
  parseEventLogs,
  parseUnits,
  toBytes,
  zeroAddress,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import type { HDAccount } from "viem/accounts";
import { chain, connect, loadAbi, loadDeployment, type Ctx, type Deployment } from "./lib.js";

const ESCROW = loadAbi("WasitEscrow");
const BOND = loadAbi("AdvanceBond");
const ERC20 = loadAbi("IERC20");
const ORACLE = loadAbi("IPriceOracle");
const DEMO_ORACLE = loadAbi("DemoOracle");
const ADAPTER = loadAbi("MezoRouterAdapter");
const ROUTER = loadAbi("MezoRouterAdapter", "IMezoRouter");

const units = (value: string) => parseUnits(value, 18); // MUSD and BTC both have 18 decimals
const ADVANCE = units("30");
const BALANCE = units("70");
const BOND_RATIO_BPS = 15_000; // 150 % of the net advance, as in the demo script
const GAS_RESERVE = units("0.0001"); // BTC per role; one tx costs ~1e-10 BTC on testnet
const AGENT_BTC = units("0.0025"); // three bonds of ~0.00056 BTC, plus gas
// 100 (happy) + 30 (default) + 30 (protect) + 100 (dispute), or one live recording of the
// happy and default scenes after a seed run
const BUYER_MUSD = units("270");
const MINUTE = 60;
const DAY = 86_400;
const READY_INSPECTED = 1;
const SHIPPED = 2;

interface Periods {
  production: number;
  balanceWindow: number;
  shipping: number;
  challenge: number;
  arbitration: number;
}

async function fund(ctx: Ctx, live: Deployment) {
  const { pub, accounts: a, call, transfer } = ctx;
  console.log("fund role accounts from the deployer");
  const topUps = [
    [a.agent, AGENT_BTC],
    [a.supplier, GAS_RESERVE],
    [a.inspector, GAS_RESERVE],
    [a.carrier, GAS_RESERVE],
    [a.arbiter, GAS_RESERVE],
  ] as const;
  for (const [account, target] of topUps) {
    const have = await pub.getBalance({ address: account.address });
    if (have < target)
      await transfer(`BTC to ${account.address}`, a.deployer, account.address, target - have);
  }

  const musd = (await pub.readContract({
    address: live.musd,
    abi: ERC20,
    functionName: "balanceOf",
    args: [a.buyer.address],
  })) as bigint;
  if (musd >= BUYER_MUSD) return;
  const need = BUYER_MUSD - musd;
  const factory = (await pub.readContract({
    address: live.swapAdapter,
    abi: ADAPTER,
    functionName: "factory",
  })) as Address;
  const route = [{ from: live.btc, to: live.musd, stable: false, factory }];
  const probe = units("0.0001");
  const quote = (await pub.readContract({
    address: live.router,
    abi: ROUTER,
    functionName: "getAmountsOut",
    args: [probe, route],
  })) as readonly bigint[];
  const btcIn = (((need * probe) / (quote[1] ?? 1n)) * 105n) / 100n; // 5 % above the pool quote
  const btc = await pub.getBalance({ address: a.buyer.address });
  if (btc < btcIn + GAS_RESERVE) {
    await transfer("BTC to the buyer", a.deployer, a.buyer.address, btcIn + GAS_RESERVE - btc);
  }
  await call("buyer approves the router (BTC)", a.buyer, {
    address: live.btc,
    abi: ERC20,
    functionName: "approve",
    args: [live.router, btcIn],
  });
  await call(`buyer swaps ${formatUnits(btcIn, 18)} BTC for MUSD`, a.buyer, {
    address: live.router,
    abi: ROUTER,
    functionName: "swapExactTokensForTokens",
    args: [btcIn, need, route, a.buyer.address, BigInt(Math.floor(Date.now() / 1000) + 600)],
  });
}

/** Creates, accepts, bonds and pays the advance of a deal; returns its id and the advance tx. */
async function openDeal(ctx: Ctx, d: Deployment, title: string, p: Periods, withBalance: boolean) {
  const { pub, accounts: a, call, readUntil } = ctx;
  const feeBps = (await pub.readContract({
    address: d.escrow,
    abi: ESCROW,
    functionName: "defaultFeeBps",
  })) as number;
  const document = [
    `Wasit demo deal: ${title}`,
    "Goods: 1,000 glazed ceramic tiles (demo data, no real goods)",
    `Price: ${formatUnits(ADVANCE + BALANCE, 18)} MUSD = ${formatUnits(ADVANCE, 18)} advance + ${formatUnits(BALANCE, 18)} balance`,
    "READY: signed by the named inspector. SHIPPED: signed by the named carrier.",
  ].join("\n");
  const terms = {
    buyer: a.buyer.address,
    supplier: a.supplier.address,
    inspector: a.inspector.address,
    carrier: a.carrier.address,
    arbiter: a.arbiter.address,
    bonder: a.agent.address,
    token: d.musd,
    advanceAmount: ADVANCE,
    balanceAmount: BALANCE,
    feeBps,
    bondRatioBps: BOND_RATIO_BPS,
    productionPeriod: p.production,
    balanceWindow: p.balanceWindow,
    shippingPeriod: p.shipping,
    challengeWindow: p.challenge,
    arbitrationPeriod: p.arbitration,
    termsHash: keccak256(toBytes(document)),
  };
  const created = await call("buyer creates the deal", a.buyer, {
    address: d.escrow,
    abi: ESCROW,
    functionName: "createDeal",
    args: [terms],
  });
  const [event] = parseEventLogs({ abi: ESCROW, logs: created.logs, eventName: "DealCreated" });
  const dealId = (event?.args as { dealId: bigint } | undefined)?.dealId;
  if (dealId === undefined) throw new Error("no DealCreated event");
  console.log(`  deal ${dealId}, termsHash ${terms.termsHash}`);

  const deal = { address: d.escrow, abi: ESCROW, args: [dealId] } as const;
  await call("supplier accepts", a.supplier, { ...deal, functionName: "accept" });
  await call("arbiter accepts the role", a.arbiter, { ...deal, functionName: "acceptArbiter" });

  const [, covered] = await readUntil(
    () =>
      pub.readContract({ ...deal, functionName: "bondTerms" }) as Promise<
        readonly [Address, bigint, number, number]
      >,
    ([bonder]) => bonder !== zeroAddress,
  );
  const [price] = (await pub.readContract({
    address: d.oracle,
    abi: ORACLE,
    functionName: "btcUsd",
  })) as readonly [bigint, bigint];
  // 1 % above the required ratio so a small price move between quote and post cannot fail it
  const btc = (((covered * BigInt(BOND_RATIO_BPS) * 10n ** 18n) / (10_000n * price)) * 101n) / 100n;
  await call("agent approves the bond (BTC)", a.agent, {
    address: d.btc,
    abi: ERC20,
    functionName: "approve",
    args: [d.bond, btc],
  });
  await call(`agent posts ${formatUnits(btc, 18)} BTC`, a.agent, {
    address: d.bond,
    abi: BOND,
    functionName: "post",
    args: [dealId, btc],
  });

  await call("buyer approves the escrow (MUSD)", a.buyer, {
    address: d.musd,
    abi: ERC20,
    functionName: "approve",
    args: [d.escrow, withBalance ? ADVANCE + BALANCE : ADVANCE],
  });
  const advanced = await call("buyer pays the advance", a.buyer, {
    ...deal,
    functionName: "fundAdvance",
  });
  return { dealId, advanced };
}

/** Signs an attestation as `signer` (EIP-712, checked against the contract's digest), submits it. */
async function attest(
  ctx: Ctx,
  d: Deployment,
  dealId: bigint,
  kind: number,
  signer: HDAccount,
  previous: TransactionReceipt,
  evidence: string,
) {
  const { pub } = ctx;
  const evidenceHash = keccak256(toBytes(evidence));
  const nonce = kind === READY_INSPECTED ? 0n : 1n;
  const after = await ctx.blockTime(previous);
  const latest = (await pub.getBlock()).timestamp;
  const issuedAt = latest > after ? latest : after; // not before the previous milestone
  const typedData = {
    domain: { name: "Wasit", version: "1", chainId: chain.id, verifyingContract: d.escrow },
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
    message: { dealId, kind, evidenceHash, issuedAt, nonce },
  } as const;
  const digest = (await pub.readContract({
    address: d.escrow,
    abi: ESCROW,
    functionName: "attestationDigest",
    args: [dealId, kind, evidenceHash, issuedAt, nonce],
  })) as Hex;
  if (digest !== hashTypedData(typedData)) throw new Error("EIP-712 digest differs from contract");
  const signature = await signer.signTypedData(typedData);
  const label = kind === READY_INSPECTED ? "inspector attests READY" : "carrier attests SHIPPED";
  return ctx.call(label, signer, {
    address: d.escrow,
    abi: ESCROW,
    functionName: "submitAttestation",
    args: [dealId, kind, evidenceHash, issuedAt, signature],
  });
}

async function happy(ctx: Ctx, live: Deployment) {
  const { accounts: a, call } = ctx;
  console.log("happy path (live set)");
  const short = 10 * MINUTE;
  const periods = {
    production: short,
    balanceWindow: short,
    shipping: short,
    challenge: MINUTE,
    arbitration: short,
  };
  const { dealId, advanced } = await openDeal(ctx, live, "happy path", periods, true);
  const deal = { address: live.escrow, abi: ESCROW, args: [dealId] } as const;
  await attest(ctx, live, dealId, READY_INSPECTED, a.inspector, advanced, `inspection ${dealId}`);
  const funded = await call("buyer funds the balance", a.buyer, {
    ...deal,
    functionName: "fundBalance",
  });
  await attest(ctx, live, dealId, SHIPPED, a.carrier, funded, `bill of lading ${dealId}`);
  console.log("  waiting for the 1-minute challenge window");
  await call(
    "supplier releases",
    a.supplier,
    { ...deal, functionName: "release" },
    "DeadlineNotReached",
  );
  return dealId;
}

async function supplierDefault(ctx: Ctx, live: Deployment) {
  const { accounts: a, call } = ctx;
  console.log("supplier default (live set)");
  const short = 10 * MINUTE;
  const periods = {
    production: MINUTE,
    balanceWindow: short,
    shipping: short,
    challenge: short,
    arbitration: short,
  };
  const { dealId } = await openDeal(ctx, live, "supplier default", periods, false);
  console.log("  waiting for the 1-minute production deadline");
  await call(
    "buyer claims the missed deadline",
    a.buyer,
    { address: live.escrow, abi: ESCROW, functionName: "claimSupplierDefault", args: [dealId] },
    "DeadlineNotReached",
  );
  return dealId;
}

async function protect(ctx: Ctx) {
  const { pub, accounts: a, call } = ctx;
  const sim = loadDeployment("mezo-testnet-demo-sim");
  if (!sim.simulatedPriceFeed) throw new Error("protect runs on the demo-sim deployment only");
  console.log("bond protection (demo-sim set, SIMULATED price feed)");
  const periods = {
    production: 30 * DAY,
    balanceWindow: 7 * DAY,
    shipping: 30 * DAY,
    challenge: 3 * DAY,
    arbitration: 14 * DAY,
  };
  const { dealId } = await openDeal(ctx, sim, "bond protection", periods, false);
  const [start] = (await pub.readContract({
    address: sim.oracle,
    abi: ORACLE,
    functionName: "btcUsd",
  })) as readonly [bigint, bigint];
  const setPrice = (label: string, price: bigint) =>
    call(label, a.deployer, {
      address: sim.oracle,
      abi: DEMO_ORACLE,
      functionName: "setPrice",
      args: [price],
    });
  // 151.5 % at posting → ~129 % (below the 130 % top-up line) → ~114 % (below 115 %: protect)
  for (const pct of [85n, 75n]) {
    await setPrice(`simulated BTC price to ${pct} %`, (start * pct) / 100n);
  }
  await call("keeper protects the bond", a.deployer, {
    address: sim.bond,
    abi: BOND,
    functionName: "protect",
    args: [dealId],
  });
  await setPrice("simulated BTC price back to the start", start);
  return dealId;
}

/** The buyer's written reason. Only its hash goes on-chain; the arbiter checks this text against it. */
const DISPUTE_REASON =
  "Demo dispute: 200 of the 1,000 tiles arrived cracked. Inspection photos sent to the arbiter.";

async function dispute(ctx: Ctx, live: Deployment) {
  const { accounts: a, call } = ctx;
  console.log("dispute (live set)");
  const short = 10 * MINUTE;
  const periods = {
    production: short,
    balanceWindow: short,
    shipping: short,
    challenge: 3 * DAY,
    arbitration: 30 * DAY,
  };
  const { dealId, advanced } = await openDeal(ctx, live, "dispute", periods, true);
  const deal = { address: live.escrow, abi: ESCROW, args: [dealId] } as const;
  await attest(ctx, live, dealId, READY_INSPECTED, a.inspector, advanced, `inspection ${dealId}`);
  const funded = await call("buyer funds the balance", a.buyer, {
    ...deal,
    functionName: "fundBalance",
  });
  await attest(ctx, live, dealId, SHIPPED, a.carrier, funded, `bill of lading ${dealId}`);
  const reasonHash = keccak256(toBytes(DISPUTE_REASON));
  await call("buyer disputes", a.buyer, {
    address: live.escrow,
    abi: ESCROW,
    functionName: "dispute",
    args: [dealId, reasonHash],
  });
  console.log(`  reason: ${DISPUTE_REASON}
  reasonHash ${reasonHash}`);
  return dealId;
}

const scenarios = ["happy", "default", "protect", "dispute", "fund"] as const;
const chosen = process.argv[2] ?? "all";
if (chosen !== "all" && !(scenarios as readonly string[]).includes(chosen)) {
  throw new Error(`unknown scenario ${chosen}; use one of ${scenarios.join(", ")} or all`);
}
const ctx = await connect();
const live = loadDeployment("mezo-testnet");
if (live.simulatedPriceFeed) throw new Error("the live deployment must not use a simulated feed");
for (const [role, account] of Object.entries(ctx.accounts))
  console.log(`${role} ${account.address}`);

await fund(ctx, live);
const deals: Record<string, string> = {};
if (chosen === "all" || chosen === "happy")
  deals.happy = `${live.escrow} #${await happy(ctx, live)}`;
if (chosen === "all" || chosen === "default") {
  deals.default = `${live.escrow} #${await supplierDefault(ctx, live)}`;
}
if (chosen === "all" || chosen === "protect") deals.protect = `demo-sim #${await protect(ctx)}`;
if (chosen === "all" || chosen === "dispute")
  deals.dispute = `${live.escrow} #${await dispute(ctx, live)}`;
console.log(JSON.stringify({ deals, txs: ctx.sent }, null, 2));
