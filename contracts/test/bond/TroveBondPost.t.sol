// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TroveBond} from "../../src/TroveBond.sol";
import {TroveVault} from "../../src/TroveVault.sol";
import {IAdvanceBond} from "../../src/interfaces/IAdvanceBond.sol";
import {IBorrowerOperations} from "../../src/interfaces/IMusdBorrowing.sol";
import {IPriceOracle} from "../../src/interfaces/IPriceOracle.sol";
import {IWasitEscrow} from "../../src/interfaces/IWasitEscrow.sol";
import {Bond, BondStatus} from "../../src/libraries/WasitTypes.sol";
import {TroveBondBase} from "../utils/TroveBondBase.t.sol";

contract TroveBondPostTest is TroveBondBase {
    function test_postOpensATroveAndKeepsTheFloorAsMusdCover() public {
        uint256 id = _accepted(_tradeTerms());
        vm.expectEmit(true, true, false, true, address(troveBond));
        emit IAdvanceBond.BondPosted(id, agent, 0.06 ether, (1_800e18 * 10_000) / T_COVERED);
        _post(id, 0.06 ether);

        TroveVault vault = troveBond.vaultOf(id);
        assertEq(vault.bond(), address(troveBond));
        assertEq(musd.balanceOf(address(vault)), 1_800e18, "max(895.5 x 120%, 1,800) = 1,800");
        assertEq(sys.getTroveStatus(address(vault)), 1);
        assertEq(sys.getTroveColl(address(vault)), 0.06 ether);
        assertEq(sys.getTroveDebt(address(vault)), 1_800e18 + 1.8e18 + 200e18, "fee and gas comp on top");
        assertEq(troveBond.coverageBps(id), 20_100, "201% of the net advance, in MUSD");

        Bond memory b = troveBond.bondOf(id);
        assertEq(b.bonder, agent);
        assertEq(address(b.oracle), address(oracle));
        assertEq(b.covered, T_COVERED);
        assertEq(b.btcHeld, 0.06 ether);
        assertEq(b.musdHeld, 1_800e18);
        assertEq(uint8(b.status), uint8(BondStatus.Active));
    }

    function test_coverageDoesNotMoveWithBtc() public {
        uint256 id = _accepted(_tradeTerms());
        _post(id, 0.06 ether);
        uint256 before = troveBond.coverageBps(id);
        sys.setPrice(30_000e18);
        oracle.setPrice(30_000e18);
        assertEq(troveBond.coverageBps(id), before);
    }

    function test_largeAdvanceBorrowsCoveredTimesRatio() public {
        uint256 id = _accepted(_terms()); // 3,000 up front at 150%: 2,985 x 1.5 = 4,477.5
        _post(id, 0.2 ether);
        assertEq(musd.balanceOf(address(troveBond.vaultOf(id))), 4_477.5e18);
        assertEq(troveBond.coverageBps(id), 15_000);
    }

    function test_coverageMeetsTheRatioSoTheEscrowAcceptsTheAdvance() public {
        uint256 id = _advancePaid();
        assertEq(uint8(escrow.getDeal(id).state), 3, "AdvancePaid");
    }

    function test_postRevertsForAStranger() public {
        uint256 id = _accepted(_tradeTerms());
        vm.prank(stranger);
        vm.expectRevert(TroveBond.NotBonder.selector);
        troveBond.post{value: 0.06 ether}(id, address(0), address(0));
    }

    function test_postRevertsTwice() public {
        uint256 id = _accepted(_tradeTerms());
        _post(id, 0.06 ether);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(TroveBond.BondExists.selector, id));
        troveBond.post{value: 0.06 ether}(id, address(0), address(0));
    }

    function test_postRevertsWithoutValue() public {
        uint256 id = _accepted(_tradeTerms());
        vm.prank(agent);
        vm.expectRevert(TroveBond.ZeroAmount.selector);
        troveBond.post(id, address(0), address(0));
    }

    function test_postRevertsAfterTheAdvanceAndWithoutABonder() public {
        uint256 id = _advancePaid();
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(TroveBond.DealNotOpenForBond.selector, id));
        troveBond.post{value: 0.06 ether}(id, address(0), address(0));

        vm.prank(buyer);
        uint256 unbonded = escrow.createDeal(_termsWithoutBond());
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(TroveBond.DealNotOpenForBond.selector, unbonded));
        troveBond.post{value: 0.06 ether}(unbonded, address(0), address(0));
    }

    function test_postRevertsWhenTheMusdSystemRefusesTheCollateral() public {
        uint256 id = _accepted(_tradeTerms());
        vm.prank(agent);
        vm.expectRevert("BorrowerOps: ICR too low");
        troveBond.post{value: 0.03 ether}(id, address(0), address(0)); // ~100%
    }

    function test_topUpByAnyoneAddsCollateral() public {
        uint256 id = _accepted(_tradeTerms());
        _post(id, 0.06 ether);
        vm.expectEmit(true, true, false, true, address(troveBond));
        emit IAdvanceBond.BondToppedUp(id, stranger, 0.01 ether, troveBond.coverageBps(id));
        vm.prank(stranger);
        troveBond.topUp{value: 0.01 ether}(id, address(0), address(0));
        assertEq(sys.getTroveColl(address(troveBond.vaultOf(id))), 0.07 ether);
        assertEq(troveBond.bondOf(id).btcHeld, 0.07 ether);
    }

    function test_topUpReverts() public {
        uint256 id = _accepted(_tradeTerms());
        vm.expectRevert(abi.encodeWithSelector(TroveBond.NoTrove.selector, id));
        troveBond.topUp{value: 1}(id, address(0), address(0));
        _post(id, 0.06 ether);
        vm.expectRevert(TroveBond.ZeroAmount.selector);
        troveBond.topUp(id, address(0), address(0));
    }

    function test_withdrawBeforeTheAdvanceFreesTheBond() public {
        uint256 id = _accepted(_tradeTerms());
        _post(id, 0.06 ether);
        vm.expectEmit(true, true, false, true, address(troveBond));
        emit IAdvanceBond.BondWithdrawn(id, agent, 0);
        vm.prank(agent);
        troveBond.withdraw(id);
        assertEq(uint8(troveBond.bondOf(id).status), uint8(BondStatus.Released));
    }

    function test_withdrawReverts() public {
        uint256 id = _accepted(_tradeTerms());
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(TroveBond.NoActiveBond.selector, id));
        troveBond.withdraw(id);
        _post(id, 0.06 ether);
        vm.prank(stranger);
        vm.expectRevert(TroveBond.NotBonder.selector);
        troveBond.withdraw(id);
        vm.prank(buyer);
        escrow.fundAdvance(id);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(TroveBond.DealNotOpenForBond.selector, id));
        troveBond.withdraw(id);
    }

    function test_protectIsNotApplicable() public {
        vm.expectRevert(TroveBond.ProtectNotApplicable.selector);
        troveBond.protect(1);
    }

    function test_troveHealthReportsTheBondersRisk() public {
        (uint256 icr0, uint8 status0, uint256 price0) = troveBond.troveHealth(1);
        assertEq(icr0 + status0 + price0, 0, "no vault yet");
        uint256 id = _accepted(_tradeTerms());
        _post(id, 0.06 ether);
        (uint256 icr, uint8 status, uint256 price) = troveBond.troveHealth(id);
        assertEq(status, 1);
        assertEq(price, PRICE);
        assertEq(icr, (0.06 ether * PRICE) / 2_001.8e18);
        oracle.setStale(true);
        (icr, status, price) = troveBond.troveHealth(id);
        assertEq(icr, 0, "unavailable price: no ratio shown");
        assertEq(price, 0);
        assertEq(status, 1);
    }

    function test_coverageIsZeroWithoutABond() public view {
        assertEq(troveBond.coverageBps(42), 0);
        assertEq(uint8(troveBond.bondOf(42).status), uint8(BondStatus.None));
    }

    function test_constructorRejectsBadConfig() public {
        vm.expectRevert(TroveBond.InvalidConfig.selector);
        new TroveBond(IWasitEscrow(address(0)), sys, oracle);
        vm.expectRevert(TroveBond.InvalidConfig.selector);
        new TroveBond(escrow, sys, IPriceOracle(address(0)));
        vm.expectRevert(TroveBond.InvalidConfig.selector);
        new TroveBond(escrow, IBorrowerOperations(address(0xBEEF)), oracle);
    }
}
