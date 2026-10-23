# Security review (internal, pre-audit)

Wasit has **not** been audited by a third party. This page summarizes the two internal reviews
done during the Mezo Buildathon, what they found, and what you still have to trust.

## How the contracts were checked

- **Tests:** 263 unit, fuzz and invariant tests. Fuzz tests run 10,000 cases each in CI. Two
  invariant suites run random call sequences against the escrow and against the escrow + bond
  together (moving BTC prices, pool slippage, oracle outages, protections, top-ups).
- **Invariants checked after every random call:**
  - every token the escrow or the bond holds is accounted for, to the wei;
  - a finished deal holds no money and leaves no bond open (unless a bond settlement is waiting
    for a retry);
  - deals never move backwards and their terms never change, whatever the owner does;
  - a bond claim never pays more than the advance it secures.
- **Coverage:** 100% of lines and branches of every contract in `contracts/src`.
- **Static analysis:** Slither, no high-severity findings; every remaining result is explained in
  the code or below.
- **Live checks on Mezo testnet:** the Skip oracle adapter and the swap adapter were exercised
  against the real Skip feed, Router and MUSD/BTC pool (simulated transactions).

## Findings and fixes

| ID | Severity | Finding | Status |
|---|---|---|---|
| F-1 | Low | A caller could give a bond call too little gas, so it failed inside `try/catch` and the bond settlement had to be retried | Fixed: bond calls need 1,000,000 gas left |
| F-2 | Info | The permit versions of the funding functions called the token before checking the deal | Fixed: deal checked first |
| P-1 | Low | A claim asked the oracle for a price even when no BTC was left to sell, so an oracle outage delayed paying out MUSD already held | Fixed |
| P-2 | Low | Keeper swaps can be sandwiched up to the slippage tolerance | Accepted; tolerance is a deployment setting (testnet 6%, see below) |
| P-3 | Info | Each bond keeps the oracle and swap adapter it was posted with; if Mezo retires them, claims on old bonds wait | Accepted: the alternative would let the owner redirect bonds |

## What the owner can and cannot do

- **Can, for new deals and bonds only:** set the fee recipient, set the fee (hard cap 1%),
  allow settlement tokens, pause creation of new deals, choose the oracle, swap adapter, ratios
  and slippage tolerance (hard cap 10%) used by bonds posted afterwards.
- **Cannot:** move deal funds or bond collateral, change any existing deal or bond, or pause any
  exit. Release, refunds, default claims, dispute rulings and bond settlement keep working while
  new deals are paused. There is no upgradeable proxy.

## What you still trust

- **The people named in the deal.** The inspector and the carrier sign statements with a file
  fingerprint; a signature is not proof that goods exist or shipped. The buyer can dispute during
  the challenge window, and the arbiter both sides chose decides. If the arbiter never rules within
  the arbitration period, the shipment stands and the balance goes to the supplier.
- **The oracle.** Mezo's Skip BTC/USD feed prices the bond. The bond refuses stale or zero prices
  and never sells BTC without a fresh one.
- **The pool.** BTC is sold on Mezo's MUSD/BTC pool with a minimum output bounded by the oracle
  price minus the slippage tolerance. On testnet that tolerance is 6% because the testnet pool trades
  about 3.5% below the oracle; a mainnet deployment should use 1–2%.
- **The bond can fall short.** In a fast BTC crash the collateral can be worth less than the advance
  before anyone protects it. The buyer then receives what the bond holds, and the shortfall is
  reported on-chain.
- **MUSD is valued at 1 USD.**

## Found a problem?

Open a GitHub issue, or for anything sensitive contact the maintainer privately through the
profile linked in the README.
