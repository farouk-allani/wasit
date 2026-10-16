// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IWasitEscrow} from "../../src/interfaces/IWasitEscrow.sol";
import {BondSettlement, BondStatus, Deal, DealState, DealTerms} from "../../src/libraries/WasitTypes.sol";
import {EscrowBase} from "../utils/EscrowBase.t.sol";

contract ReleaseTest is EscrowBase {
    uint256 internal constant BALANCE_FEE = uint256(BALANCE) * DEFAULT_FEE_BPS / 10_000; // 35e18

    function _afterWindow(uint256 id) internal {
        (,,, uint256 challengeEnds,) = escrow.deadlines(id);
        vm.warp(challengeEnds + 1);
    }

    function test_release_afterWindowPaysSupplierAndEarnsFees() public {
        uint256 id = _shipped(_terms());
        _afterWindow(id);
        uint256 supplierBefore = musd.balanceOf(supplier);

        vm.expectEmit(address(escrow));
        emit IWasitEscrow.Released(id, BALANCE - BALANCE_FEE, BALANCE_FEE + _advanceFee());
        vm.expectEmit(address(escrow));
        emit IWasitEscrow.BondSettled(id, BondSettlement.Release, 0);
        vm.prank(keeper);
        escrow.release(id);

        assertEq(musd.balanceOf(supplier), supplierBefore + BALANCE - BALANCE_FEE);
        assertEq(escrow.accruedFees(address(musd)), 50e18);
        assertEq(musd.balanceOf(address(escrow)), 50e18, "only earned fees remain");
        Deal memory d = escrow.getDeal(id);
        assertEq(uint8(d.state), uint8(DealState.Released));
        assertEq(d.balanceHeld, 0);
        assertEq(d.advanceFeeHeld, 0);
        assertEq(uint8(bond.bondOf(id).status), uint8(BondStatus.Released));
    }

    function test_release_fullFlowConservesMoney() public {
        uint256 buyerStart = musd.balanceOf(buyer);
        uint256 supplierStart = musd.balanceOf(supplier);
        uint256 id = _shipped(_terms());
        _afterWindow(id);
        escrow.release(id);

        uint256 paidByBuyer = buyerStart - musd.balanceOf(buyer);
        uint256 receivedBySupplier = musd.balanceOf(supplier) - supplierStart;
        assertEq(paidByBuyer, 10_000e18);
        assertEq(receivedBySupplier, 9_950e18);
        assertEq(paidByBuyer, receivedBySupplier + escrow.accruedFees(address(musd)));
    }

    function test_release_revertsInsideWindow() public {
        uint256 id = _shipped(_terms());
        (,,, uint256 challengeEnds,) = escrow.deadlines(id);
        vm.warp(challengeEnds);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.DeadlineNotReached.selector, challengeEnds));
        escrow.release(id);
    }

    function test_release_revertsBeforeShipment() public {
        uint256 id = _balanceFunded(_terms());
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.InvalidState.selector, id, DealState.BalanceFunded));
        escrow.release(id);
    }

    function test_release_isTerminal() public {
        uint256 id = _shipped(_terms());
        _afterWindow(id);
        escrow.release(id);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.InvalidState.selector, id, DealState.Released));
        escrow.release(id);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.InvalidState.selector, id, DealState.Released));
        escrow.acceptGoods(id);
    }

    function test_release_withoutBondSkipsBond() public {
        uint256 id = _shipped(_termsWithoutBond());
        _afterWindow(id);
        escrow.release(id);
        assertEq(bond.releaseCalls(), 0);
    }

    function test_release_bondFailureStillPaysSupplier() public {
        uint256 id = _shipped(_terms());
        _afterWindow(id);
        bond.setFailures(false, true);
        uint256 supplierBefore = musd.balanceOf(supplier);

        escrow.release(id);

        assertEq(musd.balanceOf(supplier), supplierBefore + BALANCE - BALANCE_FEE);
        assertEq(uint8(escrow.getDeal(id).bondPending), uint8(BondSettlement.Release));
    }

    function test_acceptGoods_releasesEarly() public {
        uint256 id = _shipped(_terms());
        uint256 supplierBefore = musd.balanceOf(supplier);
        vm.prank(buyer);
        escrow.acceptGoods(id);
        assertEq(musd.balanceOf(supplier), supplierBefore + BALANCE - BALANCE_FEE);
        assertEq(uint8(escrow.getDeal(id).state), uint8(DealState.Released));
    }

    function test_acceptGoods_alsoAfterWindow() public {
        uint256 id = _shipped(_terms());
        _afterWindow(id);
        vm.prank(buyer);
        escrow.acceptGoods(id);
        assertEq(uint8(escrow.getDeal(id).state), uint8(DealState.Released));
    }

    function test_acceptGoods_revertsIfNotBuyer() public {
        uint256 id = _shipped(_terms());
        vm.prank(supplier);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.Unauthorized.selector, supplier));
        escrow.acceptGoods(id);
    }

    function testFuzz_release_supplierPlusFeesEqualsPaid(uint128 advance, uint128 balance) public {
        advance = uint128(bound(advance, 1, 1_000_000e18));
        balance = uint128(bound(balance, 1, 900_000e18));
        DealTerms memory t = _terms();
        t.advanceAmount = advance;
        t.balanceAmount = balance;
        musd.mint(buyer, uint256(advance) + balance);
        uint256 supplierStart = musd.balanceOf(supplier);

        uint256 id = _shipped(t);
        _afterWindow(id);
        escrow.release(id);

        uint256 received = musd.balanceOf(supplier) - supplierStart;
        uint256 fees = escrow.accruedFees(address(musd));
        assertEq(received + fees, uint256(advance) + balance);
        assertLe(fees * 10_000, (uint256(advance) + balance) * DEFAULT_FEE_BPS, "fees never exceed the rate");
        assertEq(musd.balanceOf(address(escrow)), fees);
    }
}
