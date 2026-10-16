// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAdvanceBond} from "./interfaces/IAdvanceBond.sol";
import {IWasitEscrow} from "./interfaces/IWasitEscrow.sol";
import {AttestationKind, Deal, DealState, DealTerms, WasitTypes} from "./libraries/WasitTypes.sol";

/// @title WasitEscrow
/// @notice Advance-payment protection for stablecoin trade. The advance goes straight to the
///         supplier (secured by an optional BTC bond); the balance waits here until named parties
///         sign off and a challenge window passes. The owner configures new deals only and can
///         never move deal funds or block an exit.
contract WasitEscrow is IWasitEscrow, Ownable2Step, Pausable, ReentrancyGuard, EIP712 {
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
    function accept(uint256) external pure {
        revert NotImplemented();
    }

    /// @inheritdoc IWasitEscrow
    function acceptArbiter(uint256) external pure {
        revert NotImplemented();
    }

    /// @inheritdoc IWasitEscrow
    function cancel(uint256) external pure {
        revert NotImplemented();
    }

    /// @inheritdoc IWasitEscrow
    function fundAdvance(uint256) external pure {
        revert NotImplemented();
    }

    /// @inheritdoc IWasitEscrow
    function fundAdvanceWithPermit(uint256, uint256, uint8, bytes32, bytes32) external pure {
        revert NotImplemented();
    }

    /// @inheritdoc IWasitEscrow
    function submitAttestation(uint256, AttestationKind, bytes32, uint64, bytes calldata) external pure {
        revert NotImplemented();
    }

    /// @inheritdoc IWasitEscrow
    function fundBalance(uint256) external pure {
        revert NotImplemented();
    }

    /// @inheritdoc IWasitEscrow
    function fundBalanceWithPermit(uint256, uint256, uint8, bytes32, bytes32) external pure {
        revert NotImplemented();
    }

    /// @inheritdoc IWasitEscrow
    function release(uint256) external pure {
        revert NotImplemented();
    }

    /// @inheritdoc IWasitEscrow
    function acceptGoods(uint256) external pure {
        revert NotImplemented();
    }

    /// @inheritdoc IWasitEscrow
    function dispute(uint256, bytes32) external pure {
        revert NotImplemented();
    }

    /// @inheritdoc IWasitEscrow
    function resolve(uint256, uint16, uint16) external pure {
        revert NotImplemented();
    }

    /// @inheritdoc IWasitEscrow
    function claimSupplierDefault(uint256) external pure {
        revert NotImplemented();
    }

    /// @inheritdoc IWasitEscrow
    function claimBuyerDefault(uint256) external pure {
        revert NotImplemented();
    }

    /// @inheritdoc IWasitEscrow
    function refundAndCancel(uint256) external pure {
        revert NotImplemented();
    }

    /// @inheritdoc IWasitEscrow
    function retryBondSettlement(uint256) external pure {
        revert NotImplemented();
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
    function attestationDigest(uint256, AttestationKind, bytes32, uint64, uint256) external pure returns (bytes32) {
        revert NotImplemented();
    }

    /// @inheritdoc IWasitEscrow
    function bond() external view returns (address) {
        return address(_bond);
    }

    // ───────────────────────────── Internals ─────────────────────────────

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

    /// @dev Advance fee, rounded down (ADR-018).
    function _advanceFee(DealTerms storage t) private view returns (uint256) {
        return uint256(t.advanceAmount) * t.feeBps / WasitTypes.BPS;
    }

    /// @dev What the supplier receives from the advance and what the bond covers.
    function _netAdvance(DealTerms storage t) private view returns (uint256) {
        return t.advanceAmount - _advanceFee(t);
    }
}
