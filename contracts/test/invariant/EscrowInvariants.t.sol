// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console} from "forge-std/console.sol";
import {BondSettlement, BondStatus, Deal, DealState} from "../../src/libraries/WasitTypes.sol";
import {EscrowBase} from "../utils/EscrowBase.t.sol";
import {EscrowHandler} from "./EscrowHandler.sol";

/// @notice ARCHITECTURE §5 invariants #1–#4 for the escrow, under random call sequences.
contract EscrowInvariantsTest is EscrowBase {
    EscrowHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new EscrowHandler(
            escrow,
            musd,
            bond,
            EscrowHandler.Actors({
                owner: owner,
                buyer: buyer,
                supplier: supplier,
                agent: agent,
                inspector: inspector,
                inspectorKey: inspectorKey,
                carrier: carrier,
                carrierKey: carrierKey,
                arbiter: arbiter
            })
        );
        targetContract(address(handler));

        // `progress` walks deals down every path; the single steps below interleave the actions most
        // likely to collide with it (exits, retries, fee withdrawal, time, config, failures, donations).
        bytes4[] memory selectors = new bytes4[](13);
        selectors[0] = EscrowHandler.createDeal.selector;
        selectors[1] = EscrowHandler.progress.selector;
        selectors[2] = EscrowHandler.cancel.selector;
        selectors[3] = EscrowHandler.dispute.selector;
        selectors[4] = EscrowHandler.release.selector;
        selectors[5] = EscrowHandler.claimSupplierDefault.selector;
        selectors[6] = EscrowHandler.claimBuyerDefault.selector;
        selectors[7] = EscrowHandler.retryBondSettlement.selector;
        selectors[8] = EscrowHandler.withdrawFees.selector;
        selectors[9] = EscrowHandler.warp.selector;
        selectors[10] = EscrowHandler.setBondFailures.selector;
        selectors[11] = EscrowHandler.donate.selector;
        selectors[12] = EscrowHandler.ownerConfig.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// #1 Every token the escrow holds is accounted for: held balances and advance fees of open
    ///    deals, earned fees, and tokens sent directly to the contract.
    function invariant_escrowBalanceIsFullyAccounted() public view {
        uint256 held;
        for (uint256 i; i < handler.dealCount(); ++i) {
            Deal memory d = escrow.getDeal(handler.dealIds(i));
            held += uint256(d.balanceHeld) + d.advanceFeeHeld;
        }
        assertEq(musd.balanceOf(address(escrow)), held + escrow.accruedFees(address(musd)) + handler.donations());
    }

    /// #2 Terminal deals hold nothing, and their bond is closed unless a settlement is pending.
    function invariant_terminalDealsHoldNothing() public view {
        for (uint256 i; i < handler.dealCount(); ++i) {
            uint256 id = handler.dealIds(i);
            Deal memory d = escrow.getDeal(id);
            if (uint8(d.state) < uint8(DealState.Released)) continue;
            assertEq(d.balanceHeld, 0);
            assertEq(d.advanceFeeHeld, 0);
            if (d.terms.bonder != address(0) && d.bondPending == BondSettlement.None) {
                BondStatus s = bond.bondOf(id).status;
                assertTrue(s != BondStatus.Active && s != BondStatus.Protected, "bond left open");
            }
        }
    }

    /// #3 A deal never moves backwards; terminal states have no outgoing transitions.
    function invariant_statesNeverGoBackwards() public view {
        assertFalse(handler.wentBackwards());
    }

    /// #4 Nothing, including owner config, changes the terms of an existing deal.
    function invariant_termsNeverChange() public view {
        for (uint256 i; i < handler.dealCount(); ++i) {
            uint256 id = handler.dealIds(i);
            assertEq(keccak256(abi.encode(escrow.getDeal(id).terms)), handler.termsHashOf(id));
        }
    }

    /// Logs how deals ended across the run (visible with -vv); no assertion.
    function afterInvariant() external view {
        console.log("released", handler.outcomes(DealState.Released));
        console.log("resolved", handler.outcomes(DealState.Resolved));
        console.log("supplier defaulted", handler.outcomes(DealState.SupplierDefaulted));
        console.log("buyer defaulted", handler.outcomes(DealState.BuyerDefaulted));
        console.log("cancelled", handler.outcomes(DealState.Cancelled));
    }

    /// Open deals hold exactly what their state implies.
    function invariant_openDealsHoldWhatTheirStateImplies() public view {
        for (uint256 i; i < handler.dealCount(); ++i) {
            Deal memory d = escrow.getDeal(handler.dealIds(i));
            bool balanceExpected =
                d.state == DealState.BalanceFunded || d.state == DealState.Shipped || d.state == DealState.Disputed;
            assertEq(d.balanceHeld, balanceExpected ? d.terms.balanceAmount : 0);
            bool advanceExpected =
                uint8(d.state) >= uint8(DealState.AdvancePaid) && uint8(d.state) <= uint8(DealState.Disputed);
            uint256 fee = uint256(d.terms.advanceAmount) * d.terms.feeBps / 10_000;
            assertEq(d.advanceFeeHeld, advanceExpected ? fee : 0);
        }
    }
}
