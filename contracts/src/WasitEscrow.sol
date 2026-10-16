// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAdvanceBond} from "./interfaces/IAdvanceBond.sol";
import {IWasitEscrow} from "./interfaces/IWasitEscrow.sol";
import {
    AttestationKind,
    BondSettlement,
    BondStatus,
    Deal,
    DealState,
    DealTerms,
    WasitTypes
} from "./libraries/WasitTypes.sol";

/// @title WasitEscrow
/// @notice Advance-payment protection for stablecoin trade. The advance goes straight to the
///         supplier (secured by an optional BTC bond); the balance waits here until named parties
///         sign off and a challenge window passes. The owner configures new deals only and can
///         never move deal funds or block an exit.
contract WasitEscrow is IWasitEscrow, Ownable2Step, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    /// @dev Outcome of an arbiter ruling (see `resolve`).
    struct Split {
        uint256 toSupplier; // balance share minus its fee
        uint256 toBuyer; // escrowed part: balance not awarded + refunded share of the advance fee
        uint256 claimAmount; // part of the net advance claimed from the bond for the buyer
        uint256 earned; // protocol fee kept
    }

    /// @dev Temporary: functions of later build steps revert until they are implemented.
    error NotImplemented();

    /// @notice EIP-712 type of the attestation an inspector or carrier signs.
    bytes32 public constant ATTESTATION_TYPEHASH =
        keccak256("Attestation(uint256 dealId,uint8 kind,bytes32 evidenceHash,uint64 issuedAt,uint256 nonce)");

    IAdvanceBond private immutable _bond;

    /// @inheritdoc IWasitEscrow
    address public feeRecipient;
    /// @inheritdoc IWasitEscrow
    uint16 public defaultFeeBps;
    /// @inheritdoc IWasitEscrow
    uint256 public nextDealId = 1;
    /// @inheritdoc IWasitEscrow
    mapping(address token => bool) public isTokenAllowed;
    /// @inheritdoc IWasitEscrow
    mapping(address token => uint256) public accruedFees;

    mapping(uint256 dealId => Deal) private _deals;

    /// @param initialOwner Config owner (two-step transfer).
    /// @param bond_ Bond contract securing advances.
    /// @param feeRecipient_ Recipient of earned fees.
    /// @param defaultFeeBps_ Fee new deals must carry (≤ MAX_FEE_BPS).
    /// @param allowedTokens Settlement tokens allowed from the start (MUSD).
    constructor(
        address initialOwner,
        IAdvanceBond bond_,
        address feeRecipient_,
        uint16 defaultFeeBps_,
        address[] memory allowedTokens
    ) Ownable(initialOwner) EIP712("Wasit", "1") {
        if (address(bond_) == address(0) || feeRecipient_ == address(0)) revert ZeroAddress();
        if (defaultFeeBps_ > WasitTypes.MAX_FEE_BPS) revert FeeTooHigh(defaultFeeBps_);
        _bond = bond_;
        feeRecipient = feeRecipient_;
        defaultFeeBps = defaultFeeBps_;
        emit FeeRecipientSet(feeRecipient_);
        emit DefaultFeeSet(defaultFeeBps_);
        for (uint256 i; i < allowedTokens.length; ++i) {
            if (allowedTokens[i] == address(0)) revert ZeroAddress();
            isTokenAllowed[allowedTokens[i]] = true;
            emit TokenAllowed(allowedTokens[i], true);
        }
    }

    // ───────────────────────────── Deal lifecycle ─────────────────────────────

    /// @inheritdoc IWasitEscrow
    function createDeal(DealTerms calldata terms) external whenNotPaused returns (uint256 dealId) {
        if (msg.sender != terms.buyer) revert Unauthorized(msg.sender);
        _validateTerms(terms);

        dealId = nextDealId++;
        Deal storage d = _deals[dealId];
        d.terms = terms;
        d.state = DealState.Created;

        emit DealCreated(
            dealId, terms.buyer, terms.supplier, terms.token, terms.advanceAmount, terms.balanceAmount, terms.termsHash
        );
    }

    /// @inheritdoc IWasitEscrow
    function accept(uint256 dealId) external {
        Deal storage d = _dealIn(dealId, DealState.Created);
        if (msg.sender != d.terms.supplier) revert Unauthorized(msg.sender);
        d.state = DealState.Accepted;
        emit DealAccepted(dealId, msg.sender);
    }

    /// @inheritdoc IWasitEscrow
    /// @dev A repeated call is a no-op.
    function acceptArbiter(uint256 dealId) external {
        Deal storage d = _deals[dealId];
        if (d.state != DealState.Created && d.state != DealState.Accepted) revert InvalidState(dealId, d.state);
        if (msg.sender != d.terms.arbiter) revert Unauthorized(msg.sender);
        if (d.arbiterAccepted) return;
        d.arbiterAccepted = true;
        emit ArbiterAccepted(dealId, msg.sender);
    }

    /// @inheritdoc IWasitEscrow
    function cancel(uint256 dealId) external nonReentrant {
        Deal storage d = _deals[dealId];
        if (d.state != DealState.Created && d.state != DealState.Accepted) revert InvalidState(dealId, d.state);
        if (msg.sender != d.terms.buyer && msg.sender != d.terms.supplier) revert Unauthorized(msg.sender);
        d.state = DealState.Cancelled;
        emit DealCancelled(dealId, msg.sender, 0);
        if (d.terms.bonder != address(0)) _settleBond(dealId, d, BondSettlement.Release, 0);
    }

    /// @inheritdoc IWasitEscrow
    function fundAdvance(uint256 dealId) external nonReentrant {
        _fundAdvance(dealId);
    }

    /// @inheritdoc IWasitEscrow
    function fundAdvanceWithPermit(uint256 dealId, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
    {
        DealTerms storage t = _deals[dealId].terms;
        _tryPermit(t.token, t.advanceAmount, deadline, v, r, s);
        _fundAdvance(dealId);
    }

    /// @inheritdoc IWasitEscrow
    function submitAttestation(
        uint256 dealId,
        AttestationKind kind,
        bytes32 evidenceHash,
        uint64 issuedAt,
        bytes calldata signature
    ) external {
        Deal storage d = _deals[dealId];
        DealTerms storage t = d.terms;
        address signer;
        uint64 previous;
        uint256 deadline;
        if (kind == AttestationKind.ReadyInspected) {
            if (d.state != DealState.AdvancePaid) revert InvalidState(dealId, d.state);
            signer = t.inspector;
            previous = d.advancePaidAt;
            deadline = uint256(previous) + t.productionPeriod;
        } else if (kind == AttestationKind.Shipped) {
            if (d.state != DealState.BalanceFunded) revert InvalidState(dealId, d.state);
            signer = t.carrier;
            previous = d.balanceFundedAt;
            deadline = uint256(previous) + t.shippingPeriod;
        } else {
            revert InvalidAttestationKind(kind);
        }
        if (block.timestamp > deadline) revert DeadlinePassed(deadline);
        if (issuedAt > block.timestamp || issuedAt < previous) revert InvalidIssuedAt(issuedAt);
        bytes32 digest = _attestationDigest(dealId, kind, evidenceHash, issuedAt, d.attestationNonce);
        if (!SignatureChecker.isValidSignatureNow(signer, digest, signature)) revert InvalidSignature();

        d.attestationNonce += 1;
        if (kind == AttestationKind.ReadyInspected) {
            d.state = DealState.GoodsReady;
            d.readyAt = uint64(block.timestamp);
        } else {
            d.state = DealState.Shipped;
            d.shippedAt = uint64(block.timestamp);
        }
        emit Attested(dealId, kind, signer, evidenceHash, issuedAt);
    }

    /// @inheritdoc IWasitEscrow
    function fundBalance(uint256 dealId) external nonReentrant {
        _fundBalance(dealId);
    }

    /// @inheritdoc IWasitEscrow
    function fundBalanceWithPermit(uint256 dealId, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
    {
        DealTerms storage t = _deals[dealId].terms;
        _tryPermit(t.token, t.balanceAmount, deadline, v, r, s);
        _fundBalance(dealId);
    }

    /// @inheritdoc IWasitEscrow
    /// @dev An unresolved dispute lapses in the supplier's favor: the claimant (buyer) carries the
    ///      burden of proof, and the attested flow continues without a ruling (ADR-019).
    function release(uint256 dealId) external nonReentrant {
        Deal storage d = _deals[dealId];
        if (d.state == DealState.Shipped) {
            uint256 challengeEnds = uint256(d.shippedAt) + d.terms.challengeWindow;
            if (block.timestamp <= challengeEnds) revert DeadlineNotReached(challengeEnds);
        } else if (d.state == DealState.Disputed) {
            uint256 ruleBy = uint256(d.disputedAt) + d.terms.arbitrationPeriod;
            if (block.timestamp <= ruleBy) revert DeadlineNotReached(ruleBy);
            emit DisputeLapsed(dealId);
        } else {
            revert InvalidState(dealId, d.state);
        }
        _releaseToSupplier(dealId, d);
    }

    /// @inheritdoc IWasitEscrow
    function acceptGoods(uint256 dealId) external nonReentrant {
        Deal storage d = _dealIn(dealId, DealState.Shipped);
        if (msg.sender != d.terms.buyer) revert Unauthorized(msg.sender);
        _releaseToSupplier(dealId, d);
    }

    /// @inheritdoc IWasitEscrow
    function dispute(uint256 dealId, bytes32 reasonHash) external {
        Deal storage d = _dealIn(dealId, DealState.Shipped);
        if (msg.sender != d.terms.buyer) revert Unauthorized(msg.sender);
        uint256 challengeEnds = uint256(d.shippedAt) + d.terms.challengeWindow;
        if (block.timestamp > challengeEnds) revert DeadlinePassed(challengeEnds);
        d.state = DealState.Disputed;
        d.disputedAt = uint64(block.timestamp);
        emit Disputed(dealId, reasonHash);
    }

    /// @inheritdoc IWasitEscrow
    /// @dev Money per ARCHITECTURE §5: the supplier's share rounds down, refunds round up, fees round
    ///      down. The protocol keeps the advance fee only on the part of the advance not refunded.
    function resolve(uint256 dealId, uint16 toSupplierBps, uint16 advanceRefundBps) external nonReentrant {
        Deal storage d = _dealIn(dealId, DealState.Disputed);
        DealTerms storage t = d.terms;
        if (msg.sender != t.arbiter) revert Unauthorized(msg.sender);
        uint256 ruleBy = uint256(d.disputedAt) + t.arbitrationPeriod;
        if (block.timestamp > ruleBy) revert DeadlinePassed(ruleBy);
        if (toSupplierBps > WasitTypes.BPS) revert InvalidBps(toSupplierBps);
        if (advanceRefundBps > WasitTypes.BPS) revert InvalidBps(advanceRefundBps);
        bool bonded = t.bonder != address(0);
        if (advanceRefundBps != 0 && !bonded) revert NoBondForAdvanceRefund();

        Split memory s = _split(d, toSupplierBps, advanceRefundBps);
        d.state = DealState.Resolved;
        d.balanceHeld = 0;
        d.advanceFeeHeld = 0;
        accruedFees[t.token] += s.earned;
        emit Resolved(dealId, s.toSupplier, s.toBuyer, s.claimAmount, s.earned);

        IERC20 token = IERC20(t.token);
        if (s.toSupplier != 0) token.safeTransfer(t.supplier, s.toSupplier);
        if (s.toBuyer != 0) token.safeTransfer(t.buyer, s.toBuyer);
        if (bonded) {
            _settleBond(dealId, d, advanceRefundBps != 0 ? BondSettlement.Claim : BondSettlement.Release, s.claimAmount);
        }
    }

    /// @inheritdoc IWasitEscrow
    function claimSupplierDefault(uint256 dealId) external nonReentrant {
        Deal storage d = _deals[dealId];
        DealTerms storage t = d.terms;
        uint256 deadline;
        if (d.state == DealState.AdvancePaid) {
            deadline = uint256(d.advancePaidAt) + t.productionPeriod;
        } else if (d.state == DealState.BalanceFunded) {
            deadline = uint256(d.balanceFundedAt) + t.shippingPeriod;
        } else {
            revert InvalidState(dealId, d.state);
        }
        if (block.timestamp <= deadline) revert DeadlineNotReached(deadline);

        uint256 refund = uint256(d.balanceHeld) + d.advanceFeeHeld;
        bool bonded = t.bonder != address(0);
        uint256 claimAmount = bonded ? _netAdvance(t) : 0;
        d.state = DealState.SupplierDefaulted;
        d.balanceHeld = 0;
        d.advanceFeeHeld = 0;
        emit SupplierDefaulted(dealId, refund, claimAmount);

        // Escrowed money first: it must never depend on the bond or its oracle.
        if (refund != 0) IERC20(t.token).safeTransfer(t.buyer, refund);
        if (bonded) _settleBond(dealId, d, BondSettlement.Claim, claimAmount);
    }

    /// @inheritdoc IWasitEscrow
    function claimBuyerDefault(uint256 dealId) external nonReentrant {
        Deal storage d = _dealIn(dealId, DealState.GoodsReady);
        DealTerms storage t = d.terms;
        uint256 due = uint256(d.readyAt) + t.balanceWindow;
        if (block.timestamp <= due) revert DeadlineNotReached(due);

        uint256 fee = d.advanceFeeHeld;
        d.state = DealState.BuyerDefaulted;
        d.advanceFeeHeld = 0;
        accruedFees[t.token] += fee;
        emit BuyerDefaulted(dealId, fee);

        if (t.bonder != address(0)) _settleBond(dealId, d, BondSettlement.Release, 0);
    }

    /// @inheritdoc IWasitEscrow
    function refundAndCancel(uint256) external pure {
        revert NotImplemented();
    }

    /// @inheritdoc IWasitEscrow
    /// @dev Calls the bond directly: if it still fails, the whole call reverts and the pending
    ///      settlement stays recorded.
    function retryBondSettlement(uint256 dealId) external nonReentrant {
        Deal storage d = _deals[dealId];
        BondSettlement action = d.bondPending;
        if (action == BondSettlement.None) revert NoPendingBondSettlement(dealId);

        d.bondPending = BondSettlement.None;
        if (action == BondSettlement.Claim) {
            uint256 amount = d.bondClaimAmount;
            d.bondClaimAmount = 0;
            uint256 paid = _bond.claim(dealId, amount, d.terms.buyer);
            emit BondSettled(dealId, action, paid);
        } else {
            _bond.release(dealId);
            emit BondSettled(dealId, action, 0);
        }
    }

    /// @inheritdoc IWasitEscrow
    function withdrawFees(address) external pure {
        revert NotImplemented();
    }

    // ───────────────────────────── Admin (new deals only) ─────────────────────────────

    /// @inheritdoc IWasitEscrow
    function setFeeRecipient(address) external pure {
        revert NotImplemented();
    }

    /// @inheritdoc IWasitEscrow
    function setDefaultFee(uint16) external pure {
        revert NotImplemented();
    }

    /// @inheritdoc IWasitEscrow
    function setTokenAllowed(address, bool) external pure {
        revert NotImplemented();
    }

    /// @inheritdoc IWasitEscrow
    function pause() external pure {
        revert NotImplemented();
    }

    /// @inheritdoc IWasitEscrow
    function unpause() external pure {
        revert NotImplemented();
    }

    // ───────────────────────────── Views ─────────────────────────────

    /// @inheritdoc IWasitEscrow
    function getDeal(uint256 dealId) external view returns (Deal memory) {
        return _deals[dealId];
    }

    /// @inheritdoc IWasitEscrow
    function bondTerms(uint256 dealId)
        external
        view
        returns (address bonder, uint256 covered, uint16 ratioBps, DealState state)
    {
        Deal storage d = _deals[dealId];
        return (d.terms.bonder, _netAdvance(d.terms), d.terms.bondRatioBps, d.state);
    }

    /// @inheritdoc IWasitEscrow
    function deadlines(uint256 dealId)
        external
        view
        returns (uint256 readyBy, uint256 balanceDue, uint256 shipBy, uint256 challengeEnds, uint256 ruleBy)
    {
        Deal storage d = _deals[dealId];
        DealTerms storage t = d.terms;
        if (d.advancePaidAt != 0) readyBy = uint256(d.advancePaidAt) + t.productionPeriod;
        if (d.readyAt != 0) balanceDue = uint256(d.readyAt) + t.balanceWindow;
        if (d.balanceFundedAt != 0) shipBy = uint256(d.balanceFundedAt) + t.shippingPeriod;
        if (d.shippedAt != 0) challengeEnds = uint256(d.shippedAt) + t.challengeWindow;
        if (d.disputedAt != 0) ruleBy = uint256(d.disputedAt) + t.arbitrationPeriod;
    }

    /// @inheritdoc IWasitEscrow
    function attestationDigest(
        uint256 dealId,
        AttestationKind kind,
        bytes32 evidenceHash,
        uint64 issuedAt,
        uint256 nonce
    ) external view returns (bytes32) {
        return _attestationDigest(dealId, kind, evidenceHash, issuedAt, nonce);
    }

    /// @inheritdoc IWasitEscrow
    function bond() external view returns (address) {
        return address(_bond);
    }

    // ───────────────────────────── Internals ─────────────────────────────

    function _dealIn(uint256 dealId, DealState expected) private view returns (Deal storage d) {
        d = _deals[dealId];
        if (d.state != expected) revert InvalidState(dealId, d.state);
    }

    /// @dev Sends the net advance straight from the buyer to the supplier and escrows the fee.
    function _fundAdvance(uint256 dealId) private {
        Deal storage d = _dealIn(dealId, DealState.Accepted);
        DealTerms storage t = d.terms;
        if (msg.sender != t.buyer) revert Unauthorized(msg.sender);
        if (!d.arbiterAccepted) revert ArbiterNotAccepted(dealId);
        if (t.bonder != address(0)) {
            if (_bond.bondOf(dealId).status != BondStatus.Active || _bond.coverageBps(dealId) < t.bondRatioBps) {
                revert BondNotReady(dealId);
            }
        }

        uint256 fee = _advanceFee(t);
        uint256 net = t.advanceAmount - fee;
        d.state = DealState.AdvancePaid;
        d.advancePaidAt = uint64(block.timestamp);
        d.advanceFeeHeld = uint128(fee);
        emit AdvanceFunded(dealId, net, fee);

        IERC20 token = IERC20(t.token);
        token.safeTransferFrom(msg.sender, t.supplier, net);
        if (fee != 0) token.safeTransferFrom(msg.sender, address(this), fee);
    }

    function _fundBalance(uint256 dealId) private {
        Deal storage d = _dealIn(dealId, DealState.GoodsReady);
        DealTerms storage t = d.terms;
        if (msg.sender != t.buyer) revert Unauthorized(msg.sender);
        uint256 due = uint256(d.readyAt) + t.balanceWindow;
        if (block.timestamp > due) revert DeadlinePassed(due);

        d.state = DealState.BalanceFunded;
        d.balanceFundedAt = uint64(block.timestamp);
        d.balanceHeld = t.balanceAmount;
        emit BalanceFunded(dealId, t.balanceAmount);

        IERC20(t.token).safeTransferFrom(msg.sender, address(this), t.balanceAmount);
    }

    /// @dev Arbiter split: supplier share rounds down, refunds round up, fees round down (ADR-018).
    function _split(Deal storage d, uint16 toSupplierBps, uint16 advanceRefundBps)
        private
        view
        returns (Split memory s)
    {
        uint256 held = d.balanceHeld;
        uint256 advanceFee = d.advanceFeeHeld;
        uint256 share = held * toSupplierBps / WasitTypes.BPS;
        uint256 shareFee = _fee(share, d.terms.feeBps);
        uint256 feeRefund = Math.mulDiv(advanceFee, advanceRefundBps, WasitTypes.BPS, Math.Rounding.Ceil);
        s.toSupplier = share - shareFee;
        s.toBuyer = held - share + feeRefund;
        s.claimAmount = Math.mulDiv(_netAdvance(d.terms), advanceRefundBps, WasitTypes.BPS, Math.Rounding.Ceil);
        s.earned = shareFee + advanceFee - feeRefund;
    }

    /// @dev Pays the balance minus its fee to the supplier, earns both fees, releases the bond.
    function _releaseToSupplier(uint256 dealId, Deal storage d) private {
        DealTerms storage t = d.terms;
        uint256 amount = d.balanceHeld;
        uint256 balanceFee = _fee(amount, t.feeBps);
        uint256 earned = balanceFee + d.advanceFeeHeld;

        d.state = DealState.Released;
        d.balanceHeld = 0;
        d.advanceFeeHeld = 0;
        accruedFees[t.token] += earned;
        emit Released(dealId, amount - balanceFee, earned);

        IERC20(t.token).safeTransfer(t.supplier, amount - balanceFee);
        if (t.bonder != address(0)) _settleBond(dealId, d, BondSettlement.Release, 0);
    }

    function _attestationDigest(
        uint256 dealId,
        AttestationKind kind,
        bytes32 evidenceHash,
        uint64 issuedAt,
        uint256 nonce
    ) private view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(ATTESTATION_TYPEHASH, dealId, uint8(kind), evidenceHash, issuedAt, nonce))
        );
    }

    /// @dev A permit can be front-run by anyone who saw it; ignore failure and let the transfer
    ///      rely on the allowance that the front-run permit set.
    function _tryPermit(address token, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) private {
        try IERC20Permit(token).permit(msg.sender, address(this), value, deadline, v, r, s) {} catch {}
    }

    /// @dev Calls the bond in try/catch so a bond or oracle failure never blocks the caller's exit.
    ///      On failure the call is recorded for `retryBondSettlement` (ADR-007, ADR-019).
    function _settleBond(uint256 dealId, Deal storage d, BondSettlement action, uint256 claimAmount) private {
        if (action == BondSettlement.Claim) {
            try _bond.claim(dealId, claimAmount, d.terms.buyer) returns (uint256 paid) {
                emit BondSettled(dealId, action, paid);
            } catch (bytes memory reason) {
                d.bondPending = action;
                d.bondClaimAmount = uint128(claimAmount);
                emit BondSettlementFailed(dealId, action, reason);
            }
        } else {
            try _bond.release(dealId) {
                emit BondSettled(dealId, action, 0);
            } catch (bytes memory reason) {
                d.bondPending = action;
                emit BondSettlementFailed(dealId, action, reason);
            }
        }
    }

    /// @dev ARCHITECTURE §3 validation (ADR-017).
    function _validateTerms(DealTerms calldata t) private view {
        if (t.supplier == address(0) || t.inspector == address(0) || t.carrier == address(0) || t.arbiter == address(0))
        {
            revert ZeroAddress();
        }
        if (t.buyer == t.supplier || t.arbiter == t.buyer || t.arbiter == t.supplier) revert ConflictingParties();
        if (!isTokenAllowed[t.token]) revert TokenNotAllowed(t.token);
        if (t.advanceAmount == 0 || t.balanceAmount == 0) revert ZeroAmount();
        if (t.feeBps != defaultFeeBps) revert FeeMismatch(defaultFeeBps, t.feeBps);
        if (t.termsHash == bytes32(0)) revert MissingTermsHash();
        if (
            !_validPeriod(t.productionPeriod) || !_validPeriod(t.balanceWindow) || !_validPeriod(t.shippingPeriod)
                || !_validPeriod(t.challengeWindow) || !_validPeriod(t.arbitrationPeriod)
        ) revert InvalidPeriod();
        if (t.bonder == address(0)) {
            if (t.bondRatioBps != 0) revert InvalidBondRatio(t.bondRatioBps);
        } else if (t.bondRatioBps < WasitTypes.MIN_BOND_RATIO_BPS || t.bondRatioBps > WasitTypes.MAX_BOND_RATIO_BPS) {
            revert InvalidBondRatio(t.bondRatioBps);
        }
    }

    function _validPeriod(uint32 period) private pure returns (bool) {
        return period >= WasitTypes.MIN_PERIOD && period <= WasitTypes.MAX_PERIOD;
    }

    /// @dev Protocol fee on `amount`, rounded down (ADR-018).
    function _fee(uint256 amount, uint16 feeBps) private pure returns (uint256) {
        return amount * feeBps / WasitTypes.BPS;
    }

    function _advanceFee(DealTerms storage t) private view returns (uint256) {
        return _fee(t.advanceAmount, t.feeBps);
    }

    /// @dev What the supplier receives from the advance and what the bond covers.
    function _netAdvance(DealTerms storage t) private view returns (uint256) {
        return t.advanceAmount - _advanceFee(t);
    }
}
