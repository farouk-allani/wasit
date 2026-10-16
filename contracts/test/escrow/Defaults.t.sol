// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IWasitEscrow} from "../../src/interfaces/IWasitEscrow.sol";
import {BondSettlement, BondStatus, Deal, DealState} from "../../src/libraries/WasitTypes.sol";
import {MockAdvanceBond} from "../mocks/MockAdvanceBond.sol";
import {EscrowBase} from "../utils/EscrowBase.t.sol";

contract DefaultsTest is EscrowBase {
    uint256 internal constant NET_ADVANCE = 2_985e18;
    uint256 internal constant ADVANCE_FEE = 15e18;

    function _pastReadyBy(uint256 id) internal {
        (uint256 readyBy,,,,) = escrow.deadlines(id);
        vm.warp(readyBy + 1);
    }

    function _pastShipBy(uint256 id) internal {
        (,, uint256 shipBy,,) = escrow.deadlines(id);
        vm.warp(shipBy + 1);
    }

    function _pastBalanceDue(uint256 id) internal {
        (, uint256 due,,,) = escrow.deadlines(id);
        vm.warp(due + 1);
    }

    // ── supplier default ──

    function test_supplierDefault_missedReadyMakesBuyerWhole() public {
        uint256 buyerStart = musd.balanceOf(buyer);
        uint256 id = _advancePaid(_terms());
        _pastReadyBy(id);

        vm.expectEmit(address(escrow));
        emit IWasitEscrow.SupplierDefaulted(id, ADVANCE_FEE, NET_ADVANCE);
        vm.expectEmit(address(escrow));
        emit IWasitEscrow.BondSettled(id, BondSettlement.Claim, NET_ADVANCE);
        vm.prank(keeper);
        escrow.claimSupplierDefault(id);

        assertEq(musd.balanceOf(buyer), buyerStart, "fee refund + bond claim = full advance");
        assertEq(musd.balanceOf(address(escrow)), 0);
        assertEq(escrow.accruedFees(address(musd)), 0, "no fee on a failed deal");
        Deal memory d = escrow.getDeal(id);
        assertEq(uint8(d.state), uint8(DealState.SupplierDefaulted));
        assertEq(d.advanceFeeHeld, 0);
        assertEq(uint8(bond.bondOf(id).status), uint8(BondStatus.Claimed));
    }

    function test_supplierDefault_missedShipmentRefundsEverything() public {
        uint256 buyerStart = musd.balanceOf(buyer);
        uint256 id = _balanceFunded(_terms());
        _pastShipBy(id);

        escrow.claimSupplierDefault(id);

        assertEq(musd.balanceOf(buyer), buyerStart, "balance + fee from escrow, net advance from bond");
        assertEq(musd.balanceOf(address(escrow)), 0);
        assertEq(escrow.getDeal(id).balanceHeld, 0);
    }

    function test_supplierDefault_revertsAtDeadline() public {
        uint256 id = _advancePaid(_terms());
        (uint256 readyBy,,,,) = escrow.deadlines(id);
        vm.warp(readyBy);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.DeadlineNotReached.selector, readyBy));
        escrow.claimSupplierDefault(id);
    }

    function test_supplierDefault_revertsOnceGoodsAreReady() public {
        uint256 id = _goodsReady(_terms());
        vm.warp(block.timestamp + 365 days);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.InvalidState.selector, id, DealState.GoodsReady));
        escrow.claimSupplierDefault(id);
    }

    function test_supplierDefault_withoutBondRefundsEscrowOnly() public {
        uint256 id = _balanceFunded(_termsWithoutBond());
        _pastShipBy(id);
        uint256 buyerBefore = musd.balanceOf(buyer);

        vm.expectEmit(address(escrow));
        emit IWasitEscrow.SupplierDefaulted(id, BALANCE + ADVANCE_FEE, 0);
        escrow.claimSupplierDefault(id);

        assertEq(musd.balanceOf(buyer), buyerBefore + BALANCE + ADVANCE_FEE);
        assertEq(bond.claimCalls(), 0);
    }

    function test_supplierDefault_bondFailureRecordsPendingClaim() public {
        uint256 id = _balanceFunded(_terms());
        _pastShipBy(id);
        bond.setFailures(true, false);
        uint256 buyerBefore = musd.balanceOf(buyer);

        vm.expectEmit(address(escrow));
        emit IWasitEscrow.BondSettlementFailed(
            id, BondSettlement.Claim, abi.encodeWithSelector(MockAdvanceBond.MockFailure.selector)
        );
        escrow.claimSupplierDefault(id);

        assertEq(musd.balanceOf(buyer), buyerBefore + BALANCE + ADVANCE_FEE, "escrowed refund still paid");
        Deal memory d = escrow.getDeal(id);
        assertEq(uint8(d.bondPending), uint8(BondSettlement.Claim));
        assertEq(d.bondClaimAmount, NET_ADVANCE);
    }

    function test_retry_paysPendingClaimOnce() public {
        uint256 id = _advancePaid(_terms());
        _pastReadyBy(id);
        bond.setFailures(true, false);
        escrow.claimSupplierDefault(id);
        bond.setFailures(false, false);
        uint256 buyerBefore = musd.balanceOf(buyer);

        vm.expectEmit(address(escrow));
        emit IWasitEscrow.BondSettled(id, BondSettlement.Claim, NET_ADVANCE);
        vm.prank(keeper);
        escrow.retryBondSettlement(id);

        assertEq(musd.balanceOf(buyer), buyerBefore + NET_ADVANCE);
        Deal memory d = escrow.getDeal(id);
        assertEq(uint8(d.bondPending), uint8(BondSettlement.None));
        assertEq(d.bondClaimAmount, 0);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.NoPendingBondSettlement.selector, id));
        escrow.retryBondSettlement(id);
    }

    function test_retry_stillFailingRevertsAndKeepsPending() public {
        uint256 id = _advancePaid(_terms());
        _pastReadyBy(id);
        bond.setFailures(true, false);
        escrow.claimSupplierDefault(id);

        vm.expectRevert(MockAdvanceBond.MockFailure.selector);
        escrow.retryBondSettlement(id);

        assertEq(uint8(escrow.getDeal(id).bondPending), uint8(BondSettlement.Claim));
    }

    function test_retry_revertsWithoutPending() public {
        uint256 id = _advancePaid(_terms());
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.NoPendingBondSettlement.selector, id));
        escrow.retryBondSettlement(id);
    }

    function test_supplierDefault_bondShortfallIsReported() public {
        uint256 id = _advancePaid(_terms());
        _pastReadyBy(id);
        uint256 bondFunds = musd.balanceOf(address(bond));
        vm.prank(address(bond));
        musd.transfer(stranger, bondFunds - 1_000e18); // the mock bond only holds 1,000 MUSD now

        vm.expectEmit(address(escrow));
        emit IWasitEscrow.BondSettled(id, BondSettlement.Claim, 1_000e18);
        escrow.claimSupplierDefault(id);
    }

    // ── buyer default ──

    function test_buyerDefault_supplierKeepsAdvanceAndFeeIsEarned() public {
        uint256 id = _goodsReady(_terms());
        _pastBalanceDue(id);
        uint256 supplierBefore = musd.balanceOf(supplier);

        vm.expectEmit(address(escrow));
        emit IWasitEscrow.BuyerDefaulted(id, ADVANCE_FEE);
        vm.expectEmit(address(escrow));
        emit IWasitEscrow.BondSettled(id, BondSettlement.Release, 0);
        vm.prank(keeper);
        escrow.claimBuyerDefault(id);

        assertEq(musd.balanceOf(supplier), supplierBefore, "supplier already holds the net advance");
        assertEq(escrow.accruedFees(address(musd)), ADVANCE_FEE);
        assertEq(musd.balanceOf(address(escrow)), ADVANCE_FEE);
        assertEq(uint8(escrow.getDeal(id).state), uint8(DealState.BuyerDefaulted));
        assertEq(uint8(bond.bondOf(id).status), uint8(BondStatus.Released));
    }

    function test_buyerDefault_revertsAtDue() public {
        uint256 id = _goodsReady(_terms());
        (, uint256 due,,,) = escrow.deadlines(id);
        vm.warp(due);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.DeadlineNotReached.selector, due));
        escrow.claimBuyerDefault(id);
    }

    function test_buyerDefault_revertsOnceBalanceFunded() public {
        uint256 id = _balanceFunded(_terms());
        vm.warp(block.timestamp + 365 days);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.InvalidState.selector, id, DealState.BalanceFunded));
        escrow.claimBuyerDefault(id);
    }

    function test_buyerDefault_isTerminal() public {
        uint256 id = _goodsReady(_terms());
        _pastBalanceDue(id);
        escrow.claimBuyerDefault(id);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.InvalidState.selector, id, DealState.BuyerDefaulted));
        escrow.fundBalance(id);
    }

    function test_buyerDefault_releaseFailureCanBeRetried() public {
        uint256 id = _goodsReady(_terms());
        _pastBalanceDue(id);
        bond.setFailures(false, true);
        escrow.claimBuyerDefault(id);
        assertEq(uint8(escrow.getDeal(id).bondPending), uint8(BondSettlement.Release));

        bond.setFailures(false, false);
        escrow.retryBondSettlement(id);

        assertEq(uint8(escrow.getDeal(id).bondPending), uint8(BondSettlement.None));
        assertEq(uint8(bond.bondOf(id).status), uint8(BondStatus.Released));
    }
}
