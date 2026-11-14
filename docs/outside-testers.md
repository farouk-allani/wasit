# Deals signed by people outside the team

Last updated: 14 Nov 2026.

**No one outside the team has signed a Wasit deal yet.** The flow below is live at
[wasit.app/join](https://wasit.app/join); this page gets one row per person as soon as someone does.

## What counts as an outside signer

- The wallet's key was created on the person's own device: their own wallet, or the test wallet
  that [wasit.app/join](https://wasit.app/join) creates in their browser. The team never holds it.
- Any testnet funds the team sends to that address are listed below. An inspector or carrier needs
  none: they sign, and anyone can submit the signed statement.
- The person may also sign a plain-text statement with the same key (role, city, how they want to be
  described, "this wallet is mine", "test network, no real money"). Anyone can check it with
  `pnpm --filter @wasit/scripts pilot verify <file>`, which recovers the signer and checks that the
  deal names it and that its step was accepted on chain. This proves control of a key, not who the
  person is.
- People are described exactly as they ask to be ("a builder from another buildathon team", "works
  in freight"). They are never called customers, users, clients or pilot partners, and never sourcing
  agents or suppliers unless they are.

## Outside signers

| Who (as they asked to be described) | Role and deal | Wallet | Transactions | Statement | Testnet funds we sent |
|---|---|---|---|---|---|
| None yet | | | | | |

## Team dry runs (not outside signers)

These used test wallets the team created, so they are team wallets:

| Run | Deal | What it proved |
|---|---|---|
| Headless phone browser driven by the team, 13 Nov 2026 | live #7 | Join, invite, sign READY on a phone-sized screen, relay link, submission |
| Farouk's own phone, 14 Nov 2026 | live #8 | The same path from a real phone, with the signed statement sent over WhatsApp |

## Testnet funds sent to participants

Every transfer made with `pilot fund` is logged in [`pilot/funding.json`](pilot/funding.json).
None so far.
