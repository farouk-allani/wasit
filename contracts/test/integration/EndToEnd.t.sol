// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AttestationKind, Bond, BondStatus, DealState} from "../../src/libraries/WasitTypes.sol";
import {BondBase} from "../utils/BondBase.t.sol";

/// @notice The demo scenarios as tests, with real escrow and bond (mock BTC, oracle and pool).
contract EndToEndTest is BondBase {
    uint256 internal constant ADVANCE_FEE = 15e18;

    struct Balances {
        uint256 buyerMusd;
        uint256 supplierMusd;
        uint256 agentMusd;
        uint256 agentBtc;
    }

    function _snapshot() internal view returns (Balances memory) {
        return Balances(musd.balanceOf(buyer), musd.balanceOf(supplier), musd.balanceOf(agent), btc.balanceOf(agent));
    }

    function _setPrice(uint256 price) internal {
        oracle.setPrice(price);
        swap.setPrice(price);
    }

    /// Supplier takes the advance, BTC falls, a keeper protects the bond, the supplier misses the
    /// production deadline, and the buyer gets the whole advance back in MUSD.
    function test_supplierDefaultAfterBtcDropAndProtection() public {
        Balances memory start = _snapshot();
        swap.setSlippage(100); // pool trades 1% under the oracle

        // Terms, acceptance, bond (0.06 BTC at 80,000 = 160.8% of the 2,985 net advance), advance.
        uint256 id = _accepted(_terms());
        _post(id, 0.06e18);
        vm.prank(buyer);
        escrow.fundAdvance(id);
        assertEq(musd.balanceOf(supplier), start.supplierMusd + NET_ADVANCE, "production money arrives at once");

        // BTC −25%: 120.6%, inside the top-up warning band (< 130%) but not protectable yet.
        _setPrice(60_000e18);
        assertEq(advanceBond.coverageBps(id), 12_060);
        assertLt(advanceBond.coverageBps(id), TOP_UP_BPS);

        // BTC −32%: 109.9% < 115%, a keeper converts enough BTC to cover the advance in MUSD.
        _setPrice(54_700e18);
        vm.prank(keeper);
        advanceBond.protect(id);
        Bond memory protectedBond = advanceBond.bondOf(id);
        assertGe(protectedBond.musdHeld, NET_ADVANCE);

        // BTC keeps falling; the claim no longer depends on it.
        _setPrice(30_000e18);

        // The supplier misses the production deadline; anyone settles.
        (uint256 readyBy,,,,) = escrow.deadlines(id);
        vm.warp(readyBy + 1);
        vm.prank(keeper);
        escrow.claimSupplierDefault(id);

        Balances memory end = _snapshot();
        assertEq(end.buyerMusd, start.buyerMusd, "buyer made whole: 15 fee refund + 2,985 from the bond");
        assertEq(end.supplierMusd, start.supplierMusd + NET_ADVANCE, "supplier kept the advance it received");
        assertEq(end.agentMusd, start.agentMusd + protectedBond.musdHeld - NET_ADVANCE, "MUSD surplus to agent");
        assertEq(end.agentBtc, start.agentBtc - 0.06e18 + protectedBond.btcHeld, "unsold BTC back to agent");
        assertEq(uint8(escrow.getDeal(id).state), uint8(DealState.SupplierDefaulted));
        assertEq(uint8(advanceBond.bondOf(id).status), uint8(BondStatus.Claimed));
        assertEq(musd.balanceOf(address(escrow)), 0);
        assertEq(musd.balanceOf(address(advanceBond)), 0);
        assertEq(btc.balanceOf(address(advanceBond)), 0);
        assertEq(escrow.accruedFees(address(musd)), 0, "no fee on a failed deal");
    }

    /// Everything goes to plan: the agent's BTC comes back untouched.
    function test_happyPath() public {
        Balances memory start = _snapshot();
        uint256 id = _accepted(_terms());
        _post(id, 0.06e18);
        vm.prank(buyer);
        escrow.fundAdvance(id);
        _attest(id, AttestationKind.ReadyInspected, inspectorKey);
        vm.prank(buyer);
        escrow.fundBalance(id);
        _attest(id, AttestationKind.Shipped, carrierKey);
        (,,, uint256 challengeEnds,) = escrow.deadlines(id);
        vm.warp(challengeEnds + 1);
        vm.prank(keeper);
        escrow.release(id);
        escrow.withdrawFees(address(musd));

        Balances memory end = _snapshot();
        assertEq(start.buyerMusd - end.buyerMusd, 10_000e18);
        assertEq(end.supplierMusd - start.supplierMusd, 9_950e18);
        assertEq(musd.balanceOf(feeRecipient), 50e18, "0.5% of value settled to the supplier");
        assertEq(end.agentBtc, start.agentBtc, "bond returned in full, nothing paid to the bonder");
        assertEq(end.agentMusd, start.agentMusd);
        assertEq(musd.balanceOf(address(escrow)), 0);
        assertEq(btc.balanceOf(address(advanceBond)), 0);
    }

    /// The arbiter never rules; the dispute lapses and the attested shipment stands (ADR-019).
    function test_disputeLapsesToSupplier() public {
        uint256 id = _accepted(_terms());
        _post(id, 0.06e18);
        vm.prank(buyer);
        escrow.fundAdvance(id);
        _attest(id, AttestationKind.ReadyInspected, inspectorKey);
        vm.prank(buyer);
        escrow.fundBalance(id);
        _attest(id, AttestationKind.Shipped, carrierKey);
        vm.prank(buyer);
        escrow.dispute(id, keccak256("late paperwork"));
        (,,,, uint256 ruleBy) = escrow.deadlines(id);
        vm.warp(ruleBy + 1);
        uint256 supplierBefore = musd.balanceOf(supplier);

        escrow.release(id);

        assertEq(musd.balanceOf(supplier), supplierBefore + 6_965e18);
        assertEq(uint8(advanceBond.bondOf(id).status), uint8(BondStatus.Released));
    }
}
