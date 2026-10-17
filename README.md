# Wasit

Wasit (وسيط, "the trusted middleman") protects advance payments in stablecoin trade on Mezo.
A buyer's production advance can be secured by a BTC bond, and the balance waits in MUSD
escrow until named parties sign off.

> Work in progress for the Mezo Buildathon (Wave 1). Testnet only, unaudited.

## Layout

| Path | Contents |
|---|---|
| `contracts/` | Foundry project (Solidity 0.8.28) |
| `apps/` | Web app |
| `packages/` | Shared TypeScript packages |

## Security model

- The owner configures **new** deals and bonds only. It can never move deal funds or bond
  collateral, change an existing deal, or pause an exit. No upgradeable proxies.
- Refunds of escrowed MUSD never depend on the bond or its oracle; a failed bond call is recorded
  and anyone can retry it.
- The bond never sells BTC without a fresh, non-zero oracle price, and every sale has an
  oracle-bounded minimum output.
- Not audited. Internal reviews, test strategy and accepted risks: [docs/security-review.md](docs/security-review.md).

## License

[MIT](LICENSE)
