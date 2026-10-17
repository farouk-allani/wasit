// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAdvanceBond} from "../../src/interfaces/IAdvanceBond.sol";
import {IWasitEscrow} from "../../src/interfaces/IWasitEscrow.sol";
import {AttestationKind, Bond, BondSettlement, BondStatus, DealState} from "../../src/libraries/WasitTypes.sol";
import {MockOracle} from "../mocks/MockOracle.sol";
import {MockSwap} from "../mocks/MockSwap.sol";
import {BondBase} from "../utils/BondBase.t.sol";

/// @notice Bond claims through the real escrow: supplier default and arbiter refunds.
contract BondClaimTest is BondBase {
    uint256 internal constant ADVANCE_FEE = 15e18;
    uint256 internal id;
    uint256 internal buyerStart;

    function setUp() public override {
        super.setUp();
        buyerStart = musd.balanceOf(buyer);
        id = _advancePaid(); // 0.06 BTC at 80,000 behind a 2,985 net advance
        swap.setSlippage(100);
    }

    function _missReadyBy() internal {
        (uint256 readyBy,,,,) = escrow.deadlines(id);
        vm.warp(readyBy + 1);
    }

    function _setPrice(uint256 price) internal {
        oracle.setPrice(price);
        swap.setPrice(price);
    }

    function test_supplierDefault_bondSellsBtcAndMakesBuyerWhole() public {
        _missReadyBy();
        uint256 agentBtcBefore = btc.balanceOf(agent);
        uint256 agentMusdBefore = musd.balanceOf(agent);

        vm.expectEmit(address(advanceBond));
        emit IAdvanceBond.BondClaimed(id, buyer, NET_ADVANCE, NET_ADVANCE);
        vm.prank(keeper);
        escrow.claimSupplierDefault(id);

        assertEq(musd.balanceOf(buyer), buyerStart, "fee refund + bond claim = the whole advance");
        Bond memory b = advanceBond.bondOf(id);
        assertEq(uint8(b.status), uint8(BondStatus.Claimed));
        assertEq(b.btcHeld + b.musdHeld, 0);
        assertGt(btc.balanceOf(agent), agentBtcBefore, "unsold BTC back to the agent");
        assertGt(musd.balanceOf(agent), agentMusdBefore, "MUSD surplus back to the agent");
        assertEq(btc.balanceOf(address(advanceBond)), 0);
        assertEq(musd.balanceOf(address(advanceBond)), 0);
    }

    function test_supplierDefault_protectedBondPaysWithoutAPrice() public {
        _setPrice(54_700e18);
        advanceBond.protect(id);
        oracle.setStale(true); // MUSD already covers the claim, no sale needed
        _missReadyBy();

        escrow.claimSupplierDefault(id);

        assertEq(musd.balanceOf(buyer), buyerStart);
        assertEq(uint8(escrow.getDeal(id).bondPending), uint8(BondSettlement.None));
    }

    function test_supplierDefault_crashShortfallIsReported() public {
        _setPrice(30_000e18); // 0.06 BTC is worth 1,800 < 2,985
        _missReadyBy();

        vm.expectEmit(address(advanceBond));
        emit IAdvanceBond.BondShortfall(id, NET_ADVANCE, 1_782e18);
        escrow.claimSupplierDefault(id);

        assertEq(musd.balanceOf(buyer), buyerStart - ADVANCE + ADVANCE_FEE + 1_782e18);
    }

    /// Review P-1: after a crash protection sold every BTC, a stale oracle must not block paying out
    /// the MUSD the bond already holds.
    function test_P1_emptyBtcClaimNeedsNoPrice() public {
        _setPrice(30_000e18);
        advanceBond.protect(id); // sells all 0.06 BTC for 1,782 MUSD
        assertEq(advanceBond.bondOf(id).btcHeld, 0);
        oracle.setStale(true);
        _missReadyBy();

        vm.expectEmit(address(advanceBond));
        emit IAdvanceBond.BondShortfall(id, NET_ADVANCE, 1_782e18);
        escrow.claimSupplierDefault(id);

        assertEq(uint8(escrow.getDeal(id).bondPending), uint8(BondSettlement.None), "paid at once");
        assertEq(musd.balanceOf(buyer), buyerStart - ADVANCE + ADVANCE_FEE + 1_782e18);
    }

    function test_supplierDefault_staleOracleThenRetry() public {
        oracle.setStale(true);
        _missReadyBy();
        vm.expectEmit(address(escrow));
        emit IWasitEscrow.BondSettlementFailed(
            id, BondSettlement.Claim, abi.encodeWithSelector(MockOracle.StalePrice.selector)
        );
        escrow.claimSupplierDefault(id);

        assertEq(musd.balanceOf(buyer), buyerStart - ADVANCE + ADVANCE_FEE, "escrowed fee refunded at once");
        assertEq(uint8(escrow.getDeal(id).state), uint8(DealState.SupplierDefaulted));
        assertEq(uint8(advanceBond.bondOf(id).status), uint8(BondStatus.Active), "BTC never sold blind");

        oracle.setStale(false);
        vm.prank(keeper);
        escrow.retryBondSettlement(id);
        assertEq(musd.balanceOf(buyer), buyerStart);
    }

    function test_supplierDefault_poolBeyondToleranceThenRetry() public {
        swap.setSlippage(800); // pool 8% under the oracle, tolerance is 6%
        _missReadyBy();
        escrow.claimSupplierDefault(id);
        assertEq(uint8(escrow.getDeal(id).bondPending), uint8(BondSettlement.Claim));

        swap.setSlippage(300);
        escrow.retryBondSettlement(id);
        assertEq(musd.balanceOf(buyer), buyerStart);
    }

    function test_resolve_partialAdvanceRefundFromBond() public {
        _attest(id, AttestationKind.ReadyInspected, inspectorKey);
        vm.prank(buyer);
        escrow.fundBalance(id);
        _attest(id, AttestationKind.Shipped, carrierKey);
        vm.prank(buyer);
        escrow.dispute(id, keccak256("short shipment"));
        uint256 buyerBefore = musd.balanceOf(buyer);

        vm.expectEmit(address(advanceBond));
        emit IAdvanceBond.BondClaimed(id, buyer, 1_492.5e18, 1_492.5e18);
        vm.prank(arbiter);
        escrow.resolve(id, 10_000, 5_000);

        // balance fully to the supplier; buyer gets half the fee (7.5) + half the net advance (1,492.5)
        assertEq(musd.balanceOf(buyer), buyerBefore + 7.5e18 + 1_492.5e18);
        assertEq(uint8(advanceBond.bondOf(id).status), uint8(BondStatus.Claimed));
    }

    function test_claim_onlyEscrow() public {
        vm.prank(buyer);
        vm.expectRevert(IAdvanceBond.NotEscrow.selector);
        advanceBond.claim(id, 1, buyer);
    }

    function test_claim_revertsWithoutLiveBond() public {
        vm.prank(address(escrow));
        vm.expectRevert(abi.encodeWithSelector(IAdvanceBond.NoActiveBond.selector, 999));
        advanceBond.claim(999, 1, buyer);
    }

    function test_claim_cappedAtCovered() public {
        vm.prank(address(escrow));
        uint256 paid = advanceBond.claim(id, NET_ADVANCE * 10, buyer);
        assertEq(paid, NET_ADVANCE);
    }

    function testFuzz_claim_neverOverpaysAndReturnsTheRest(uint64 priceUsd, uint16 poolSlippage) public {
        uint256 price = bound(priceUsd, 1_000, 500_000) * 1e18;
        poolSlippage = uint16(bound(poolSlippage, 0, 600));
        _setPrice(price);
        swap.setSlippage(poolSlippage);
        uint256 agentBtc = btc.balanceOf(agent);
        uint256 agentMusd = musd.balanceOf(agent);
        uint256 buyerBefore = musd.balanceOf(buyer);

        vm.prank(address(escrow));
        uint256 paid = advanceBond.claim(id, NET_ADVANCE, buyer);

        assertLe(paid, NET_ADVANCE);
        assertEq(musd.balanceOf(buyer), buyerBefore + paid);
        assertEq(btc.balanceOf(address(advanceBond)), 0, "nothing stays in the bond");
        assertEq(musd.balanceOf(address(advanceBond)), 0);
        uint256 btcSold = 0.06e18 - (btc.balanceOf(agent) - agentBtc);
        uint256 musdFromSale = paid + (musd.balanceOf(agent) - agentMusd);
        assertGe(musdFromSale, btcSold * price / 1e18 * 9_400 / 10_000, "sale within tolerance");
        if (paid < NET_ADVANCE) assertEq(btc.balanceOf(agent), agentBtc, "shortfall only after selling all BTC");
    }
}
