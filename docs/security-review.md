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

## Wave 2 review (14 Nov 2026): trove bond, PriceFeed adapter, test wallet

A focused internal review of what Wave 2 added. Still not a third-party audit.

**How it was checked.** `TroveBond` and `TroveVault` were designed against the verified source of
Mezo's BorrowerOperations and TroveManager (ADR-036), then tested three ways: unit tests through the
real, unchanged escrow over a mock MUSD system that follows that source; a fork test where a contract
opens, tops up and closes a real trove on Mezo testnet; and an invariant suite that mixes posts,
top-ups, price crashes, liquidations, redemptions, interest, recovery mode, claims, releases and
closes. After every call it checks that each live vault holds at least its covered amount in MUSD,
that claims pay exactly `min(amount, covered)`, and that the bond contract and closed vaults hold
nothing. 309 contract tests, 100% line and branch coverage. One live trove deal ran on testnet, and
an outside redemption hit it mid-deal: the buyer was paid in full and the bond poster got the rest.

**What the review looked at, and what it found.**

| ID | Severity | Finding | Status |
|---|---|---|---|
| W2-1 | Low | If the bond poster is a contract that cannot receive BTC, `close` reverts and the BTC stays in the vault | Accepted: the poster chooses its own address; use an address that accepts BTC |
| W2-2 | Low | A trove keeps accruing interest until it is closed; a poster who never closes slowly drifts toward liquidation (their BTC, not the buyer's cover) | Accepted and documented: close promptly after release or claim |
| W2-3 | Info | A trove opened near 110% is among the first redeemed (seen live). The poster gets the surplus BTC back, but the trove ends early | Documented; the app suggests about 200% |
| W2-4 | Info | After `withdraw` before the advance, the deal cannot get a new trove bond; it can only be cancelled | Accepted: same outcome as with the BTC bond |
| W2-5 | Info | Closing waits while Mezo is in recovery mode | By design of the MUSD system; `claim` and `release` never touch the trove, so the buyer is never blocked |
| W2-6 | Low | The test wallet keeps its key in the browser's local storage, so script running on wasit.app (for example after an XSS bug) could read it | Accepted for a test-network wallet holding no real value; it refuses every chain but Mezo testnet; never import a key that holds real funds |
| W2-7 | Info | An invite link's `from=` name is shown as "X invited you" and could be set to anything | Limited to 40 characters and shown as plain text; the deal's own addresses are on the page |

**Static analysis.** Slither (102 detectors) on the new contracts: an "arbitrary from" in
`TroveBond.close` was a false positive (the caller must be the bonder) and now pulls from the caller;
"state written after external calls" in `close` was fixed by writing first (the deployed testnet
contract has the earlier order, protected by `nonReentrant` with the same behavior); unused return
values, the low-level call that sends native BTC, a missing zero check on the bonder (never zero) and
a parameter name copied from Mezo's interface are intended.

**Checks that passed.** Every function that moves assets is `nonReentrant`, and state changes happen
before external calls. Only the escrow can `claim` or `release`; only the named poster can `post`,
`withdraw` or `close`; each vault answers only its own `TroveBond`. `release` makes no external call,
so it cannot fail. MUSD or BTC sent straight to a vault only ends up with the poster. The coverage
target is rounded up. The PriceFeed adapter turns any feed failure into `PriceUnavailable` and never
returns a price the MUSD system would refuse. The test wallet signs typed data only when its domain
names chain 31611 (a missing chain id is refused), refuses transactions and chain switches to other
chains, signs transactions only for Mezo testnet (EIP-155), refuses `eth_sign`, forwards only
read-only calls, is not announced to other sites (no EIP-6963), and is connected only from the join,
invite and statement pages.

## What the owner can and cannot do

- **Can, for new deals and bonds only:** set the fee recipient, set the fee (hard cap 1%),
  allow settlement tokens, pause creation of new deals, choose the oracle, swap adapter, ratios
  and slippage tolerance (hard cap 10%) used by bonds posted afterwards.
- **Cannot:** move deal funds or bond collateral, change any existing deal or bond, or pause any
  exit. Release, refunds, default claims, dispute rulings and bond settlement keep working while
  new deals are paused. There is no upgradeable proxy.

**Trove mode (`TroveBond`, Wave 2) has no owner at all.** Nothing in it can be configured after
deployment, nothing can be paused, and only the escrow (claim, release) and the named bond poster
(withdraw before the advance, close) can make a vault move assets. Each vault answers only the
`TroveBond` that created it.

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
- **In trove mode, Mezo's MUSD borrowing system.** The bond relies on BorrowerOperations and
  TroveManager behaving as their verified source does; BorrowerOperations is an upgradeable proxy
  under Mezo governance (7-day delay on rate and minimum-debt changes). The buyer's cover is MUSD
  held in the vault, so a BTC fall, a liquidation or a redemption does not reduce it; those are the
  bond poster's risks. Closing a trove is refused while the system is in recovery mode (below 150%),
  which delays the poster's BTC, never the buyer. MUSD's PriceFeed, which prices trove health and
  new bonds, wraps the same Skip feed and refuses prices older than 60 seconds.

## Found a problem?

Open a GitHub issue, or for anything sensitive contact the maintainer privately through the
profile linked in the README.
