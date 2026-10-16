// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IWasitEscrow} from "../../src/interfaces/IWasitEscrow.sol";
import {BondSettlement, DealState} from "../../src/libraries/WasitTypes.sol";
import {EscrowBase} from "../utils/EscrowBase.t.sol";

/// @notice Regression tests for the midpoint security review (docs-dev/SECURITY-REVIEW.md).
contract HardeningTest is EscrowBase {
    // F-1: a caller cannot starve the bond call inside try/catch to leave the claim pending.

    function test_F1_lowGasCannotForcePendingClaim() public {
        uint256 id = _advancePaid(_terms());
        (uint256 readyBy,,,,) = escrow.deadlines(id);
        vm.warp(readyBy + 1);

        vm.expectRevert(IWasitEscrow.InsufficientGasForBond.selector);
        escrow.claimSupplierDefault{gas: 900_000}(id);

        assertEq(uint8(escrow.getDeal(id).state), uint8(DealState.AdvancePaid), "nothing happened");
    }

    function test_F1_enoughGasSettlesTheBond() public {
        uint256 id = _advancePaid(_terms());
        (uint256 readyBy,,,,) = escrow.deadlines(id);
        vm.warp(readyBy + 1);

        escrow.claimSupplierDefault{gas: 1_300_000}(id);

        assertEq(uint8(escrow.getDeal(id).bondPending), uint8(BondSettlement.None));
        assertEq(uint8(escrow.getDeal(id).state), uint8(DealState.SupplierDefaulted));
    }

    function test_F1_unbondedDealsNeedNoGasFloor() public {
        uint256 id = _advancePaid(_termsWithoutBond());
        (uint256 readyBy,,,,) = escrow.deadlines(id);
        vm.warp(readyBy + 1);
        escrow.claimSupplierDefault{gas: 300_000}(id);
        assertEq(uint8(escrow.getDeal(id).state), uint8(DealState.SupplierDefaulted));
    }

    // F-2: permit wrappers check the deal before touching the token.

    function test_F2_permitWrappersRevertWithStateOnUnknownDeal() public {
        vm.startPrank(buyer);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.InvalidState.selector, 42, DealState.None));
        escrow.fundAdvanceWithPermit(42, 0, 0, bytes32(0), bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.InvalidState.selector, 42, DealState.None));
        escrow.fundBalanceWithPermit(42, 0, 0, bytes32(0), bytes32(0));
    }

    function test_F2_permitWrappersRevertWithStateOnWrongStep() public {
        uint256 id = _create(_terms());
        vm.startPrank(buyer);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.InvalidState.selector, id, DealState.Created));
        escrow.fundAdvanceWithPermit(id, 0, 0, bytes32(0), bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.InvalidState.selector, id, DealState.Created));
        escrow.fundBalanceWithPermit(id, 0, 0, bytes32(0), bytes32(0));
    }
}
