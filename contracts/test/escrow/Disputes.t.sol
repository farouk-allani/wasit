// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {IWasitEscrow} from "../../src/interfaces/IWasitEscrow.sol";
import {BondSettlement, BondStatus, Deal, DealState, DealTerms} from "../../src/libraries/WasitTypes.sol";
import {EscrowBase} from "../utils/EscrowBase.t.sol";

contract DisputesTest is EscrowBase {
    uint256 internal constant NET_ADVANCE = 2_985e18;
    uint256 internal constant ADVANCE_FEE = 15e18;
    uint256 internal constant BALANCE_FEE = 35e18;

    // ── dispute ──

    function test_dispute_byBuyerInsideWindow() public {
        uint256 id = _shipped(_terms());
        bytes32 reason = keccak256("wrong colour");
        vm.expectEmit(address(escrow));
        emit IWasitEscrow.Disputed(id, reason);
        vm.prank(buyer);
        escrow.dispute(id, reason);

        Deal memory d = escrow.getDeal(id);
        assertEq(uint8(d.state), uint8(DealState.Disputed));
        assertEq(d.disputedAt, block.timestamp);
        (,,,, uint256 ruleBy) = escrow.deadlines(id);
        assertEq(ruleBy, block.timestamp + 14 days);
    }

    function test_dispute_acceptedAtWindowEnd() public {
        uint256 id = _shipped(_terms());
        (,,, uint256 challengeEnds,) = escrow.deadlines(id);
        vm.warp(challengeEnds);
        vm.prank(buyer);
        escrow.dispute(id, bytes32(0));
        assertEq(uint8(escrow.getDeal(id).state), uint8(DealState.Disputed));
    }

    function test_dispute_revertsAfterWindow() public {
        uint256 id = _shipped(_terms());
        (,,, uint256 challengeEnds,) = escrow.deadlines(id);
        vm.warp(challengeEnds + 1);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.DeadlinePassed.selector, challengeEnds));
        escrow.dispute(id, bytes32(0));
    }

    function test_dispute_revertsIfNotBuyer() public {
        uint256 id = _shipped(_terms());
        vm.prank(supplier);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.Unauthorized.selector, supplier));
        escrow.dispute(id, bytes32(0));
    }

    function test_dispute_blocksReleaseAndAcceptGoods() public {
        uint256 id = _disputed(_terms());
        (,,, uint256 challengeEnds, uint256 ruleBy) = escrow.deadlines(id);
        vm.warp(challengeEnds + 1);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.DeadlineNotReached.selector, ruleBy));
        escrow.release(id);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.InvalidState.selector, id, DealState.Disputed));
        escrow.acceptGoods(id);
    }

    // ── lapse (ADR-019) ──

    function test_lapse_releasesToSupplierAfterRuleBy() public {
        uint256 id = _disputed(_terms());
        (,,,, uint256 ruleBy) = escrow.deadlines(id);
        vm.warp(ruleBy + 1);
        uint256 supplierBefore = musd.balanceOf(supplier);

        vm.expectEmit(address(escrow));
        emit IWasitEscrow.DisputeLapsed(id);
        vm.expectEmit(address(escrow));
        emit IWasitEscrow.Released(id, BALANCE - BALANCE_FEE, BALANCE_FEE + ADVANCE_FEE);
        vm.prank(keeper);
        escrow.release(id);

        assertEq(musd.balanceOf(supplier), supplierBefore + BALANCE - BALANCE_FEE);
        assertEq(uint8(escrow.getDeal(id).state), uint8(DealState.Released));
    }

    // ── resolve ──

    function test_resolve_fullyForSupplier() public {
        uint256 id = _disputed(_terms());
        uint256 supplierBefore = musd.balanceOf(supplier);
        vm.prank(arbiter);
        escrow.resolve(id, 10_000, 0);

        assertEq(musd.balanceOf(supplier), supplierBefore + BALANCE - BALANCE_FEE);
        assertEq(escrow.accruedFees(address(musd)), BALANCE_FEE + ADVANCE_FEE);
        assertEq(uint8(bond.bondOf(id).status), uint8(BondStatus.Released));
    }

    function test_resolve_balanceBackToBuyerAdvanceKept() public {
        uint256 id = _disputed(_terms());
        uint256 buyerBefore = musd.balanceOf(buyer);

        vm.expectEmit(address(escrow));
        emit IWasitEscrow.Resolved(id, 0, BALANCE, 0, ADVANCE_FEE);
        vm.prank(arbiter);
        escrow.resolve(id, 0, 0);

        assertEq(musd.balanceOf(buyer), buyerBefore + BALANCE);
        assertEq(escrow.accruedFees(address(musd)), ADVANCE_FEE, "supplier kept the advance, fee earned");
        assertEq(uint8(bond.bondOf(id).status), uint8(BondStatus.Released));
    }

    function test_resolve_splitWithPartialAdvanceRefund() public {
        uint256 id = _disputed(_terms());
        uint256 buyerBefore = musd.balanceOf(buyer);
        uint256 supplierBefore = musd.balanceOf(supplier);
        // 60% of 7,000 = 4,200 to the supplier (fee 21); 2,800 back + half the 15 advance fee to the
        // buyer; half the 2,985 net advance claimed from the bond; protocol keeps 21 + 7.5.
        vm.expectEmit(address(escrow));
        emit IWasitEscrow.Resolved(id, 4_179e18, 2_807.5e18, 1_492.5e18, 28.5e18);
        vm.expectEmit(address(escrow));
        emit IWasitEscrow.BondSettled(id, BondSettlement.Claim, 1_492.5e18);
        vm.prank(arbiter);
        escrow.resolve(id, 6_000, 5_000);

        assertEq(musd.balanceOf(supplier), supplierBefore + 4_179e18);
        assertEq(musd.balanceOf(buyer), buyerBefore + 2_807.5e18 + 1_492.5e18);
        assertEq(escrow.accruedFees(address(musd)), 28.5e18);
        assertEq(musd.balanceOf(address(escrow)), 28.5e18);
        assertEq(uint8(escrow.getDeal(id).state), uint8(DealState.Resolved));
    }

    function test_resolve_fullRefundMakesBuyerWhole() public {
        uint256 buyerStart = musd.balanceOf(buyer);
        uint256 id = _disputed(_terms());
        vm.prank(arbiter);
        escrow.resolve(id, 0, 10_000);

        assertEq(musd.balanceOf(buyer), buyerStart);
        assertEq(escrow.accruedFees(address(musd)), 0);
        assertEq(musd.balanceOf(address(escrow)), 0);
    }

    function test_resolve_withoutBond() public {
        uint256 id = _disputed(_termsWithoutBond());
        vm.prank(arbiter);
        escrow.resolve(id, 5_000, 0);
        assertEq(bond.releaseCalls() + bond.claimCalls(), 0);
    }

    function test_resolve_revertsAdvanceRefundWithoutBond() public {
        uint256 id = _disputed(_termsWithoutBond());
        vm.prank(arbiter);
        vm.expectRevert(IWasitEscrow.NoBondForAdvanceRefund.selector);
        escrow.resolve(id, 5_000, 1);
    }

    function test_resolve_revertsIfNotArbiter() public {
        uint256 id = _disputed(_terms());
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.Unauthorized.selector, buyer));
        escrow.resolve(id, 0, 0);
    }

    function test_resolve_revertsAfterRuleBy() public {
        uint256 id = _disputed(_terms());
        (,,,, uint256 ruleBy) = escrow.deadlines(id);
        vm.warp(ruleBy + 1);
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.DeadlinePassed.selector, ruleBy));
        escrow.resolve(id, 0, 0);
    }

    function test_resolve_revertsOnBpsAboveMax() public {
        uint256 id = _disputed(_terms());
        vm.startPrank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.InvalidBps.selector, 10_001));
        escrow.resolve(id, 10_001, 0);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.InvalidBps.selector, 10_001));
        escrow.resolve(id, 0, 10_001);
    }

    function test_resolve_revertsWithoutDispute() public {
        uint256 id = _shipped(_terms());
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.InvalidState.selector, id, DealState.Shipped));
        escrow.resolve(id, 0, 0);
    }

    function test_resolve_bondFailureRecordsPendingClaim() public {
        uint256 id = _disputed(_terms());
        bond.setFailures(true, false);
        vm.prank(arbiter);
        escrow.resolve(id, 0, 10_000);
        Deal memory d = escrow.getDeal(id);
        assertEq(uint8(d.bondPending), uint8(BondSettlement.Claim));
        assertEq(d.bondClaimAmount, NET_ADVANCE);
    }

    function testFuzz_resolve_conservesEscrowAndNeverOverpays(
        uint128 advance,
        uint128 balance,
        uint16 toSupplierBps,
        uint16 advanceRefundBps
    ) public {
        advance = uint128(bound(advance, 1, 1_000_000e18));
        balance = uint128(bound(balance, 1, 1_000_000e18));
        toSupplierBps = uint16(bound(toSupplierBps, 0, 10_000));
        advanceRefundBps = uint16(bound(advanceRefundBps, 0, 10_000));
        DealTerms memory t = _terms();
        t.advanceAmount = advance;
        t.balanceAmount = balance;
        musd.mint(buyer, uint256(advance) + balance);
        uint256 id = _disputed(t);
        uint256 heldFee = escrow.getDeal(id).advanceFeeHeld;
        (, uint256 netAdvance,,) = escrow.bondTerms(id);

        vm.recordLogs();
        vm.prank(arbiter);
        escrow.resolve(id, toSupplierBps, advanceRefundBps);
        (uint256 toSupplier, uint256 toBuyer, uint256 claimRequested, uint256 earned) = _resolvedEvent();

        assertEq(toSupplier + toBuyer + earned, uint256(balance) + heldFee, "escrowed money conserved");
        assertEq(musd.balanceOf(address(escrow)), earned, "only earned fees remain");
        assertLe(claimRequested, netAdvance, "bond claim capped at the net advance");
        assertLe(toSupplier, uint256(balance) * toSupplierBps / 10_000, "supplier share rounds down");
    }

    function _resolvedEvent() internal view returns (uint256, uint256, uint256, uint256) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics.length > 0 && logs[i].topics[0] == IWasitEscrow.Resolved.selector) {
                return abi.decode(logs[i].data, (uint256, uint256, uint256, uint256));
            }
        }
        revert("Resolved not emitted");
    }
}
