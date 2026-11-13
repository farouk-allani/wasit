/**
 * Test deals with people outside the team (PLAN 9.3, ADR-035). Mezo testnet only.
 *
 *   pilot fund <address> <role>        testnet BTC for gas, plus 100 MUSD (buyer) or 0.001 BTC
 *                                      (bonder); every transfer is appended to docs/pilot/funding.json
 *   pilot deal <role>=<address> ...    creates a 100 MUSD deal naming outside addresses for the
 *                                      given roles (team wallets for the rest), then runs `next`
 *   pilot next <dealId>                runs every step a team wallet can take now, then prints the
 *                                      invite link of whoever must act (or how long to wait)
 *   pilot relay <link | JSON>          submits a statement signed by an outside inspector/carrier
 *   pilot verify <statement.json>      checks a signed participant statement (docs/pilot/) against
 *                                      the deal on chain: signer, named role, step accepted
 *
 * Roles: buyer, supplier, inspector, carrier, arbiter, bonder.
 * Usage: pnpm --filter @wasit/scripts pilot <command> ...   (after `forge build` in contracts/)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  formatUnits,
  getAddress,
  hashTypedData,
  isAddress,
  isAddressEqual,
  keccak256,
  parseEventLogs,
  parseUnits,
  recoverTypedDataAddress,
  toBytes,
  verifyMessage,
  type Address,
  type Hex,
} from "viem";
import type { HDAccount } from "viem/accounts";
import { chain, connect, loadAbi, loadDeployment, type Ctx } from "./lib.js";

const ESCROW = loadAbi("WasitEscrow");
const BOND = loadAbi("AdvanceBond");
const ERC20 = loadAbi("IERC20");
const ORACLE = loadAbi("IPriceOracle");

const units = (v: string) => parseUnits(v, 18);
const ADVANCE = units("30");
const BALANCE = units("70");
const BOND_RATIO_BPS = 15_000;
const GAS = units("0.0002"); // one tx costs ~1e-10 BTC on testnet; this is generous
const BONDER_BTC = units("0.001"); // a 150% bond on 29.85 MUSD is ~0.00065 BTC at 69k USD
const HOUR = 3_600;
const DAY = 86_400;
const APP = process.env.PILOT_APP_URL ?? "https://wasit.app";
const FROM = process.env.PILOT_FROM ?? "Farouk";

const ROLES = ["buyer", "supplier", "inspector", "carrier", "arbiter", "bonder"] as const;
type PilotRole = (typeof ROLES)[number];
const isRole = (r: string): r is PilotRole => (ROLES as readonly string[]).includes(r);

const STATE = [
  "None",
  "Created",
  "Accepted",
  "AdvancePaid",
  "GoodsReady",
  "BalanceFunded",
  "Shipped",
  "Disputed",
  "Released",
  "Resolved",
  "SupplierDefaulted",
  "BuyerDefaulted",
  "Cancelled",
] as const;

interface Terms {
  buyer: Address;
  supplier: Address;
  inspector: Address;
  carrier: Address;
  arbiter: Address;
  bonder: Address;
  token: Address;
  advanceAmount: bigint;
  balanceAmount: bigint;
  feeBps: number;
  bondRatioBps: number;
  productionPeriod: number;
  balanceWindow: number;
  shippingPeriod: number;
  challengeWindow: number;
  arbitrationPeriod: number;
  termsHash: Hex;
}
interface Deal {
  terms: Terms;
  state: number;
  arbiterAccepted: boolean;
  attestationNonce: number;
  advancePaidAt: bigint;
  readyAt: bigint;
  balanceFundedAt: bigint;
  shippedAt: bigint;
}

const live = loadDeployment("mezo-testnet");
if (live.simulatedPriceFeed) throw new Error("the live deployment must not use a simulated feed");
const funding = new URL("../../../docs/pilot/funding.json", import.meta.url);

function teamAccount(ctx: Ctx, role: PilotRole): HDAccount {
  return role === "bonder" ? ctx.accounts.agent : ctx.accounts[role];
}
const invite = (id: bigint, role: PilotRole) =>
  `${APP}/invite/${id}/${role}?from=${encodeURIComponent(FROM)}`;

async function balances(ctx: Ctx, address: Address) {
  const [btc, musd] = await Promise.all([
    ctx.pub.getBalance({ address }),
    ctx.pub.readContract({
      address: live.musd,
      abi: ERC20,
      functionName: "balanceOf",
      args: [address],
    }) as Promise<bigint>,
  ]);
  return { btc, musd };
}

/** Team MUSD for a buyer comes from the team supplier, who holds the earlier deals' proceeds. */
async function sendMusd(ctx: Ctx, to: Address, amount: bigint, label: string) {
  const from = ctx.accounts.supplier;
  const { musd } = await balances(ctx, from.address);
  if (musd < amount)
    throw new Error(`team supplier holds ${formatUnits(musd, 18)} MUSD, need more`);
  return ctx.call(label, from, {
    address: live.musd,
    abi: ERC20,
    functionName: "transfer",
    args: [to, amount],
  });
}

async function fund(ctx: Ctx, address: Address, role: PilotRole) {
  const sent: { what: string; amount: string; tx: Hex }[] = [];
  const btc = role === "bonder" ? GAS + BONDER_BTC : GAS;
  const r1 = await ctx.transfer(
    `${formatUnits(btc, 18)} BTC to ${address}`,
    ctx.accounts.deployer,
    address,
    btc,
  );
  sent.push({ what: "BTC", amount: formatUnits(btc, 18), tx: r1.transactionHash });
  if (role === "buyer") {
    const r2 = await sendMusd(ctx, address, ADVANCE + BALANCE, `100 MUSD to ${address}`);
    sent.push({ what: "MUSD", amount: formatUnits(ADVANCE + BALANCE, 18), tx: r2.transactionHash });
  }
  mkdirSync(new URL(".", funding), { recursive: true });
  const log = existsSync(funding) ? (JSON.parse(readFileSync(funding, "utf8")) as unknown[]) : [];
  for (const s of sent)
    log.push({ date: new Date().toISOString().slice(0, 10), to: address, role, ...s });
  writeFileSync(funding, `${JSON.stringify(log, null, 2)}\n`);
  console.log(`disclosed in docs/pilot/funding.json: ${sent.length} transfer(s)`);
}

async function createDeal(ctx: Ctx, outside: Partial<Record<PilotRole, Address>>) {
  const feeBps = (await ctx.pub.readContract({
    address: live.escrow,
    abi: ESCROW,
    functionName: "defaultFeeBps",
  })) as number;
  const who = (r: PilotRole) => outside[r] ?? teamAccount(ctx, r).address;
  const document = [
    "Wasit test deal with people outside the team (Mezo testnet, no real goods, no real money)",
    `Created ${new Date().toISOString()}`,
    "Order: 100 test MUSD = 30 advance + 70 balance",
    `Outside roles: ${Object.entries(outside)
      .map(([r, a]) => `${r} ${a}`)
      .join(", ")}`,
  ].join("\n");
  const terms: Terms = {
    buyer: who("buyer"),
    supplier: who("supplier"),
    inspector: who("inspector"),
    carrier: who("carrier"),
    arbiter: who("arbiter"),
    bonder: who("bonder"),
    token: live.musd,
    advanceAmount: ADVANCE,
    balanceAmount: BALANCE,
    feeBps,
    bondRatioBps: BOND_RATIO_BPS,
    productionPeriod: 3 * DAY, // time for an outside inspector to answer
    balanceWindow: 3 * DAY,
    shippingPeriod: 3 * DAY,
    challengeWindow: HOUR,
    arbitrationPeriod: 3 * DAY,
    termsHash: keccak256(toBytes(document)),
  };
  // createDeal is the buyer's call; an outside buyer creates it themselves in the app
  if (outside.buyer) throw new Error("an outside buyer creates the deal in the app at /deals/new");
  const created = await ctx.call("team buyer creates the deal", ctx.accounts.buyer, {
    address: live.escrow,
    abi: ESCROW,
    functionName: "createDeal",
    args: [terms],
  });
  const [event] = parseEventLogs({ abi: ESCROW, logs: created.logs, eventName: "DealCreated" });
  const dealId = (event?.args as { dealId: bigint } | undefined)?.dealId;
  if (dealId === undefined) throw new Error("no DealCreated event");
  console.log(`deal ${dealId} on ${live.escrow}`);
  return dealId;
}

const readDeal = (ctx: Ctx, id: bigint) =>
  ctx.pub.readContract({
    address: live.escrow,
    abi: ESCROW,
    functionName: "getDeal",
    args: [id],
  }) as Promise<Deal>;

/** The team account behind `address`, if the team holds it. */
function team(ctx: Ctx, address: Address): HDAccount | undefined {
  return Object.values(ctx.accounts).find((a) => isAddressEqual(a.address, address));
}

async function signAndSubmit(ctx: Ctx, id: bigint, deal: Deal, kind: 1 | 2, signer: HDAccount) {
  const evidenceHash = keccak256(
    toBytes(`team ${kind === 1 ? "inspection" : "shipping"} note, deal ${id}`),
  );
  const previous = kind === 1 ? deal.advancePaidAt : deal.balanceFundedAt;
  const latest = (await ctx.pub.getBlock()).timestamp;
  const issuedAt = latest - 30n > previous ? latest - 30n : previous;
  const nonce = BigInt(deal.attestationNonce);
  const typedData = {
    domain: { name: "Wasit", version: "1", chainId: chain.id, verifyingContract: live.escrow },
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
    address: live.escrow,
    abi: ESCROW,
    functionName: "attestationDigest",
    args: [id, kind, evidenceHash, issuedAt, nonce],
  })) as Hex;
  if (digest !== hashTypedData(typedData)) throw new Error("EIP-712 digest differs from contract");
  const signature = await signer.signTypedData(typedData);
  return ctx.call(
    `team ${kind === 1 ? "inspector signs READY" : "carrier signs SHIPPED"}`,
    signer,
    {
      address: live.escrow,
      abi: ESCROW,
      functionName: "submitAttestation",
      args: [id, kind, evidenceHash, issuedAt, signature],
    },
  );
}

/** Runs team steps until an outside party must act or time must pass. */
async function next(ctx: Ctx, id: bigint) {
  const d = { address: live.escrow, abi: ESCROW, args: [id] } as const;
  const waitFor = (role: PilotRole, what: string) => {
    console.log(`\nwaiting for the outside ${role} to ${what}.\nsend: ${invite(id, role)}`);
  };
  for (let i = 0; i < 12; i++) {
    const deal = await readDeal(ctx, id);
    const t = deal.terms;
    const state = STATE[deal.state] ?? String(deal.state);
    console.log(`deal ${id}: ${state}`);
    if (deal.state === 1) {
      const s = team(ctx, t.supplier);
      if (!s) return waitFor("supplier", "accept the terms");
      await ctx.call("team supplier accepts", s, { ...d, functionName: "accept" });
      continue;
    }
    if (deal.state === 2) {
      if (!deal.arbiterAccepted) {
        const a = team(ctx, t.arbiter);
        if (!a) return waitFor("arbiter", "accept the role");
        await ctx.call("team arbiter accepts", a, { ...d, functionName: "acceptArbiter" });
        continue;
      }
      const bond = (await ctx.pub.readContract({
        address: live.bond,
        abi: BOND,
        functionName: "bondOf",
        args: [id],
      })) as { status: number };
      if (bond.status === 0) {
        const b = team(ctx, t.bonder);
        if (!b) return waitFor("bonder", "post the BTC bond");
        const [, covered] = (await ctx.pub.readContract({
          ...d,
          functionName: "bondTerms",
        })) as readonly [Address, bigint, number, number];
        const [price] = (await ctx.pub.readContract({
          address: live.oracle,
          abi: ORACLE,
          functionName: "btcUsd",
        })) as readonly [bigint, bigint];
        const btc =
          (((covered * BigInt(t.bondRatioBps) * 10n ** 18n) / (10_000n * price)) * 101n) / 100n;
        await ctx.call("team bonder approves BTC", b, {
          address: live.btc,
          abi: ERC20,
          functionName: "approve",
          args: [live.bond, btc],
        });
        await ctx.call(`team bonder posts ${formatUnits(btc, 18)} BTC`, b, {
          address: live.bond,
          abi: BOND,
          functionName: "post",
          args: [id, btc],
        });
        continue;
      }
      const buyer = team(ctx, t.buyer);
      if (!buyer) return waitFor("buyer", "pay the advance");
      await topUpTeamBuyer(ctx, buyer, t.advanceAmount);
      await ctx.call("team buyer approves MUSD", buyer, {
        address: live.musd,
        abi: ERC20,
        functionName: "approve",
        args: [live.escrow, t.advanceAmount],
      });
      await ctx.call("team buyer pays the advance", buyer, { ...d, functionName: "fundAdvance" });
      continue;
    }
    if (deal.state === 3) {
      const s = team(ctx, t.inspector);
      if (!s) return waitFor("inspector", "sign READY (then run `pilot relay <link>`)");
      await signAndSubmit(ctx, id, deal, 1, s);
      continue;
    }
    if (deal.state === 4) {
      const buyer = team(ctx, t.buyer);
      if (!buyer) return waitFor("buyer", "fund the balance");
      await topUpTeamBuyer(ctx, buyer, t.balanceAmount);
      await ctx.call("team buyer approves MUSD", buyer, {
        address: live.musd,
        abi: ERC20,
        functionName: "approve",
        args: [live.escrow, t.balanceAmount],
      });
      await ctx.call("team buyer funds the balance", buyer, { ...d, functionName: "fundBalance" });
      continue;
    }
    if (deal.state === 5) {
      const s = team(ctx, t.carrier);
      if (!s) return waitFor("carrier", "sign SHIPPED (then run `pilot relay <link>`)");
      await signAndSubmit(ctx, id, deal, 2, s);
      continue;
    }
    if (deal.state === 6) {
      const ends = deal.shippedAt + BigInt(t.challengeWindow);
      const now = (await ctx.pub.getBlock()).timestamp;
      if (now <= ends) {
        console.log(
          `challenge window open for ${ends - now + 1n} s more; run \`pilot next ${id}\` after`,
        );
        return;
      }
      await ctx.call("release (anyone may call it)", ctx.accounts.deployer, {
        ...d,
        functionName: "release",
      });
      continue;
    }
    console.log("nothing left to do");
    return;
  }
}

async function topUpTeamBuyer(ctx: Ctx, buyer: HDAccount, amount: bigint) {
  const { musd } = await balances(ctx, buyer.address);
  if (musd < amount)
    await sendMusd(ctx, buyer.address, amount - musd, "team MUSD to the team buyer");
}

/** Submits a statement an outside inspector or carrier signed, after checking who signed it. */
async function relay(ctx: Ctx, input: string) {
  let json = input;
  if (input.startsWith("http")) {
    const param = new URL(input).searchParams.get("statement");
    if (!param) throw new Error("no statement in this link");
    json = Buffer.from(param, "base64url").toString("utf8");
  }
  const s = JSON.parse(json) as Record<string, string | number>;
  if (!isAddressEqual(getAddress(String(s.escrow)), live.escrow))
    throw new Error("statement is for another escrow");
  const id = BigInt(s.dealId!);
  const kind = Number(s.kind) as 1 | 2;
  const evidenceHash = s.evidenceHash as Hex;
  const issuedAt = BigInt(s.issuedAt!);
  const signature = s.signature as Hex;
  const deal = await readDeal(ctx, id);
  const expected = kind === 1 ? deal.terms.inspector : deal.terms.carrier;
  const signer = await recoverTypedDataAddress({
    domain: { name: "Wasit", version: "1", chainId: chain.id, verifyingContract: live.escrow },
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
    message: { dealId: id, kind, evidenceHash, issuedAt, nonce: BigInt(deal.attestationNonce) },
    signature,
  });
  console.log(`signed by ${signer}; deal names ${expected}`);
  if (!isAddressEqual(signer, expected)) throw new Error("not signed by the named party");
  await ctx.call(
    `relay the signed ${kind === 1 ? "READY" : "SHIPPED"} statement`,
    ctx.accounts.deployer,
    {
      address: live.escrow,
      abi: ESCROW,
      functionName: "submitAttestation",
      args: [id, kind, evidenceHash, issuedAt, signature],
    },
  );
  return id;
}

/** Checks a participant's signed statement against the deal it names (PLAN 9.3). */
async function verify(ctx: Ctx, file: string) {
  const s = JSON.parse(readFileSync(file, "utf8")) as {
    message: string;
    address: Address;
    signature: Hex;
  };
  const ok = await verifyMessage({
    address: s.address,
    message: s.message,
    signature: s.signature,
  });
  if (!ok) throw new Error("the signature does not match the address");
  const field = (key: string) => s.message.match(new RegExp(`^${key}: (.+)$`, "m"))?.[1];
  const deal = field("Deal")?.match(/^#(\d+) on escrow (0x[0-9a-fA-F]{40}),/);
  const role = field("Role");
  const wallet = field("Wallet");
  if (!deal || !role || !isRole(role) || !wallet || !isAddress(wallet))
    throw new Error("not a statement");
  if (!isAddressEqual(wallet, s.address)) throw new Error("statement names another wallet");
  if (!isAddressEqual(getAddress(deal[2]!), live.escrow))
    throw new Error("statement is for another escrow");
  const id = BigInt(deal[1]!);
  const onChain = await readDeal(ctx, id);
  const named = onChain.terms[role];
  if (!isAddressEqual(named, s.address)) throw new Error(`deal ${id} names ${named} as ${role}`);
  if (team(ctx, s.address)) throw new Error("this is a team wallet");
  const step =
    role === "inspector"
      ? onChain.attestationNonce >= 1
      : role === "carrier"
        ? onChain.attestationNonce >= 2
        : true;
  console.log(`OK: ${s.address} signed this statement and is the ${role} of deal ${id}`);
  console.log(step ? "its step was accepted on chain" : "its step is not on chain yet");
  console.log(`city: ${field("City")}; describe as: ${field("Describe me as")}`);
}

const [command, ...args] = process.argv.slice(2);
const ctx = await connect();
if (command === "fund") {
  const [address, role] = args;
  if (!address || !isAddress(address) || !role || !isRole(role))
    throw new Error(`usage: pilot fund <address> <${ROLES.join("|")}>`);
  if (team(ctx, address)) throw new Error("that is a team wallet");
  await fund(ctx, getAddress(address), role);
} else if (command === "deal") {
  const outside: Partial<Record<PilotRole, Address>> = {};
  for (const arg of args) {
    const [role, address] = arg.split("=");
    if (!role || !isRole(role) || !address || !isAddress(address))
      throw new Error(`bad argument ${arg}; use <role>=<address>`);
    if (team(ctx, address)) throw new Error(`${address} is a team wallet, not an outside one`);
    outside[role] = getAddress(address);
  }
  if (Object.keys(outside).length === 0) throw new Error("name at least one outside address");
  const id = await createDeal(ctx, outside);
  await next(ctx, id);
} else if (command === "next" && args[0]) {
  await next(ctx, BigInt(args[0]));
} else if (command === "relay" && args[0]) {
  await next(ctx, await relay(ctx, args[0]));
} else if (command === "verify" && args[0]) {
  await verify(ctx, args[0]);
} else {
  throw new Error("usage: pilot fund|deal|next|relay|verify … (see the header of src/pilot.ts)");
}
console.log(JSON.stringify(ctx.sent, null, 2));
