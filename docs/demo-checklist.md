# Demo checklist

Click path for the 2-minute video, on Mezo testnet. Every scene is a real transaction except the
price drop, which runs on the demo-sim deployment and is labeled "Simulated price feed" on screen.

## Before recording

- [ ] Six wallet accounts on Mezo testnet (chain 31611), one per role: buyer, supplier, bond
      poster (sourcing agent), inspector, carrier, arbiter. Separate browser profiles make the
      switches quicker to film.
- [ ] Balances: the buyer needs at least **130 MUSD** (100 for the happy path, 30 for the default
      scene), the agent about **0.0012 BTC** for two bonds, every role a little BTC for gas
      (one transaction costs about 1e-10 BTC). The seed script tops these up:
      `pnpm --filter @wasit/scripts seed fund`.
- [ ] Use an order of **100 MUSD (30% upfront)**. That is the size the testnet wallets can fund.
      Say "a 100 MUSD order" or show the percentages; do not show a larger invoice as if it ran.
- [ ] Screen at 1440×900, browser zoom 100%. Explorer tab open on
      `https://explorer.test.mezo.org`.
- [ ] Backup deals, already on-chain, in case a live step is slow:
      - live #2: happy path, released
      - live #3: supplier default, bond refunded the advance
      - demo-sim #1: bond protected after a simulated price drop
      - live #4: open dispute for the arbiter console

## Scene 1: create (buyer)

1. `/deals/new`, connect the buyer wallet.
2. **Order**: 100 MUSD, upfront 30%. Attach any terms file (it is hashed on the device).
3. **People**: supplier, inspector, carrier, arbiter addresses.
4. **Protection**: BTC bond on, 150%, posted by the agent.
5. **Deadlines**: *Fast demo* (production, balance and shipping 10 min, challenge 1 min).
6. **Review deal** → **Create deal** → open the deal page.

## Scene 2: bond and advance

1. Supplier wallet: deal page → **Accept terms**.
2. Arbiter wallet: **Accept role**.
3. Agent wallet: bond panel → **Post bond** (amount prefilled 1% above 150%). Two wallet
   prompts: approve BTC, then post. Point at the gauge (≈151%) and the BTC price.
4. Buyer wallet: **Pay 30 MUSD**. One permit signature, then one transaction (approve + pay if the
   wallet cannot sign permits). Point at the ledger: 29.85 MUSD to the supplier, 0.15 fee held.

## Scene 3: happy path

1. Inspector wallet: deal page → **Open signing page** → choose a file → **Sign statement** →
   **Submit now**.
2. Buyer wallet: **Pay 70 MUSD** (balance into escrow).
3. Carrier wallet: same signing page, *goods shipped*.
4. Wait the 1-minute challenge window (the banner counts down), then any wallet:
   **Release to supplier**. Or buyer: **Accept and release** straight away.
5. Show the ledger and one explorer link.

## Scene 4: supplier default

1. Buyer creates a second deal with **Custom** deadlines: production **1 minute**. Supplier and
   arbiter accept, agent posts the bond, buyer pays the advance (as in scene 2).
2. After a minute any wallet: **Claim default** (two clicks).
3. Show the ledger: 0.15 MUSD back from escrow, 29.85 MUSD from the bond, BTC surplus back to
   the agent. If the pool is slow, cut to live #3.

## Scene 5: protection (labeled simulated)

Run `pnpm --filter @wasit/scripts seed protect` shortly before recording. It makes a new
demo-sim deal, drops the simulated price to 85% then 75%, and protects the bond. Film
`/deals/<id>?deployment=mezo-testnet-demo-sim`: the yellow "Simulated price feed" banner, the
gauge, and the timeline showing the BTC sold for MUSD. Or film demo-sim #1, which went through
the same steps.

## Optional: arbiter console

`/arbiter/4`: paste the buyer's reason (below) to show it matches the on-chain hash, then move the
sliders to show who receives what. Only the arbiter wallet can sign the ruling, and a ruling is
final, so preview without signing.

> Demo dispute: 200 of the 1,000 tiles arrived cracked. Inspection photos sent to the arbiter.

## Words to avoid

Use the README wording, "BTC-secured, with limits", and make no absolute promise of safety. A
document hash shows a file was not changed; it does not prove shipment.
