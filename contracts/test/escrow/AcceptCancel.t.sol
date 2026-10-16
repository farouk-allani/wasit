// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IWasitEscrow} from "../../src/interfaces/IWasitEscrow.sol";
import {BondSettlement, BondStatus, Deal, DealState} from "../../src/libraries/WasitTypes.sol";
import {MockAdvanceBond} from "../mocks/MockAdvanceBond.sol";
import {EscrowBase} from "../utils/EscrowBase.t.sol";

contract AcceptCancelTest is EscrowBase {
    uint256 internal id;

    function setUp() public override {
        super.setUp();
        id = _create(_terms());
    }

    // ── accept ──

    function test_accept_bySupplier() public {
        vm.expectEmit(address(escrow));
        emit IWasitEscrow.DealAccepted(id, supplier);
        vm.prank(supplier);
        escrow.accept(id);
        assertEq(uint8(escrow.getDeal(id).state), uint8(DealState.Accepted));
    }

    function test_accept_revertsIfNotSupplier() public {
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.Unauthorized.selector, buyer));
        escrow.accept(id);
    }

    function test_accept_revertsTwice() public {
        vm.startPrank(supplier);
        escrow.accept(id);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.InvalidState.selector, id, DealState.Accepted));
        escrow.accept(id);
    }

    function test_accept_revertsOnUnknownDeal() public {
        vm.prank(supplier);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.InvalidState.selector, 99, DealState.None));
        escrow.accept(99);
    }

    // ── acceptArbiter ──

    function test_acceptArbiter_inCreated() public {
        vm.expectEmit(address(escrow));
        emit IWasitEscrow.ArbiterAccepted(id, arbiter);
        vm.prank(arbiter);
        escrow.acceptArbiter(id);
        assertTrue(escrow.getDeal(id).arbiterAccepted);
    }

    function test_acceptArbiter_inAccepted() public {
        vm.prank(supplier);
        escrow.accept(id);
        vm.prank(arbiter);
        escrow.acceptArbiter(id);
        assertTrue(escrow.getDeal(id).arbiterAccepted);
    }

    function test_acceptArbiter_repeatIsNoOp() public {
        vm.startPrank(arbiter);
        escrow.acceptArbiter(id);
        vm.recordLogs();
        escrow.acceptArbiter(id);
        assertEq(vm.getRecordedLogs().length, 0);
    }

    function test_acceptArbiter_revertsIfNotArbiter() public {
        vm.prank(supplier);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.Unauthorized.selector, supplier));
        escrow.acceptArbiter(id);
    }

    function test_acceptArbiter_revertsAfterCancel() public {
        vm.prank(buyer);
        escrow.cancel(id);
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.InvalidState.selector, id, DealState.Cancelled));
        escrow.acceptArbiter(id);
    }

    // ── cancel ──

    function test_cancel_byBuyerInCreated() public {
        vm.expectEmit(address(escrow));
        emit IWasitEscrow.DealCancelled(id, buyer, 0);
        vm.prank(buyer);
        escrow.cancel(id);
        assertEq(uint8(escrow.getDeal(id).state), uint8(DealState.Cancelled));
    }

    function test_cancel_bySupplierInAccepted() public {
        vm.startPrank(supplier);
        escrow.accept(id);
        escrow.cancel(id);
        assertEq(uint8(escrow.getDeal(id).state), uint8(DealState.Cancelled));
    }

    function test_cancel_revertsForOthers() public {
        address[3] memory others = [arbiter, agent, stranger];
        for (uint256 i; i < others.length; ++i) {
            vm.prank(others[i]);
            vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.Unauthorized.selector, others[i]));
            escrow.cancel(id);
        }
    }

    function test_cancel_isTerminal() public {
        vm.prank(buyer);
        escrow.cancel(id);
        vm.prank(supplier);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.InvalidState.selector, id, DealState.Cancelled));
        escrow.accept(id);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.InvalidState.selector, id, DealState.Cancelled));
        escrow.cancel(id);
    }

    function test_cancel_releasesPostedBond() public {
        bond.setBond(id, agent, BondStatus.Active, 15_000);
        vm.expectEmit(address(escrow));
        emit IWasitEscrow.BondSettled(id, BondSettlement.Release, 0);
        vm.prank(buyer);
        escrow.cancel(id);
        assertEq(bond.releaseCalls(), 1);
        assertEq(uint8(bond.bondOf(id).status), uint8(BondStatus.Released));
    }

    function test_cancel_withoutBonderSkipsBond() public {
        uint256 noBond = _create(_termsWithoutBond());
        vm.prank(buyer);
        escrow.cancel(noBond);
        assertEq(bond.releaseCalls(), 0);
    }

    function test_cancel_bondFailureDoesNotBlockExit() public {
        bond.setBond(id, agent, BondStatus.Active, 15_000);
        bond.setFailures(false, true);
        vm.expectEmit(address(escrow));
        emit IWasitEscrow.BondSettlementFailed(
            id, BondSettlement.Release, abi.encodeWithSelector(MockAdvanceBond.MockFailure.selector)
        );
        vm.prank(buyer);
        escrow.cancel(id);

        Deal memory d = escrow.getDeal(id);
        assertEq(uint8(d.state), uint8(DealState.Cancelled));
        assertEq(uint8(d.bondPending), uint8(BondSettlement.Release));
    }
}
