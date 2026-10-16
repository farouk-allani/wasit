// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {WasitEscrow} from "../../src/WasitEscrow.sol";
import {IAdvanceBond} from "../../src/interfaces/IAdvanceBond.sol";
import {IWasitEscrow} from "../../src/interfaces/IWasitEscrow.sol";
import {BondStatus, Deal, DealState, DealTerms} from "../../src/libraries/WasitTypes.sol";
import {EscrowBase} from "../utils/EscrowBase.t.sol";

contract FundAdvanceTest is EscrowBase {
    function test_fundAdvance_paysNetToSupplierAndHoldsFee() public {
        uint256 id = _accepted(_terms());
        uint256 fee = _advanceFee();
        uint256 buyerBefore = musd.balanceOf(buyer);
        uint256 supplierBefore = musd.balanceOf(supplier);

        vm.expectEmit(address(escrow));
        emit IWasitEscrow.AdvanceFunded(id, ADVANCE - fee, fee);
        vm.prank(buyer);
        escrow.fundAdvance(id);

        assertEq(musd.balanceOf(buyer), buyerBefore - ADVANCE);
        assertEq(musd.balanceOf(supplier), supplierBefore + ADVANCE - fee);
        assertEq(musd.balanceOf(address(escrow)), fee);
        Deal memory d = escrow.getDeal(id);
        assertEq(uint8(d.state), uint8(DealState.AdvancePaid));
        assertEq(d.advancePaidAt, block.timestamp);
        assertEq(d.advanceFeeHeld, fee);
        assertEq(escrow.accruedFees(address(musd)), 0, "fee is held, not earned");
        (uint256 readyBy,,,,) = escrow.deadlines(id);
        assertEq(readyBy, block.timestamp + 30 days);
    }

    function test_fundAdvance_withoutBondSkipsBondCheck() public {
        uint256 id = _accepted(_termsWithoutBond());
        vm.prank(buyer);
        escrow.fundAdvance(id);
        assertEq(uint8(escrow.getDeal(id).state), uint8(DealState.AdvancePaid));
    }

    function test_fundAdvance_zeroFeeSkipsEscrowTransfer() public {
        address[] memory tokens = new address[](1);
        tokens[0] = address(musd);
        escrow = new WasitEscrow(owner, IAdvanceBond(address(bond)), feeRecipient, 0, tokens);
        vm.prank(buyer);
        musd.approve(address(escrow), type(uint256).max);
        DealTerms memory t = _termsWithoutBond();
        t.feeBps = 0;
        uint256 id = _accepted(t);

        vm.prank(buyer);
        escrow.fundAdvance(id);

        assertEq(musd.balanceOf(address(escrow)), 0);
        assertEq(escrow.getDeal(id).advanceFeeHeld, 0);
    }

    function test_fundAdvance_revertsIfNotBuyer() public {
        uint256 id = _accepted(_terms());
        vm.prank(supplier);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.Unauthorized.selector, supplier));
        escrow.fundAdvance(id);
    }

    function test_fundAdvance_revertsBeforeSupplierAccepts() public {
        uint256 id = _create(_terms());
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.InvalidState.selector, id, DealState.Created));
        escrow.fundAdvance(id);
    }

    function test_fundAdvance_revertsTwice() public {
        uint256 id = _advancePaid(_terms());
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.InvalidState.selector, id, DealState.AdvancePaid));
        escrow.fundAdvance(id);
    }

    function test_fundAdvance_revertsWithoutArbiterAcceptance() public {
        uint256 id = _create(_terms());
        vm.prank(supplier);
        escrow.accept(id);
        bond.setBond(id, agent, BondStatus.Active, 15_000);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.ArbiterNotAccepted.selector, id));
        escrow.fundAdvance(id);
    }

    function test_fundAdvance_revertsWithoutBond() public {
        uint256 id = _accepted(_terms());
        bond.setBond(id, agent, BondStatus.None, 0);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.BondNotReady.selector, id));
        escrow.fundAdvance(id);
    }

    function test_fundAdvance_revertsBelowBondRatio() public {
        uint256 id = _accepted(_terms());
        bond.setBond(id, agent, BondStatus.Active, 14_999);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.BondNotReady.selector, id));
        escrow.fundAdvance(id);
    }

    function test_fundAdvance_revertsOnProtectedBond() public {
        uint256 id = _accepted(_terms());
        bond.setBond(id, agent, BondStatus.Protected, 20_000);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.BondNotReady.selector, id));
        escrow.fundAdvance(id);
    }

    function test_fundAdvance_revertsWithoutAllowance() public {
        uint256 id = _accepted(_terms());
        vm.startPrank(buyer);
        musd.approve(address(escrow), 0);
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientAllowance.selector, address(escrow), 0, ADVANCE - _advanceFee()
            )
        );
        escrow.fundAdvance(id);
    }

    // ── permit ──

    function test_fundAdvanceWithPermit_noPriorAllowance() public {
        uint256 id = _accepted(_terms());
        vm.prank(buyer);
        musd.approve(address(escrow), 0);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSignature(buyerKey, address(escrow), ADVANCE, deadline);

        vm.prank(buyer);
        escrow.fundAdvanceWithPermit(id, deadline, v, r, s);

        assertEq(uint8(escrow.getDeal(id).state), uint8(DealState.AdvancePaid));
        assertEq(musd.allowance(buyer, address(escrow)), 0);
    }

    function test_fundAdvanceWithPermit_survivesFrontRunPermit() public {
        uint256 id = _accepted(_terms());
        vm.prank(buyer);
        musd.approve(address(escrow), 0);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSignature(buyerKey, address(escrow), ADVANCE, deadline);
        musd.permit(buyer, address(escrow), ADVANCE, deadline, v, r, s); // front-runner uses it first

        vm.prank(buyer);
        escrow.fundAdvanceWithPermit(id, deadline, v, r, s);

        assertEq(uint8(escrow.getDeal(id).state), uint8(DealState.AdvancePaid));
    }

    function test_fundAdvanceWithPermit_badPermitFallsBackToAllowance() public {
        uint256 id = _accepted(_terms());
        vm.prank(buyer);
        escrow.fundAdvanceWithPermit(id, 0, 0, bytes32(0), bytes32(0)); // garbage permit, max allowance set
        assertEq(uint8(escrow.getDeal(id).state), uint8(DealState.AdvancePaid));
    }

    function testFuzz_fundAdvance_splitsExactly(uint128 advance) public {
        advance = uint128(bound(advance, 1, 1_000_000e18));
        DealTerms memory t = _terms();
        t.advanceAmount = advance;
        uint256 id = _accepted(t);
        uint256 supplierBefore = musd.balanceOf(supplier);

        vm.prank(buyer);
        escrow.fundAdvance(id);

        uint256 toSupplier = musd.balanceOf(supplier) - supplierBefore;
        uint256 held = musd.balanceOf(address(escrow));
        assertEq(toSupplier + held, advance);
        assertEq(held, escrow.getDeal(id).advanceFeeHeld);
        (, uint256 covered,,) = escrow.bondTerms(id);
        assertEq(covered, toSupplier, "bond covers exactly what the supplier received");
    }
}
