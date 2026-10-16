// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {WasitEscrow} from "../../src/WasitEscrow.sol";
import {
    AttestationKind, BondSettlement, BondStatus, Deal, DealState, DealTerms
} from "../../src/libraries/WasitTypes.sol";
import {MockAdvanceBond} from "../mocks/MockAdvanceBond.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// @notice Drives random but valid sequences of escrow calls, plus owner config changes, bond
///         failures, direct token transfers and time jumps. Records ghost state for the invariants.
contract EscrowHandler is Test {
    uint256 internal constant MAX_DEALS = 8;

    struct Actors {
        address owner;
        address buyer;
        address supplier;
        address agent;
        address inspector;
        uint256 inspectorKey;
        address carrier;
        uint256 carrierKey;
        address arbiter;
    }

    WasitEscrow public immutable escrow;
    MockERC20 public immutable musd;
    MockAdvanceBond public immutable bond;
    Actors internal a;

    uint256[] public dealIds;
    mapping(uint256 dealId => bytes32) public termsHashOf;
    mapping(uint256 dealId => DealState) public lastState;
    uint256 public donations;
    bool public wentBackwards;
    /// @notice How many deals ended in each state (shows the run reached deep paths).
    mapping(DealState => uint256) public outcomes;

    constructor(WasitEscrow escrow_, MockERC20 musd_, MockAdvanceBond bond_, Actors memory actors) {
        escrow = escrow_;
        musd = musd_;
        bond = bond_;
        a = actors;
    }

    function dealCount() external view returns (uint256) {
        return dealIds.length;
    }

    modifier recordStates() {
        _;
        for (uint256 i; i < dealIds.length; ++i) {
            uint256 id = dealIds[i];
            DealState prev = lastState[id];
            DealState next = escrow.getDeal(id).state;
            if (uint8(next) < uint8(prev) || (_terminal(prev) && next != prev)) wentBackwards = true;
            if (next != prev && _terminal(next)) outcomes[next]++;
            lastState[id] = next;
        }
    }

    // ───────────── deal lifecycle ─────────────

    function createDeal(uint128 advance, uint128 balance, bool bonded, uint32 periodSeed) external recordStates {
        if (dealIds.length >= MAX_DEALS || escrow.paused() || !escrow.isTokenAllowed(address(musd))) return;
        advance = uint128(bound(advance, 1, 1e24));
        balance = uint128(bound(balance, 1, 1e24));
        uint32 period = uint32(bound(periodSeed, 1 hours, 20 days));
        DealTerms memory t = DealTerms({
            buyer: a.buyer,
            supplier: a.supplier,
            inspector: a.inspector,
            carrier: a.carrier,
            arbiter: a.arbiter,
            bonder: bonded ? a.agent : address(0),
            token: address(musd),
            advanceAmount: advance,
            balanceAmount: balance,
            feeBps: escrow.defaultFeeBps(),
            bondRatioBps: bonded ? 15_000 : 0,
            productionPeriod: period,
            balanceWindow: period,
            shippingPeriod: period,
            challengeWindow: period,
            arbitrationPeriod: period,
            termsHash: keccak256(abi.encode(advance, balance))
        });
        musd.mint(a.buyer, uint256(advance) + balance);
        vm.prank(a.buyer);
        uint256 id = escrow.createDeal(t);
        dealIds.push(id);
        termsHashOf[id] = keccak256(abi.encode(t));
        lastState[id] = DealState.Created;
    }

    /// @notice Pushes one deal through 1–8 natural next steps; `branch` picks among the outcomes
    ///         (early acceptance, dispute, ruling, lapse, defaults, supplier refund).
    function progress(uint256 seed, uint8 steps, uint256 branch) external recordStates {
        if (dealIds.length == 0) return;
        uint256 id = dealIds[seed % dealIds.length];
        steps = uint8(bound(steps, 1, 8));
        for (uint256 i; i < steps; ++i) {
            branch = uint256(keccak256(abi.encode(branch, i)));
            if (!_step(id, branch)) return;
        }
    }

    function _step(uint256 id, uint256 branch) internal returns (bool) {
        Deal memory d = escrow.getDeal(id);
        (uint256 readyBy, uint256 due, uint256 shipBy, uint256 challengeEnds, uint256 ruleBy) = escrow.deadlines(id);
        if (d.state == DealState.Created) {
            vm.prank(a.supplier);
            escrow.accept(id);
        } else if (d.state == DealState.Accepted) {
            if (!d.arbiterAccepted) {
                vm.prank(a.arbiter);
                escrow.acceptArbiter(id);
            } else {
                _fundAdvance(id, d);
            }
        } else if (d.state == DealState.AdvancePaid) {
            if (block.timestamp > readyBy) escrow.claimSupplierDefault(id);
            else if (branch % 8 == 0) _refund(id, d);
            else if (branch % 8 == 1) vm.warp(readyBy + 1);
            else _attest(id, AttestationKind.ReadyInspected, a.inspectorKey, d.attestationNonce);
        } else if (d.state == DealState.GoodsReady) {
            if (block.timestamp > due) {
                escrow.claimBuyerDefault(id);
            } else if (branch % 8 == 0) {
                vm.warp(due + 1);
            } else {
                vm.prank(a.buyer);
                escrow.fundBalance(id);
            }
        } else if (d.state == DealState.BalanceFunded) {
            if (block.timestamp > shipBy) escrow.claimSupplierDefault(id);
            else if (branch % 8 == 0) vm.warp(shipBy + 1);
            else if (branch % 8 == 1) _refund(id, d);
            else _attest(id, AttestationKind.Shipped, a.carrierKey, d.attestationNonce);
        } else if (d.state == DealState.Shipped) {
            if (block.timestamp > challengeEnds || branch % 3 == 0) {
                if (block.timestamp <= challengeEnds) vm.warp(challengeEnds + 1);
                escrow.release(id);
            } else {
                vm.prank(a.buyer);
                if (branch % 3 == 1) escrow.acceptGoods(id);
                else escrow.dispute(id, keccak256("reason"));
            }
        } else if (d.state == DealState.Disputed) {
            if (block.timestamp > ruleBy || branch % 4 == 0) {
                if (block.timestamp <= ruleBy) vm.warp(ruleBy + 1);
                escrow.release(id);
            } else {
                uint16 toSupplierBps = uint16(branch % 10_001);
                uint16 refundBps = d.terms.bonder == address(0) ? 0 : uint16((branch >> 32) % 10_001);
                vm.prank(a.arbiter);
                escrow.resolve(id, toSupplierBps, refundBps);
            }
        } else {
            return false;
        }
        return true;
    }

    function accept(uint256 seed) external recordStates {
        (uint256 id, Deal memory d) = _pick(seed);
        if (d.state != DealState.Created) return;
        vm.prank(a.supplier);
        escrow.accept(id);
    }

    function acceptArbiter(uint256 seed) external recordStates {
        (uint256 id, Deal memory d) = _pick(seed);
        if (d.state != DealState.Created && d.state != DealState.Accepted) return;
        vm.prank(a.arbiter);
        escrow.acceptArbiter(id);
    }

    function cancel(uint256 seed, bool bySupplier) external recordStates {
        (uint256 id, Deal memory d) = _pick(seed);
        if (d.state != DealState.Created && d.state != DealState.Accepted) return;
        vm.prank(bySupplier ? a.supplier : a.buyer);
        escrow.cancel(id);
    }

    function fundAdvance(uint256 seed) external recordStates {
        (uint256 id, Deal memory d) = _pick(seed);
        if (d.state != DealState.Accepted || !d.arbiterAccepted) return;
        _fundAdvance(id, d);
    }

    function attestReady(uint256 seed) external recordStates {
        (uint256 id, Deal memory d) = _pick(seed);
        (uint256 readyBy,,,,) = escrow.deadlines(id);
        if (d.state != DealState.AdvancePaid || block.timestamp > readyBy) return;
        _attest(id, AttestationKind.ReadyInspected, a.inspectorKey, d.attestationNonce);
    }

    function fundBalance(uint256 seed) external recordStates {
        (uint256 id, Deal memory d) = _pick(seed);
        (, uint256 due,,,) = escrow.deadlines(id);
        if (d.state != DealState.GoodsReady || block.timestamp > due) return;
        vm.prank(a.buyer);
        escrow.fundBalance(id);
    }

    function attestShipped(uint256 seed) external recordStates {
        (uint256 id, Deal memory d) = _pick(seed);
        (,, uint256 shipBy,,) = escrow.deadlines(id);
        if (d.state != DealState.BalanceFunded || block.timestamp > shipBy) return;
        _attest(id, AttestationKind.Shipped, a.carrierKey, d.attestationNonce);
    }

    function release(uint256 seed) external recordStates {
        (uint256 id, Deal memory d) = _pick(seed);
        (,,, uint256 challengeEnds, uint256 ruleBy) = escrow.deadlines(id);
        bool afterWindow = d.state == DealState.Shipped && block.timestamp > challengeEnds;
        bool lapsed = d.state == DealState.Disputed && block.timestamp > ruleBy;
        if (!afterWindow && !lapsed) return;
        escrow.release(id);
    }

    function acceptGoods(uint256 seed) external recordStates {
        (uint256 id, Deal memory d) = _pick(seed);
        if (d.state != DealState.Shipped) return;
        vm.prank(a.buyer);
        escrow.acceptGoods(id);
    }

    function dispute(uint256 seed) external recordStates {
        (uint256 id, Deal memory d) = _pick(seed);
        (,,, uint256 challengeEnds,) = escrow.deadlines(id);
        if (d.state != DealState.Shipped || block.timestamp > challengeEnds) return;
        vm.prank(a.buyer);
        escrow.dispute(id, keccak256("reason"));
    }

    function resolve(uint256 seed, uint16 toSupplierBps, uint16 advanceRefundBps) external recordStates {
        (uint256 id, Deal memory d) = _pick(seed);
        (,,,, uint256 ruleBy) = escrow.deadlines(id);
        if (d.state != DealState.Disputed || block.timestamp > ruleBy) return;
        toSupplierBps = uint16(bound(toSupplierBps, 0, 10_000));
        advanceRefundBps = d.terms.bonder == address(0) ? 0 : uint16(bound(advanceRefundBps, 0, 10_000));
        vm.prank(a.arbiter);
        escrow.resolve(id, toSupplierBps, advanceRefundBps);
    }

    function claimSupplierDefault(uint256 seed) external recordStates {
        (uint256 id, Deal memory d) = _pick(seed);
        (uint256 readyBy,, uint256 shipBy,,) = escrow.deadlines(id);
        bool missedReady = d.state == DealState.AdvancePaid && block.timestamp > readyBy;
        bool missedShip = d.state == DealState.BalanceFunded && block.timestamp > shipBy;
        if (!missedReady && !missedShip) return;
        escrow.claimSupplierDefault(id);
    }

    function claimBuyerDefault(uint256 seed) external recordStates {
        (uint256 id, Deal memory d) = _pick(seed);
        (, uint256 due,,,) = escrow.deadlines(id);
        if (d.state != DealState.GoodsReady || block.timestamp <= due) return;
        escrow.claimBuyerDefault(id);
    }

    function refundAndCancel(uint256 seed) external recordStates {
        (uint256 id, Deal memory d) = _pick(seed);
        if (d.state != DealState.AdvancePaid && d.state != DealState.GoodsReady && d.state != DealState.BalanceFunded) {
            return;
        }
        _refund(id, d);
    }

    function retryBondSettlement(uint256 seed) external recordStates {
        (uint256 id, Deal memory d) = _pick(seed);
        if (d.bondPending == BondSettlement.None) return;
        try escrow.retryBondSettlement(id) {} catch {}
    }

    function withdrawFees() external recordStates {
        if (escrow.accruedFees(address(musd)) == 0) return;
        escrow.withdrawFees(address(musd));
    }

    // ───────────── environment ─────────────

    function warp(uint32 dt) external recordStates {
        vm.warp(block.timestamp + bound(dt, 0, 25 days));
    }

    function setBondFailures(bool failClaim, bool failRelease) external recordStates {
        bond.setFailures(failClaim, failRelease);
    }

    function donate(uint96 amount) external recordStates {
        musd.mint(address(escrow), amount);
        donations += amount;
    }

    /// @dev Fee and recipient change every time; pausing and delisting are rarer so deals still get
    ///      created, and each is undone by its opposite mode.
    function ownerConfig(uint16 feeBps, uint8 mode, address recipient) external recordStates {
        vm.startPrank(a.owner);
        escrow.setDefaultFee(uint16(bound(feeBps, 0, 100)));
        if (recipient != address(0)) escrow.setFeeRecipient(recipient);
        mode %= 8;
        if (mode == 0 && !escrow.paused()) escrow.pause();
        if (mode == 1 && escrow.paused()) escrow.unpause();
        if (mode == 2) escrow.setTokenAllowed(address(musd), false);
        if (mode >= 3) escrow.setTokenAllowed(address(musd), true);
        vm.stopPrank();
    }

    // ───────────── helpers ─────────────

    function _pick(uint256 seed) internal view returns (uint256 id, Deal memory d) {
        if (dealIds.length == 0) return (0, d);
        id = dealIds[seed % dealIds.length];
        d = escrow.getDeal(id);
    }

    function _fundAdvance(uint256 id, Deal memory d) internal {
        if (d.terms.bonder != address(0)) bond.setBond(id, a.agent, BondStatus.Active, d.terms.bondRatioBps);
        vm.prank(a.buyer);
        escrow.fundAdvance(id);
    }

    function _refund(uint256 id, Deal memory d) internal {
        musd.mint(a.supplier, d.terms.advanceAmount);
        vm.prank(a.supplier);
        escrow.refundAndCancel(id);
    }

    function _attest(uint256 id, AttestationKind kind, uint256 key, uint256 nonce) internal {
        bytes32 evidence = keccak256(abi.encode(id, kind));
        uint64 issuedAt = uint64(block.timestamp);
        bytes32 digest = escrow.attestationDigest(id, kind, evidence, issuedAt, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        escrow.submitAttestation(id, kind, evidence, issuedAt, abi.encodePacked(r, s, v));
    }

    function _terminal(DealState s) internal pure returns (bool) {
        return s == DealState.Released || s == DealState.Resolved || s == DealState.SupplierDefaulted
            || s == DealState.BuyerDefaulted || s == DealState.Cancelled;
    }
}
