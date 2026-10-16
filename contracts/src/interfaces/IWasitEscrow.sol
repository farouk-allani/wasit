// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AttestationKind, BondSettlement, Deal, DealState, DealTerms} from "../libraries/WasitTypes.sol";

/// @title IWasitEscrow
/// @notice Trade deals with an advance paid straight to the supplier (optionally secured by a BTC
///         bond) and a balance held in escrow until signed attestations and a challenge window.
///         See ARCHITECTURE §3–§6 for the state machine and the money table.
interface IWasitEscrow {
    // ───────────────────────────── Events ─────────────────────────────

    /// @notice A buyer created a deal.
    event DealCreated(
        uint256 indexed dealId,
        address indexed buyer,
        address indexed supplier,
        address token,
        uint256 advanceAmount,
        uint256 balanceAmount,
        bytes32 termsHash
    );
    /// @notice The supplier accepted the terms.
    event DealAccepted(uint256 indexed dealId, address indexed supplier);
    /// @notice The arbiter accepted the role.
    event ArbiterAccepted(uint256 indexed dealId, address indexed arbiter);
    /// @notice The deal was cancelled; `refundedToBuyer` counts everything returned to the buyer.
    event DealCancelled(uint256 indexed dealId, address indexed by, uint256 refundedToBuyer);
    /// @notice The buyer paid the advance: `toSupplier` went to the supplier, `feeHeld` stays escrowed.
    event AdvanceFunded(uint256 indexed dealId, uint256 toSupplier, uint256 feeHeld);
    /// @notice A named attestor's signed statement was accepted.
    event Attested(
        uint256 indexed dealId,
        AttestationKind indexed kind,
        address indexed signer,
        bytes32 evidenceHash,
        uint64 issuedAt
    );
    /// @notice The buyer escrowed the balance.
    event BalanceFunded(uint256 indexed dealId, uint256 amount);
    /// @notice The buyer disputed the shipment.
    event Disputed(uint256 indexed dealId, bytes32 reasonHash);
    /// @notice The arbitration period ended without a ruling; the balance is released to the supplier.
    event DisputeLapsed(uint256 indexed dealId);
    /// @notice The balance was released to the supplier. `fee` is everything the protocol earned on
    ///         the deal (held advance fee + balance fee).
    event Released(uint256 indexed dealId, uint256 toSupplier, uint256 fee);
    /// @notice The arbiter ruled.
    event Resolved(
        uint256 indexed dealId, uint256 toSupplier, uint256 toBuyer, uint256 advanceRefundRequested, uint256 fee
    );
    /// @notice A supplier deadline was missed; escrowed funds were refunded and the bond claimed.
    event SupplierDefaulted(uint256 indexed dealId, uint256 refundedToBuyer, uint256 bondClaimRequested);
    /// @notice The buyer missed the balance deadline; the supplier keeps the advance.
    event BuyerDefaulted(uint256 indexed dealId, uint256 fee);
    /// @notice A bond release or claim succeeded (`paid` is 0 for a release).
    event BondSettled(uint256 indexed dealId, BondSettlement action, uint256 paid);
    /// @notice A bond call failed; anyone can retry it with `retryBondSettlement`.
    event BondSettlementFailed(uint256 indexed dealId, BondSettlement action, bytes reason);
    /// @notice Earned fees were sent to the fee recipient.
    event FeesWithdrawn(address indexed token, address indexed recipient, uint256 amount);
    /// @notice New fee recipient.
    event FeeRecipientSet(address indexed recipient);
    /// @notice New default fee for deals created from now on.
    event DefaultFeeSet(uint16 feeBps);
    /// @notice A settlement token was added to or removed from the allow-list (new deals only).
    event TokenAllowed(address indexed token, bool allowed);

    // ───────────────────────────── Errors ─────────────────────────────

    /// @notice A required address is zero.
    error ZeroAddress();
    /// @notice Buyer equals supplier, or the arbiter is one of them.
    error ConflictingParties();
    /// @notice The settlement token is not allow-listed.
    error TokenNotAllowed(address token);
    /// @notice An amount is zero.
    error ZeroAmount();
    /// @notice A period is outside [MIN_PERIOD, MAX_PERIOD].
    error InvalidPeriod();
    /// @notice The fee in the terms differs from the current default fee.
    error FeeMismatch(uint16 expected, uint16 provided);
    /// @notice The fee exceeds the hard cap.
    error FeeTooHigh(uint16 feeBps);
    /// @notice The terms hash is zero.
    error MissingTermsHash();
    /// @notice The bond ratio is out of bounds, or set without a bonder.
    error InvalidBondRatio(uint16 bondRatioBps);
    /// @notice The deal is not in a state that allows this action.
    error InvalidState(uint256 dealId, DealState state);
    /// @notice The caller does not hold the role this action needs.
    error Unauthorized(address caller);
    /// @notice The arbiter has not accepted the role yet.
    error ArbiterNotAccepted(uint256 dealId);
    /// @notice The bond is missing, not active, or below the required ratio.
    error BondNotReady(uint256 dealId);
    /// @notice The deadline for this action has passed.
    error DeadlinePassed(uint256 deadline);
    /// @notice The deadline that enables this action has not passed yet.
    error DeadlineNotReached(uint256 deadline);
    /// @notice The attestation kind does not match the deal's current step.
    error InvalidAttestationKind(AttestationKind kind);
    /// @notice The signature is not from the expected attestor.
    error InvalidSignature();
    /// @notice `issuedAt` is in the future or before the previous milestone.
    error InvalidIssuedAt(uint64 issuedAt);
    /// @notice A basis-point value exceeds 10_000.
    error InvalidBps(uint256 bps);
    /// @notice An advance refund was ordered on a deal without a bond.
    error NoBondForAdvanceRefund();
    /// @notice There is no failed bond call to retry.
    error NoPendingBondSettlement(uint256 dealId);
    /// @notice There are no fees to withdraw.
    error NothingToWithdraw();

    // ───────────────────────────── Deal lifecycle ─────────────────────────────

    /// @notice Creates a deal; the caller must be `terms.buyer`.
    /// @dev Validation per ARCHITECTURE §3. `terms.feeBps` must equal `defaultFeeBps()`.
    ///      Reverts while new deals are paused.
    /// @return dealId Id of the new deal (starts at 1).
    function createDeal(DealTerms calldata terms) external returns (uint256 dealId);

    /// @notice The supplier accepts the terms. Created → Accepted.
    function accept(uint256 dealId) external;

    /// @notice The arbiter accepts the role. Allowed while Created or Accepted.
    function acceptArbiter(uint256 dealId) external;

    /// @notice Buyer or supplier cancels before the advance is funded. Releases a posted bond.
    function cancel(uint256 dealId) external;

    /// @notice The buyer pays the advance. Accepted → AdvancePaid.
    /// @dev Requires the arbiter's acceptance and, if a bonder is set, an Active bond at or above
    ///      `bondRatioBps`. Sends `netAdvance` to the supplier and holds the advance fee.
    function fundAdvance(uint256 dealId) external;

    /// @notice Same as `fundAdvance`, approving the token with an EIP-2612 permit first.
    /// @dev A failing permit is ignored (it may have been front-run); the transfer then needs an
    ///      existing allowance.
    function fundAdvanceWithPermit(uint256 dealId, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;

    /// @notice Submits an attestation signed by the deal's inspector (READY_INSPECTED) or carrier
    ///         (SHIPPED). Anyone may submit. EOA and ERC-1271 signatures are accepted.
    /// @dev READY_INSPECTED: AdvancePaid → GoodsReady, until `readyBy`.
    ///      SHIPPED: BalanceFunded → Shipped, until `shipBy`.
    function submitAttestation(
        uint256 dealId,
        AttestationKind kind,
        bytes32 evidenceHash,
        uint64 issuedAt,
        bytes calldata signature
    ) external;

    /// @notice The buyer escrows the balance. GoodsReady → BalanceFunded, until `balanceDue`.
    function fundBalance(uint256 dealId) external;

    /// @notice Same as `fundBalance`, approving the token with an EIP-2612 permit first.
    function fundBalanceWithPermit(uint256 dealId, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;

    /// @notice Releases the balance to the supplier. Anyone may call: from Shipped after
    ///         `challengeEnds`, or from Disputed after `ruleBy` without a ruling.
    function release(uint256 dealId) external;

    /// @notice The buyer confirms the goods early. Shipped → Released.
    function acceptGoods(uint256 dealId) external;

    /// @notice The buyer disputes the shipment until `challengeEnds`. Shipped → Disputed.
    function dispute(uint256 dealId, bytes32 reasonHash) external;

    /// @notice The arbiter rules until `ruleBy`. Disputed → Resolved.
    /// @param toSupplierBps Share of the escrowed balance paid to the supplier.
    /// @param advanceRefundBps Share of the advance returned to the buyer (bond + held fee).
    function resolve(uint256 dealId, uint16 toSupplierBps, uint16 advanceRefundBps) external;

    /// @notice Anyone settles a missed supplier deadline (`readyBy` or `shipBy`).
    ///         Refunds escrowed funds to the buyer and claims the net advance from the bond.
    function claimSupplierDefault(uint256 dealId) external;

    /// @notice Anyone settles a missed `balanceDue`. The supplier keeps the advance.
    function claimBuyerDefault(uint256 dealId) external;

    /// @notice The supplier returns the net advance (pulled from the supplier) and cancels.
    ///         Allowed from AdvancePaid, GoodsReady or BalanceFunded.
    function refundAndCancel(uint256 dealId) external;

    /// @notice Retries a bond release or claim that failed earlier. Anyone may call.
    function retryBondSettlement(uint256 dealId) external;

    /// @notice Sends earned fees in `token` to the fee recipient. Anyone may call.
    function withdrawFees(address token) external;

    // ───────────────────────────── Admin (new deals only) ─────────────────────────────

    /// @notice Sets who receives earned fees.
    function setFeeRecipient(address recipient) external;

    /// @notice Sets the fee for deals created from now on (≤ MAX_FEE_BPS).
    function setDefaultFee(uint16 feeBps) external;

    /// @notice Adds or removes a settlement token for new deals.
    function setTokenAllowed(address token, bool allowed) external;

    /// @notice Pauses deal creation. Every other function keeps working.
    function pause() external;

    /// @notice Resumes deal creation.
    function unpause() external;

    // ───────────────────────────── Views ─────────────────────────────

    /// @notice The stored deal (state None if it does not exist).
    function getDeal(uint256 dealId) external view returns (Deal memory);

    /// @notice What the bond contract needs: bonder, covered amount (net advance), ratio, state.
    function bondTerms(uint256 dealId)
        external
        view
        returns (address bonder, uint256 covered, uint16 ratioBps, DealState state);

    /// @notice Absolute deadlines derived from the milestones reached so far (0 if not started).
    function deadlines(uint256 dealId)
        external
        view
        returns (uint256 readyBy, uint256 balanceDue, uint256 shipBy, uint256 challengeEnds, uint256 ruleBy);

    /// @notice EIP-712 digest an attestor signs for the given attestation.
    function attestationDigest(
        uint256 dealId,
        AttestationKind kind,
        bytes32 evidenceHash,
        uint64 issuedAt,
        uint256 nonce
    ) external view returns (bytes32);

    /// @notice Bond contract that secures advances.
    function bond() external view returns (address);

    /// @notice Recipient of earned fees.
    function feeRecipient() external view returns (address);

    /// @notice Fee that new deals must carry.
    function defaultFeeBps() external view returns (uint16);

    /// @notice Whether `token` can settle new deals.
    function isTokenAllowed(address token) external view returns (bool);

    /// @notice Earned, not yet withdrawn fees in `token`.
    function accruedFees(address token) external view returns (uint256);

    /// @notice Id the next deal will get.
    function nextDealId() external view returns (uint256);
}
