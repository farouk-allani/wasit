// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IPriceOracle} from "../interfaces/IPriceOracle.sol";
import {ISwapAdapter} from "../interfaces/ISwapAdapter.sol";

/// @notice Lifecycle of a deal. Values only move forward; the last five are terminal.
enum DealState {
    None,
    Created,
    Accepted,
    AdvancePaid,
    GoodsReady,
    BalanceFunded,
    Shipped,
    Disputed,
    Released,
    Resolved,
    SupplierDefaulted,
    BuyerDefaulted,
    Cancelled
}

/// @notice Statement types an attestor can sign. The numeric value is the EIP-712 `kind`.
enum AttestationKind {
    None,
    ReadyInspected,
    Shipped
}

/// @notice Bond call the escrow still owes after a failed attempt (see `retryBondSettlement`).
enum BondSettlement {
    None,
    Release,
    Claim
}

/// @notice Status of a deal's bond.
enum BondStatus {
    None,
    Active,
    Protected,
    Claimed,
    Released
}

/// @notice Terms fixed when the buyer creates a deal. Periods are in seconds and relative to the
///         previous milestone (see ARCHITECTURE §3).
struct DealTerms {
    address buyer;
    address supplier;
    address inspector; // signs READY_INSPECTED
    address carrier; // signs SHIPPED
    address arbiter;
    address bonder; // address(0) = no bond
    address token; // allow-listed settlement token (MUSD)
    uint128 advanceAmount; // paid to the supplier when funded
    uint128 balanceAmount; // escrowed until release
    uint16 feeBps; // must equal the escrow's default fee at creation
    uint16 bondRatioBps; // required coverage of the net advance; 0 without bond
    uint32 productionPeriod; // advance paid → READY_INSPECTED
    uint32 balanceWindow; // READY_INSPECTED → balance funded
    uint32 shippingPeriod; // balance funded → SHIPPED
    uint32 challengeWindow; // SHIPPED → end of the dispute window
    uint32 arbitrationPeriod; // dispute → end of the arbiter's window
    bytes32 termsHash; // keccak256 of the off-chain terms document
}

/// @notice A deal as stored by the escrow.
struct Deal {
    DealTerms terms;
    DealState state;
    bool arbiterAccepted;
    uint8 attestationNonce; // accepted attestations so far (0, 1, 2)
    BondSettlement bondPending; // bond call that failed and awaits a retry
    uint64 advancePaidAt;
    uint64 readyAt;
    uint64 balanceFundedAt;
    uint64 shippedAt;
    uint64 disputedAt;
    uint128 balanceHeld; // balance escrowed for this deal
    uint128 advanceFeeHeld; // advance fee escrowed until the deal settles
    uint128 bondClaimAmount; // amount to claim when bondPending == Claim
}

/// @notice A deal's bond as stored by the bond contract. Config values are snapshots taken at post.
struct Bond {
    address bonder;
    IPriceOracle oracle;
    ISwapAdapter swap;
    uint128 covered; // the deal's net advance
    uint128 btcHeld;
    uint128 musdHeld; // > 0 after a protective conversion
    uint16 initialRatioBps;
    uint16 topUpRatioBps;
    uint16 protectRatioBps;
    uint16 maxSlippageBps;
    BondStatus status;
}

/// @title WasitTypes
/// @notice Protocol-wide constants.
library WasitTypes {
    /// @notice Basis-point denominator.
    uint256 internal constant BPS = 10_000;
    /// @notice Hard cap on the protocol fee (1%).
    uint16 internal constant MAX_FEE_BPS = 100;
    /// @notice Shortest period allowed in deal terms.
    uint32 internal constant MIN_PERIOD = 1 minutes;
    /// @notice Longest period allowed in deal terms.
    uint32 internal constant MAX_PERIOD = 365 days;
    /// @notice Lowest bond coverage a deal may require (120% of the net advance).
    uint16 internal constant MIN_BOND_RATIO_BPS = 12_000;
    /// @notice Highest bond coverage a deal may require (500% of the net advance).
    uint16 internal constant MAX_BOND_RATIO_BPS = 50_000;
    /// @notice Hard cap on the slippage a bond may accept when selling BTC (ADR-016).
    uint16 internal constant MAX_SLIPPAGE_BPS = 1_000;
}
