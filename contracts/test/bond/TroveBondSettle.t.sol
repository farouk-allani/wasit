// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TroveBond} from "../../src/TroveBond.sol";
import {TroveVault} from "../../src/TroveVault.sol";
import {IAdvanceBond} from "../../src/interfaces/IAdvanceBond.sol";
import {AttestationKind, BondStatus, DealState, DealTerms} from "../../src/libraries/WasitTypes.sol";
import {TroveBondBase} from "../utils/TroveBondBase.t.sol";

contract TroveBondSettleTest is TroveBondBase {
    uint256 internal constant FEE = 1.8e18; // 0.1% of the 1,800 drawn

    function _shipped(uint256 id) internal {
        _attest(id, AttestationKind.ReadyInspected, inspectorKey);
        vm.prank(buyer);
        escrow.fundBalance(id);
        _attest(id, AttestationKind.Shipped, carrierKey);
    }

    function _released() internal returns (uint256 id) {
        id = _advancePaid();
        _shipped(id);
        (,,, uint256 challengeEnds,) = escrow.deadlines(id);
        vm.warp(challengeEnds + 1);
        escrow.release(id);
    }

    function _defaulted() internal returns (uint256 id) {
        id = _advancePaid();
        (uint256 readyBy,,,,) = escrow.deadlines(id);
        vm.warp(readyBy + 1);
        escrow.claimSupplierDefault(id);
    }

    function _vault(uint256 id) internal view returns (address) {
        return address(troveBond.vaultOf(id));
    }

    // ── happy path ──

    function test_releaseThenCloseReturnsTheBtcForFeeAndInterest() public {
        uint256 id = _released();
        assertEq(uint8(troveBond.bondOf(id).status), uint8(BondStatus.Released));
        assertEq(musd.balanceOf(_vault(id)), 1_800e18, "release moves nothing");
        sys.accrue(_vault(id), 2e18); // interest while the deal ran

        uint256 agentMusd = musd.balanceOf(agent);
        uint256 agentBtc = agent.balance;
        vm.expectEmit(true, true, false, true, address(troveBond));
        emit TroveBond.BondClosed(id, agent, 1_800e18 + FEE + 2e18, 0.06 ether, 0);
        vm.prank(agent);
        troveBond.close(id);

        assertEq(musd.balanceOf(agent), agentMusd - FEE - 2e18, "the bonder pays fee + interest only");
        assertEq(agent.balance, agentBtc + 0.06 ether, "all BTC back");
        assertEq(sys.getTroveStatus(_vault(id)), 2, "closedByOwner");
        assertEq(musd.balanceOf(_vault(id)), 0);
        assertEq(_vault(id).balance, 0);
        assertTrue(troveBond.closed(id));
    }

    // ── default: the buyer is paid in MUSD, no BTC sold ──

    function test_supplierDefaultPaysTheBuyerFromTheVault() public {
        uint256 buyerStart = musd.balanceOf(buyer);
        uint256 id = _defaulted();
        assertEq(musd.balanceOf(buyer), buyerStart, "buyer whole: 4.5 fee refund + 895.5 from the vault");
        assertEq(uint8(troveBond.bondOf(id).status), uint8(BondStatus.Claimed));
        assertEq(musd.balanceOf(_vault(id)), 1_800e18 - T_COVERED);
        assertEq(troveBond.bondOf(id).musdHeld, 1_800e18 - T_COVERED);
        assertEq(uint8(escrow.getDeal(id).state), uint8(DealState.SupplierDefaulted));

        // The bonder can still get the BTC back by repaying what the buyer received
        uint256 agentMusd = musd.balanceOf(agent);
        vm.prank(agent);
        troveBond.close(id);
        assertEq(musd.balanceOf(agent), agentMusd - T_COVERED - FEE);
        assertEq(sys.getTroveStatus(_vault(id)), 2);
    }

    function test_defaultAfterACrashStillPaysInFull() public {
        uint256 buyerStart = musd.balanceOf(buyer);
        uint256 id = _advancePaid();
        sys.setPrice(30_000e18); // BTC −55%: the trove is liquidated
        sys.liquidate(_vault(id));
        assertEq(troveBond.coverageBps(id), 20_100, "the cover is MUSD and did not move");

        (uint256 readyBy,,,,) = escrow.deadlines(id);
        vm.warp(readyBy + 1);
        escrow.claimSupplierDefault(id);
        assertEq(musd.balanceOf(buyer), buyerStart, "buyer whole although BTC crashed");

        uint256 agentMusd = musd.balanceOf(agent);
        vm.prank(agent);
        troveBond.close(id);
        assertEq(musd.balanceOf(agent), agentMusd + 1_800e18 - T_COVERED, "the bonder keeps what is left");
        assertEq(_vault(id).balance, 0, "the liquidated BTC is gone: the bonder's loss");
    }

    function test_liquidatedThenReleasedReturnsAllMusd() public {
        uint256 id = _advancePaid();
        sys.setPrice(30_000e18);
        sys.liquidate(_vault(id));
        _shipped(id);
        (,,, uint256 challengeEnds,) = escrow.deadlines(id);
        vm.warp(challengeEnds + 1);
        escrow.release(id);

        uint256 agentMusd = musd.balanceOf(agent);
        vm.prank(agent);
        troveBond.close(id);
        assertEq(musd.balanceOf(agent), agentMusd + 1_800e18);
    }

    function test_fullyRedeemedTroveReturnsMusdAndSurplus() public {
        uint256 id = _released();
        sys.redeemFull(_vault(id)); // 1,801.8 redeemed at 67k ≈ 0.02689 BTC; ≈ 0.0331 BTC surplus
        uint256 surplus = sys.getCollateral(_vault(id));
        assertGt(surplus, 0.03 ether);
        vm.deal(address(sys), 1 ether);

        uint256 agentMusd = musd.balanceOf(agent);
        uint256 agentBtc = agent.balance;
        vm.prank(agent);
        troveBond.close(id);
        assertEq(musd.balanceOf(agent), agentMusd + 1_800e18, "redemption took BTC, not the vault's MUSD");
        assertEq(agent.balance, agentBtc + surplus, "surplus BTC collected and returned");
    }

    function test_partiallyRedeemedTroveNeedsLessToClose() public {
        uint256 id = _released();
        sys.redeemPartial(_vault(id), 500e18);
        uint256 agentMusd = musd.balanceOf(agent);
        vm.prank(agent);
        troveBond.close(id);
        assertEq(musd.balanceOf(agent), agentMusd + 500e18 - FEE, "500 less debt: 498.2 back");
    }

    // ── recovery mode ──

    function test_recoveryModeBlocksCloseButNeverTheBuyer() public {
        uint256 id = _advancePaid();
        sys.setRecoveryMode(true);
        uint256 buyerStart = musd.balanceOf(buyer);
        (uint256 readyBy,,,,) = escrow.deadlines(id);
        vm.warp(readyBy + 1);
        escrow.claimSupplierDefault(id);
        assertEq(musd.balanceOf(buyer), buyerStart + T_ADVANCE, "claim works in recovery mode");

        vm.prank(agent);
        vm.expectRevert("BorrowerOps: Operation not permitted during Recovery Mode");
        troveBond.close(id);
        assertFalse(troveBond.closed(id), "retry stays possible");

        sys.setRecoveryMode(false);
        vm.prank(agent);
        troveBond.close(id);
        assertTrue(troveBond.closed(id));
    }

    // ── withdraw before the advance ──

    function test_withdrawThenCloseReturnsTheBtc() public {
        uint256 id = _accepted(_tradeTerms());
        _post(id, 0.06 ether);
        vm.startPrank(agent);
        troveBond.withdraw(id);
        uint256 btc = agent.balance;
        troveBond.close(id);
        vm.stopPrank();
        assertEq(agent.balance, btc + 0.06 ether);
    }

    // ── guards ──

    function test_closeGuards() public {
        vm.expectRevert(abi.encodeWithSelector(TroveBond.NoTrove.selector, 7));
        troveBond.close(7);
        uint256 id = _advancePaid();
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(TroveBond.BondStillLive.selector, id));
        troveBond.close(id);
        _shipped(id);
        (,,, uint256 challengeEnds,) = escrow.deadlines(id);
        vm.warp(challengeEnds + 1);
        escrow.release(id);
        vm.prank(stranger);
        vm.expectRevert(TroveBond.NotBonder.selector);
        troveBond.close(id);
        vm.startPrank(agent);
        troveBond.close(id);
        vm.expectRevert(abi.encodeWithSelector(TroveBond.AlreadyClosed.selector, id));
        troveBond.close(id);
        vm.expectRevert(abi.encodeWithSelector(TroveBond.NoTrove.selector, id));
        troveBond.topUp{value: 1}(id, address(0), address(0));
        vm.stopPrank();
    }

    function test_onlyTheEscrowClaimsOrReleases() public {
        uint256 id = _advancePaid();
        vm.startPrank(stranger);
        vm.expectRevert(TroveBond.NotEscrow.selector);
        troveBond.claim(id, 1, stranger);
        vm.expectRevert(TroveBond.NotEscrow.selector);
        troveBond.release(id);
        vm.stopPrank();
        vm.prank(address(troveBond.vaultOf(id)));
        vm.expectRevert(TroveBond.NotEscrow.selector);
        troveBond.release(id);
    }

    function test_releaseWithoutALiveBondIsANoOpAndClaimReverts() public {
        vm.startPrank(address(escrow));
        troveBond.release(99);
        vm.expectRevert(abi.encodeWithSelector(TroveBond.NoActiveBond.selector, 99));
        troveBond.claim(99, 1, buyer);
        vm.stopPrank();
    }

    function test_claimIsCappedAtTheCoveredAmount() public {
        uint256 id = _advancePaid();
        vm.expectEmit(true, true, false, true, address(troveBond));
        emit IAdvanceBond.BondClaimed(id, buyer, 5_000e18, T_COVERED);
        vm.prank(address(escrow));
        uint256 paid = troveBond.claim(id, 5_000e18, buyer);
        assertEq(paid, T_COVERED);
    }

    function test_noOwnerCanReachAVault() public {
        (bool ok,) = address(troveBond).call(abi.encodeWithSignature("owner()"));
        assertFalse(ok, "TroveBond has no owner");
        TroveVault v = troveBond.vaultOf(_advancePaid());
        vm.startPrank(owner);
        vm.expectRevert(TroveVault.NotBond.selector);
        v.sweep(owner);
        vm.expectRevert(TroveVault.NotBond.selector);
        v.pay(owner, 1);
        vm.stopPrank();
    }

    // ── fuzz ──

    /// Whatever BTC does, a live bond pays min(amount, covered) in MUSD.
    function testFuzz_claimPaysMinOfAmountAndCoveredAtAnyPrice(uint256 amount, uint256 price, bool liquidate) public {
        uint256 id = _advancePaid();
        price = bound(price, 1_000e18, 500_000e18);
        sys.setPrice(price);
        if (liquidate && (0.06 ether * price) / sys.getTroveDebt(_vault(id)) < 1.1e18) sys.liquidate(_vault(id));
        amount = bound(amount, 0, 10_000e18);
        uint256 before = musd.balanceOf(stranger);
        vm.prank(address(escrow));
        uint256 paid = troveBond.claim(id, amount, stranger);
        uint256 expected = amount < T_COVERED ? amount : T_COVERED;
        assertEq(paid, expected);
        assertEq(musd.balanceOf(stranger), before + expected);
    }

    /// Any deal size borrows enough to meet the deal's ratio, never less than the floor.
    function testFuzz_postBorrowsMaxOfRatioAndFloor(uint128 advance, uint16 ratio) public {
        DealTerms memory t = _tradeTerms();
        t.advanceAmount = uint128(bound(advance, 100e18, 50_000e18));
        t.bondRatioBps = uint16(bound(ratio, 12_000, 50_000));
        uint256 id = _accepted(t);
        (, uint256 covered,,) = escrow.bondTerms(id);
        _post(id, 100 ether);
        uint256 needed = (covered * t.bondRatioBps + 9_999) / 10_000;
        uint256 expected = needed > 1_800e18 ? needed : 1_800e18;
        assertEq(musd.balanceOf(_vault(id)), expected);
        assertGe(troveBond.coverageBps(id), t.bondRatioBps);
    }

    /// Defensive: if a vault ever held less than owed, the claim says so instead of reverting.
    function test_claimReportsAShortfallInsteadOfReverting() public {
        uint256 id = _advancePaid();
        musd.burn(_vault(id), 1_000e18); // 800 left, below the 895.5 covered
        vm.expectEmit(true, false, false, true, address(troveBond));
        emit IAdvanceBond.BondShortfall(id, T_COVERED, 800e18);
        vm.prank(address(escrow));
        assertEq(troveBond.claim(id, T_COVERED, buyer), 800e18);
    }

    function test_vaultSweepFailsLoudlyWhenBtcCannotBeDelivered() public {
        TroveVault v = new TroveVault(sys, musd); // this test is its bond
        vm.deal(address(v), 1 ether);
        address sink = address(new NoReceive());
        vm.expectRevert(TroveVault.TransferFailed.selector);
        v.sweep(sink);
    }
}

contract NoReceive {}
