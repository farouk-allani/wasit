import {
  BPS,
  MAX_BOND_RATIO_BPS,
  MAX_PERIOD,
  MIN_BOND_RATIO_BPS,
  MIN_PERIOD,
  type DealTerms,
} from "@wasit/sdk";
import {
  isAddress,
  isAddressEqual,
  keccak256,
  parseUnits,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { z } from "zod";
import { MUSD_DECIMALS } from "@/lib/format";

export const PERIOD_UNITS = { minutes: 60, hours: 3_600, days: 86_400 } as const;
export type PeriodUnit = keyof typeof PERIOD_UNITS;

/** The five deadlines of ARCHITECTURE §3, each relative to the previous milestone. */
export const PERIODS = [
  {
    key: "production",
    label: "Production",
    hint: "From advance paid until the inspector signs that goods are ready.",
  },
  {
    key: "balanceWindow",
    label: "Balance window",
    hint: "From inspection until you must fund the balance.",
  },
  {
    key: "shipping",
    label: "Shipping",
    hint: "From balance funded until the carrier signs that goods shipped.",
  },
  {
    key: "challenge",
    label: "Challenge window",
    hint: "After shipment, time you have to open a dispute before release.",
  },
  {
    key: "arbitration",
    label: "Arbitration",
    hint: "Time the arbiter has to decide a dispute.",
  },
] as const;
export type PeriodKey = (typeof PERIODS)[number]["key"];

const AMOUNT = /^\d+(\.\d{1,18})?$/;

const address = z
  .string()
  .trim()
  .refine((v) => isAddress(v, { strict: false }), "Enter a 0x address (42 characters).")
  .refine((v) => v.toLowerCase() !== zeroAddress, "The zero address cannot hold a role.");

const amount = z
  .string()
  .trim()
  .regex(AMOUNT, "Enter an amount like 1250 or 1250.50.")
  // regex failures do not stop later checks, and parseUnits throws on malformed input
  .refine((v) => !AMOUNT.test(v) || parseUnits(v, MUSD_DECIMALS) > 0n, "Must be above zero.")
  .refine(
    (v) => !AMOUNT.test(v) || parseUnits(v, MUSD_DECIMALS) < 2n ** 128n,
    "Amount is too large.",
  );

const period = z.object({
  value: z.string().trim().regex(/^\d+$/, "Whole numbers only."),
  unit: z.enum(["minutes", "hours", "days"]),
});

export const periodSeconds = (p: { value: string; unit: PeriodUnit }) =>
  Number(p.value) * PERIOD_UNITS[p.unit];

/**
 * The create-deal form, checked the way `_validateTerms` checks it on-chain (ADR-017) so the
 * wallet only opens for terms the escrow will accept. `buyer` is the connected wallet.
 */
export function dealFormSchema(buyer: Address | undefined) {
  return z
    .object({
      supplier: address,
      inspector: address,
      carrier: address,
      arbiter: address,
      advance: amount,
      balance: amount,
      bondEnabled: z.boolean(),
      bonder: z.string().trim(),
      bondRatioPct: z.string().trim(),
      periods: z.object({
        production: period,
        balanceWindow: period,
        shipping: period,
        challenge: period,
        arbitration: period,
      }),
      termsHash: z.string().regex(/^0x[0-9a-f]{64}$/i, "Attach the terms document."),
      termsFileName: z.string(),
    })
    .superRefine((v, ctx) => {
      const same = (a: string, b: string | undefined) =>
        b !== undefined && isAddress(a) && isAddress(b) && isAddressEqual(a, b);
      if (same(v.supplier, buyer))
        ctx.addIssue({
          code: "custom",
          path: ["supplier"],
          message: "You cannot be the supplier.",
        });
      if (same(v.arbiter, buyer))
        ctx.addIssue({ code: "custom", path: ["arbiter"], message: "You cannot be the arbiter." });
      if (same(v.arbiter, v.supplier))
        ctx.addIssue({
          code: "custom",
          path: ["arbiter"],
          message: "The supplier cannot be the arbiter.",
        });

      for (const { key } of PERIODS) {
        const seconds = periodSeconds(v.periods[key]);
        if (seconds < MIN_PERIOD || seconds > MAX_PERIOD)
          ctx.addIssue({
            code: "custom",
            path: ["periods", key, "value"],
            message: "Between 1 minute and 365 days.",
          });
      }

      if (!v.bondEnabled) return;
      const bonder = address.safeParse(v.bonder);
      if (!bonder.success)
        ctx.addIssue({
          code: "custom",
          path: ["bonder"],
          message: bonder.error.issues[0]?.message,
        });
      const ratio = Number(v.bondRatioPct);
      const min = MIN_BOND_RATIO_BPS / 100;
      const max = MAX_BOND_RATIO_BPS / 100;
      if (!/^\d+$/.test(v.bondRatioPct) || ratio < min || ratio > max)
        ctx.addIssue({
          code: "custom",
          path: ["bondRatioPct"],
          message: `Whole percent between ${min}% and ${max}%.`,
        });
    });
}

/** What the form holds (strings as typed) and what validation hands back (addresses checked). */
export type DealFormInput = z.input<ReturnType<typeof dealFormSchema>>;
export type DealFormValues = z.output<ReturnType<typeof dealFormSchema>>;

/** Starting values: short demo-friendly periods would surprise a real buyer, so days. */
export const DEFAULT_VALUES: DealFormInput = {
  supplier: "",
  inspector: "",
  carrier: "",
  arbiter: "",
  advance: "",
  balance: "",
  bondEnabled: true,
  bonder: "",
  bondRatioPct: "150", // as in the demo script
  periods: {
    production: { value: "30", unit: "days" },
    balanceWindow: { value: "7", unit: "days" },
    shipping: { value: "14", unit: "days" },
    challenge: { value: "3", unit: "days" },
    arbitration: { value: "14", unit: "days" },
  },
  termsHash: "",
  termsFileName: "",
};

/** Validated form values → the `createDeal` argument. Amounts are exact bigints. */
export function toDealTerms(
  v: DealFormValues,
  ctx: { buyer: Address; token: Address; feeBps: number },
): DealTerms {
  const seconds = (key: PeriodKey) => periodSeconds(v.periods[key]);
  return {
    buyer: ctx.buyer,
    supplier: v.supplier,
    inspector: v.inspector,
    carrier: v.carrier,
    arbiter: v.arbiter,
    bonder: v.bondEnabled ? (v.bonder as Address) : zeroAddress,
    token: ctx.token,
    advanceAmount: parseUnits(v.advance, MUSD_DECIMALS),
    balanceAmount: parseUnits(v.balance, MUSD_DECIMALS),
    feeBps: ctx.feeBps,
    bondRatioBps: v.bondEnabled ? Number(v.bondRatioPct) * 100 : 0,
    productionPeriod: seconds("production"),
    balanceWindow: seconds("balanceWindow"),
    shippingPeriod: seconds("shipping"),
    challengeWindow: seconds("challenge"),
    arbitrationPeriod: seconds("arbitration"),
    termsHash: v.termsHash as Hex,
  };
}

/** Fee the escrow keeps on an amount, rounded down like `_fee` (ADR-018). */
export const feeOn = (amount: bigint, feeBps: number) => (amount * BigInt(feeBps)) / BigInt(BPS);

/** keccak256 of a file's bytes, computed in the browser; the file never leaves the device. */
export async function hashFile(file: Blob): Promise<Hex> {
  return keccak256(new Uint8Array(await file.arrayBuffer()));
}
