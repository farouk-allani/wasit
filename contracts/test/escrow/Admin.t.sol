// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IWasitEscrow} from "../../src/interfaces/IWasitEscrow.sol";
import {AttestationKind, BondStatus, DealState, DealTerms} from "../../src/libraries/WasitTypes.sol";
import {EscrowBase} from "../utils/EscrowBase.t.sol";

contract AdminTest is EscrowBase {
    // ── config ──

    function test_setFeeRecipient() public {
        vm.expectEmit(address(escrow));
        emit IWasitEscrow.FeeRecipientSet(stranger);
        vm.prank(owner);
        escrow.setFeeRecipient(stranger);
        assertEq(escrow.feeRecipient(), stranger);
    }

    function test_setDefaultFee() public {
        vm.expectEmit(address(escrow));
        emit IWasitEscrow.DefaultFeeSet(100);
        vm.prank(owner);
        escrow.setDefaultFee(100);
        assertEq(escrow.defaultFeeBps(), 100);
    }

    function test_setTokenAllowed() public {
        vm.expectEmit(address(escrow));
        emit IWasitEscrow.TokenAllowed(stranger, true);
        vm.prank(owner);
        escrow.setTokenAllowed(stranger, true);
        assertTrue(escrow.isTokenAllowed(stranger));
    }

    function test_config_revertsOnBadValues() public {
        vm.startPrank(owner);
        vm.expectRevert(IWasitEscrow.ZeroAddress.selector);
        escrow.setFeeRecipient(address(0));
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.FeeTooHigh.selector, 101));
        escrow.setDefaultFee(101);
        vm.expectRevert(IWasitEscrow.ZeroAddress.selector);
        escrow.setTokenAllowed(address(0), true);
    }

    function test_config_onlyOwner() public {
        bytes memory err = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger);
        vm.startPrank(stranger);
        vm.expectRevert(err);
        escrow.setFeeRecipient(stranger);
        vm.expectRevert(err);
        escrow.setDefaultFee(0);
        vm.expectRevert(err);
        escrow.setTokenAllowed(stranger, true);
        vm.expectRevert(err);
        escrow.pause();
        vm.expectRevert(err);
        escrow.unpause();
    }

    function test_ownershipTransferIsTwoStep() public {
        vm.prank(owner);
        escrow.transferOwnership(stranger);
        assertEq(escrow.owner(), owner);
        assertEq(escrow.pendingOwner(), stranger);
        vm.prank(stranger);
        escrow.acceptOwnership();
        assertEq(escrow.owner(), stranger);
    }

    // ── existing deals are out of the owner's reach ──

    function test_feeChangeDoesNotTouchExistingDeal() public {
        uint256 id = _create(_terms());
        vm.prank(owner);
        escrow.setDefaultFee(100);

        assertEq(escrow.getDeal(id).terms.feeBps, DEFAULT_FEE_BPS);
        DealTerms memory t = _terms();
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.FeeMismatch.selector, 100, DEFAULT_FEE_BPS));
        escrow.createDeal(t);
    }

    function test_delistedTokenStillSettlesExistingDeal() public {
        uint256 id = _shipped(_terms());
        vm.prank(owner);
        escrow.setTokenAllowed(address(musd), false);

        vm.prank(buyer);
        escrow.acceptGoods(id);
        assertEq(uint8(escrow.getDeal(id).state), uint8(DealState.Released));

        DealTerms memory t = _terms();
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.TokenNotAllowed.selector, address(musd)));
        escrow.createDeal(t);
    }

    function test_ownerHoldsNoDealRole() public {
        uint256 id = _shipped(_terms());
        bytes memory err = abi.encodeWithSelector(IWasitEscrow.Unauthorized.selector, owner);
        vm.startPrank(owner);
        vm.expectRevert(err);
        escrow.acceptGoods(id);
        vm.expectRevert(err);
        escrow.dispute(id, bytes32(0));
        vm.stopPrank();

        vm.prank(buyer);
        escrow.dispute(id, bytes32(0));
        vm.prank(owner);
        vm.expectRevert(err);
        escrow.resolve(id, 10_000, 0);

        uint256 fresh = _advancePaid(_terms());
        vm.prank(owner);
        vm.expectRevert(err);
        escrow.refundAndCancel(fresh);
    }

    // ── pause: new deals only ──

    function test_pause_blocksOnlyCreation() public {
        vm.prank(owner);
        escrow.pause();
        DealTerms memory t = _terms();
        vm.prank(buyer);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        escrow.createDeal(t);

        vm.prank(owner);
        escrow.unpause();
        _create(t);
    }

    function test_pause_fullLifecycleStillWorks() public {
        uint256 id = _create(_terms());
        vm.prank(owner);
        escrow.pause();

        vm.prank(supplier);
        escrow.accept(id);
        vm.prank(arbiter);
        escrow.acceptArbiter(id);
        bond.setBond(id, agent, BondStatus.Active, 15_000);
        vm.prank(buyer);
        escrow.fundAdvance(id);
        _attest(id, AttestationKind.ReadyInspected, inspectorKey);
        vm.prank(buyer);
        escrow.fundBalance(id);
        _attest(id, AttestationKind.Shipped, carrierKey);
        (,,, uint256 challengeEnds,) = escrow.deadlines(id);
        vm.warp(challengeEnds + 1);
        escrow.release(id);
        escrow.withdrawFees(address(musd));

        assertEq(uint8(escrow.getDeal(id).state), uint8(DealState.Released));
        assertTrue(escrow.paused());
    }

    function test_pause_exitsStillWork() public {
        uint256 cancelled = _create(_terms());
        uint256 supplierDefault = _advancePaid(_terms());
        uint256 buyerDefault = _goodsReady(_terms());
        uint256 refunded = _advancePaid(_terms());
        uint256 resolved = _disputed(_terms());
        vm.prank(owner);
        escrow.pause();

        vm.prank(buyer);
        escrow.cancel(cancelled);
        vm.prank(supplier);
        escrow.refundAndCancel(refunded);
        vm.prank(arbiter);
        escrow.resolve(resolved, 5_000, 5_000);
        vm.warp(block.timestamp + 31 days);
        escrow.claimSupplierDefault(supplierDefault);
        escrow.claimBuyerDefault(buyerDefault);

        assertEq(uint8(escrow.getDeal(cancelled).state), uint8(DealState.Cancelled));
        assertEq(uint8(escrow.getDeal(refunded).state), uint8(DealState.Cancelled));
        assertEq(uint8(escrow.getDeal(resolved).state), uint8(DealState.Resolved));
        assertEq(uint8(escrow.getDeal(supplierDefault).state), uint8(DealState.SupplierDefaulted));
        assertEq(uint8(escrow.getDeal(buyerDefault).state), uint8(DealState.BuyerDefaulted));
    }

    // ── fees ──

    function test_withdrawFees_byAnyoneToRecipient() public {
        uint256 id = _shipped(_terms());
        vm.prank(buyer);
        escrow.acceptGoods(id);

        vm.expectEmit(address(escrow));
        emit IWasitEscrow.FeesWithdrawn(address(musd), feeRecipient, 50e18);
        vm.prank(stranger);
        escrow.withdrawFees(address(musd));

        assertEq(musd.balanceOf(feeRecipient), 50e18);
        assertEq(escrow.accruedFees(address(musd)), 0);
        assertEq(musd.balanceOf(address(escrow)), 0);
    }

    function test_withdrawFees_followsRecipientChange() public {
        uint256 id = _shipped(_terms());
        vm.prank(buyer);
        escrow.acceptGoods(id);
        vm.prank(owner);
        escrow.setFeeRecipient(stranger);
        escrow.withdrawFees(address(musd));
        assertEq(musd.balanceOf(stranger), 50e18);
    }

    function test_withdrawFees_cannotTouchHeldBalances() public {
        _balanceFunded(_terms()); // 7,015 held, nothing earned
        vm.expectRevert(IWasitEscrow.NothingToWithdraw.selector);
        escrow.withdrawFees(address(musd));
        assertEq(musd.balanceOf(address(escrow)), 7_015e18);
    }
}
