// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console} from "forge-std/console.sol";
import {Bond, BondSettlement, BondStatus, Deal, DealState} from "../../src/libraries/WasitTypes.sol";
import {BondBase} from "../utils/BondBase.t.sol";
import {BondHandler} from "./BondHandler.sol";

/// @notice ARCHITECTURE §5 invariants #5 and #6 for the real bond (with the real escrow), plus
///         escrow accounting under bond activity.
contract BondInvariantsTest is BondBase {
    BondHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new BondHandler(
            BondHandler.System(escrow, advanceBond, btc, musd, oracle, swap),
            BondHandler.Actors(buyer, supplier, agent, arbiter, inspectorKey, carrierKey)
        );
        vm.prank(agent);
        btc.approve(address(advanceBond), type(uint256).max);
        targetContract(address(handler));
    }

    /// #5 Every BTC and MUSD in the bond belongs to a live bond or was sent directly to it.
    function invariant_bondBalancesFullyAccounted() public view {
        uint256 btcHeld;
        uint256 musdHeld;
        for (uint256 i; i < handler.dealCount(); ++i) {
            Bond memory b = advanceBond.bondOf(handler.dealIds(i));
            btcHeld += b.btcHeld;
            musdHeld += b.musdHeld;
        }
        assertEq(btc.balanceOf(address(advanceBond)), btcHeld + handler.donatedBtc());
        assertEq(musd.balanceOf(address(advanceBond)), musdHeld + handler.donatedMusd());
    }

    /// #6 A claim never pays more than requested or than the bond covers (the net advance).
    function invariant_claimsNeverOverpay() public view {
        assertFalse(handler.overpaid());
    }

    /// Closed bonds hold nothing; a bond's covered amount is always the deal's net advance.
    function invariant_closedBondsAreEmpty() public view {
        for (uint256 i; i < handler.dealCount(); ++i) {
            uint256 id = handler.dealIds(i);
            Bond memory b = advanceBond.bondOf(id);
            if (b.status == BondStatus.Claimed || b.status == BondStatus.Released) {
                assertEq(b.btcHeld, 0);
                assertEq(b.musdHeld, 0);
            }
            if (b.status != BondStatus.None) {
                (, uint256 covered,,) = escrow.bondTerms(id);
                assertEq(b.covered, covered);
            }
        }
    }

    /// Terminal deals leave no live bond unless a settlement is pending (#2 with the real bond).
    function invariant_terminalDealsCloseTheirBond() public view {
        for (uint256 i; i < handler.dealCount(); ++i) {
            uint256 id = handler.dealIds(i);
            Deal memory d = escrow.getDeal(id);
            if (uint8(d.state) < uint8(DealState.Released) || d.bondPending != BondSettlement.None) continue;
            BondStatus st = advanceBond.bondOf(id).status;
            assertTrue(st != BondStatus.Active && st != BondStatus.Protected, "bond left open");
        }
    }

    /// Logs how far the run got (visible with -vv); no assertion.
    function afterInvariant() external view {
        console.log("deals", handler.dealCount());
        console.log("bond claims", handler.claims());
        console.log("protections", handler.protections());
    }

    /// #1 The escrow still holds exactly the open deals' money plus earned fees.
    function invariant_escrowAccounted() public view {
        uint256 held;
        for (uint256 i; i < handler.dealCount(); ++i) {
            Deal memory d = escrow.getDeal(handler.dealIds(i));
            held += uint256(d.balanceHeld) + d.advanceFeeHeld;
        }
        assertEq(musd.balanceOf(address(escrow)), held + escrow.accruedFees(address(musd)));
    }
}
