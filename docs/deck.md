# Wasit deck outline (Wave 1)

Nine slides. Each one has a title, what is on the slide, and one line to say. Numbers on slides
come from the testnet deployment or the README; nothing here is a projection.

## 1. Wasit

- **Protecting advance payments in stablecoin trade.** Built on Mezo.
- Visual: the night globe from the landing page, with the wordmark.
- Say: "Wasit means the trusted middleman. Here the middleman is a set of contracts with a BTC bond."

## 2. The problem

- Importers already pay foreign suppliers in stablecoins: faster than wires, no dollar shortage.
- Usual terms: 30% production deposit, 70% before shipping.
- The deposit leaves before any goods exist, and a stablecoin transfer cannot be undone.
- Fallbacks: a letter of credit (slow, costly, often refused to small firms) or a marketplace's own
  payment protection (only on that marketplace).
- Say: "The biggest risk sits in the deposit, and today nobody holds it."

## 3. How Wasit works

- Terms, people and deadlines are fixed before money moves: buyer, supplier, inspector, carrier,
  arbiter, bond poster.
- The supplier or their sourcing agent posts a **BTC bond** (e.g. 150% of the net advance).
- The advance goes **straight to the supplier**; the balance waits in **MUSD escrow**.
- The balance is released after the inspector and the carrier sign, plus a challenge window.
- Visual: the four-step deal flow from the app.

## 4. When things go wrong

| If… | Then |
|---|---|
| Supplier misses a deadline | Escrow refunds what it holds; the bond pays the advance back |
| Buyer does not fund the balance | Supplier keeps the advance |
| Buyer disputes | Named arbiter splits the balance and the bond refund |
| BTC falls | Top-up warning at 130%; anyone can convert the bond to MUSD below 115% |

- Say: "Every exit is written into the deal at creation, and none of them can be paused."

## 5. Built on Mezo

- **MUSD**: the settlement currency, with EIP-2612 permits.
- **BTC on Mezo**: bond collateral (ERC-20 precompile).
- **Skip BTC/USD**: prices the bond (Pyth adapter ready as an alternative).
- **Mezo Router**: sells bond BTC for MUSD on protection or refund, with an oracle-bounded minimum.
- **Mezo Passport**: Bitcoin and EVM wallets.
- Say: "Each deal is new MUSD demand from people who trade goods, not tokens."

## 6. Live on testnet

- Four seeded deals with real transactions: released, supplier default refunded by the bond, bond
  protection (on a labeled simulated price), open dispute.
- App: create a deal, deal page with ledger and bond gauge, signing page, arbiter console.
- Contracts verified on the Mezo testnet explorer. Unit, fuzz, invariant and fork tests; 100% line
  coverage of the contracts.
- Visual: the deal page of live #3 (ledger showing the bond refund).

## 7. Safety and limits

- The owner can never move deal funds or bond collateral and cannot pause exits. No proxies.
- Refunds from escrow never depend on the bond or its oracle.
- No borrowing, no yield on held funds.
- **Limits:** a fast BTC crash can leave the bond short of the advance; MUSD is valued at 1 USD;
  signatures are only as good as the people named; testnet, not audited.
- Say: "BTC-secured, with limits, and the app shows the coverage at all times."

## 8. Who it is for

- First users: **sourcing agents** who already coordinate buyers, factories and inspections. They
  can post bonds for suppliers who hold no BTC, and bring many deals.
- Then the importer SMEs and suppliers they work with.
- Business model to test: a fee of 0.5% on value actually settled to the supplier, none on refunds.

## 9. Next

- Wave 2: pilot with sourcing agents, Arabic and French interface, an indexer, MUSD depeg guard,
  optional BTC payout.
- Later: external security review, then a first live corridor after a legal check.
- Links: GitHub · app · demo video.
