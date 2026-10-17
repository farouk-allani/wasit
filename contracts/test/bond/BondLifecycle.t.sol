// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAdvanceBond} from "../../src/interfaces/IAdvanceBond.sol";
import {IWasitEscrow} from "../../src/interfaces/IWasitEscrow.sol";
import {AttestationKind, BondSettlement, BondStatus, DealState} from "../../src/libraries/WasitTypes.sol";
import {MockOracle} from "../mocks/MockOracle.sol";
import {BondBase} from "../utils/BondBase.t.sol";

contract BondLifecycleTest is BondBase {
    // ── topUp ──

    function test_topUp_byAnyone() public {
        uint256 id = _create(_terms());
        _post(id, 0.06e18);
        btc.mint(stranger, 1e18);
        vm.startPrank(stranger);
        btc.approve(address(advanceBond), 0.02e18);
        vm.expectEmit(address(advanceBond));
        emit IAdvanceBond.BondToppedUp(id, stranger, 0.02e18, 21_440); // 6,400 / 2,985
        advanceBond.topUp(id, 0.02e18);

        assertEq(advanceBond.bondOf(id).btcHeld, 0.08e18);
        assertEq(btc.balanceOf(address(advanceBond)), 0.08e18);
    }

    function test_topUp_worksWhileOracleIsDown() public {
        uint256 id = _create(_terms());
        _post(id, 0.06e18);
        oracle.setStale(true);
        vm.expectEmit(address(advanceBond));
        emit IAdvanceBond.BondToppedUp(id, agent, 0.01e18, 0);
        vm.prank(agent);
        advanceBond.topUp(id, 0.01e18);
        assertEq(advanceBond.bondOf(id).btcHeld, 0.07e18);
    }

    function test_topUp_afterAdvance() public {
        uint256 id = _advancePaid();
        vm.prank(agent);
        advanceBond.topUp(id, 0.01e18);
        assertEq(advanceBond.bondOf(id).btcHeld, 0.07e18);
    }

    function test_topUp_reverts() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(IAdvanceBond.NoActiveBond.selector, 7));
        advanceBond.topUp(7, 1);
        uint256 id = _create(_terms());
        _post(id, 0.06e18);
        vm.prank(agent);
        vm.expectRevert(IAdvanceBond.ZeroAmount.selector);
        advanceBond.topUp(id, 0);
    }

    // ── withdraw ──

    function test_withdraw_beforeAdvance() public {
        uint256 id = _accepted(_terms());
        _post(id, 0.06e18);
        uint256 before = btc.balanceOf(agent);

        vm.expectEmit(address(advanceBond));
        emit IAdvanceBond.BondWithdrawn(id, agent, 0.06e18);
        vm.prank(agent);
        advanceBond.withdraw(id);

        assertEq(btc.balanceOf(agent), before + 0.06e18);
        assertEq(uint8(advanceBond.bondOf(id).status), uint8(BondStatus.Released));
        assertEq(btc.balanceOf(address(advanceBond)), 0);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.BondNotReady.selector, id));
        escrow.fundAdvance(id);

        _post(id, 0.06e18); // the bonder can post again while the deal is open
        assertEq(uint8(advanceBond.bondOf(id).status), uint8(BondStatus.Active));
    }

    function test_withdraw_revertsAfterAdvance() public {
        uint256 id = _advancePaid();
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(IAdvanceBond.DealNotOpenForBond.selector, id));
        advanceBond.withdraw(id);
    }

    function test_withdraw_revertsIfNotBonder() public {
        uint256 id = _create(_terms());
        _post(id, 0.06e18);
        vm.prank(supplier);
        vm.expectRevert(IAdvanceBond.NotBonder.selector);
        advanceBond.withdraw(id);
    }

    function test_withdraw_revertsWithoutBond() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(IAdvanceBond.NoActiveBond.selector, 1));
        advanceBond.withdraw(1);
    }

    // ── release (escrow only) ──

    function test_release_onlyEscrow() public {
        vm.prank(stranger);
        vm.expectRevert(IAdvanceBond.NotEscrow.selector);
        advanceBond.release(1);
    }

    function test_cancel_returnsBondToBonder() public {
        uint256 id = _create(_terms());
        _post(id, 0.06e18);
        uint256 before = btc.balanceOf(agent);

        vm.expectEmit(address(advanceBond));
        emit IAdvanceBond.BondReleased(id, agent, 0.06e18, 0);
        vm.prank(buyer);
        escrow.cancel(id);

        assertEq(btc.balanceOf(agent), before + 0.06e18);
        assertEq(uint8(advanceBond.bondOf(id).status), uint8(BondStatus.Released));
    }

    function test_cancel_withoutPostedBondIsANoOp() public {
        uint256 id = _create(_terms());
        vm.expectEmit(address(escrow));
        emit IWasitEscrow.BondSettled(id, BondSettlement.Release, 0);
        vm.prank(supplier);
        escrow.cancel(id);
        assertEq(uint8(advanceBond.bondOf(id).status), uint8(BondStatus.None));
    }

    // ── escrow ↔ bond wiring ──

    function test_fundAdvance_requiresRatioAtFundingTime() public {
        uint256 id = _accepted(_terms());
        _post(id, 0.06e18);
        oracle.setPrice(70_000e18); // 4,200 / 2,985 = 140.7% < 150%
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.BondNotReady.selector, id));
        escrow.fundAdvance(id);

        vm.prank(agent);
        advanceBond.topUp(id, 0.01e18); // 4,900 / 2,985 = 164%
        vm.prank(buyer);
        escrow.fundAdvance(id);
        assertEq(uint8(escrow.getDeal(id).state), uint8(DealState.AdvancePaid));
    }

    function test_fundAdvance_revertsOnStaleOracle() public {
        uint256 id = _accepted(_terms());
        _post(id, 0.06e18);
        oracle.setStale(true);
        vm.prank(buyer);
        vm.expectRevert(MockOracle.StalePrice.selector);
        escrow.fundAdvance(id);
    }

    function test_happyPath_releasesBondAfterRelease() public {
        uint256 id = _advancePaid();
        _attest(id, AttestationKind.ReadyInspected, inspectorKey);
        vm.prank(buyer);
        escrow.fundBalance(id);
        _attest(id, AttestationKind.Shipped, carrierKey);
        uint256 before = btc.balanceOf(agent);
        vm.prank(buyer);
        escrow.acceptGoods(id);

        assertEq(btc.balanceOf(agent), before + 0.06e18);
        assertEq(uint8(advanceBond.bondOf(id).status), uint8(BondStatus.Released));
    }

    function test_buyerDefault_releasesBond() public {
        uint256 id = _advancePaid();
        _attest(id, AttestationKind.ReadyInspected, inspectorKey);
        (, uint256 due,,,) = escrow.deadlines(id);
        vm.warp(due + 1);
        uint256 before = btc.balanceOf(agent);
        escrow.claimBuyerDefault(id);
        assertEq(btc.balanceOf(agent), before + 0.06e18);
    }
}
