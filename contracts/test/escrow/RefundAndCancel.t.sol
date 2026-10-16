// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {IWasitEscrow} from "../../src/interfaces/IWasitEscrow.sol";
import {BondSettlement, BondStatus, DealState} from "../../src/libraries/WasitTypes.sol";
import {EscrowBase} from "../utils/EscrowBase.t.sol";

contract RefundAndCancelTest is EscrowBase {
    uint256 internal constant NET_ADVANCE = 2_985e18;

    function test_refundAndCancel_fromAdvancePaidMakesBuyerWhole() public {
        uint256 buyerStart = musd.balanceOf(buyer);
        uint256 id = _advancePaid(_terms());
        uint256 supplierBefore = musd.balanceOf(supplier);

        vm.expectEmit(address(escrow));
        emit IWasitEscrow.DealCancelled(id, supplier, ADVANCE);
        vm.expectEmit(address(escrow));
        emit IWasitEscrow.BondSettled(id, BondSettlement.Release, 0);
        vm.prank(supplier);
        escrow.refundAndCancel(id);

        assertEq(musd.balanceOf(buyer), buyerStart);
        assertEq(musd.balanceOf(supplier), supplierBefore - NET_ADVANCE, "supplier returns only what it got");
        assertEq(musd.balanceOf(address(escrow)), 0);
        assertEq(escrow.accruedFees(address(musd)), 0);
        assertEq(uint8(escrow.getDeal(id).state), uint8(DealState.Cancelled));
        assertEq(uint8(bond.bondOf(id).status), uint8(BondStatus.Released));
    }

    function test_refundAndCancel_fromGoodsReady() public {
        uint256 buyerStart = musd.balanceOf(buyer);
        uint256 id = _goodsReady(_terms());
        vm.prank(supplier);
        escrow.refundAndCancel(id);
        assertEq(musd.balanceOf(buyer), buyerStart);
    }

    function test_refundAndCancel_fromBalanceFundedRefundsAll() public {
        uint256 buyerStart = musd.balanceOf(buyer);
        uint256 id = _balanceFunded(_terms());

        vm.expectEmit(address(escrow));
        emit IWasitEscrow.DealCancelled(id, supplier, ADVANCE + BALANCE);
        vm.prank(supplier);
        escrow.refundAndCancel(id);

        assertEq(musd.balanceOf(buyer), buyerStart);
        assertEq(musd.balanceOf(address(escrow)), 0);
    }

    function test_refundAndCancel_revertsIfNotSupplier() public {
        uint256 id = _advancePaid(_terms());
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.Unauthorized.selector, buyer));
        escrow.refundAndCancel(id);
    }

    function test_refundAndCancel_revertsBeforeAdvance() public {
        uint256 id = _accepted(_terms());
        vm.prank(supplier);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.InvalidState.selector, id, DealState.Accepted));
        escrow.refundAndCancel(id);
    }

    function test_refundAndCancel_revertsAfterShipment() public {
        uint256 id = _shipped(_terms());
        vm.prank(supplier);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.InvalidState.selector, id, DealState.Shipped));
        escrow.refundAndCancel(id);
    }

    function test_refundAndCancel_revertsWithoutSupplierAllowance() public {
        uint256 id = _advancePaid(_terms());
        vm.startPrank(supplier);
        musd.approve(address(escrow), 0);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(escrow), 0, NET_ADVANCE)
        );
        escrow.refundAndCancel(id);
    }
}
