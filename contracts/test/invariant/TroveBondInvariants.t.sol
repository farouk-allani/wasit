// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {TroveBond} from "../../src/TroveBond.sol";
import {IWasitEscrow} from "../../src/interfaces/IWasitEscrow.sol";
import {Bond, BondStatus} from "../../src/libraries/WasitTypes.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockMusdSystem} from "../mocks/MockMusdSystem.sol";
import {MockOracle} from "../mocks/MockOracle.sol";
import {TroveBondHandler} from "./TroveBondHandler.sol";

/// @notice Trove-mode invariants (PLAN 8.3c) under crashes, liquidations, redemptions, interest
///         and recovery mode.
contract TroveBondInvariantsTest is Test {
    MockERC20 internal musd;
    MockMusdSystem internal sys;
    MockOracle internal oracle;
    TroveBondHandler internal handler;
    TroveBond internal bond;

    function setUp() public {
        musd = new MockERC20("Mezo USD", "MUSD", 18);
        sys = new MockMusdSystem(musd);
        oracle = new MockOracle(67_000e18);
        handler = new TroveBondHandler(sys, musd, oracle);
        bond = new TroveBond(IWasitEscrow(address(handler)), sys, oracle);
        handler.setBond(bond);
        targetContract(address(handler));
        bytes4[] memory actions = new bytes4[](13);
        actions[0] = TroveBondHandler.post.selector;
        actions[1] = TroveBondHandler.topUp.selector;
        actions[2] = TroveBondHandler.movePrice.selector;
        actions[3] = TroveBondHandler.liquidate.selector;
        actions[4] = TroveBondHandler.redeem.selector;
        actions[5] = TroveBondHandler.accrue.selector;
        actions[6] = TroveBondHandler.setRecovery.selector;
        actions[7] = TroveBondHandler.fundAdvance.selector;
        actions[8] = TroveBondHandler.claim.selector;
        actions[9] = TroveBondHandler.release.selector;
        actions[10] = TroveBondHandler.withdraw.selector;
        actions[11] = TroveBondHandler.close.selector;
        actions[12] = TroveBondHandler.post.selector; // weight opening bonds twice
        targetSelector(FuzzSelector({addr: address(handler), selectors: actions}));
    }

    /// The buyer's cover: every live bond's vault holds at least the covered amount in MUSD, so
    /// the MUSD in vaults is at least the sum of live covered amounts, whatever BTC did.
    function invariant_liveCoverIsHeldInMusd() public view {
        uint256 held;
        uint256 covered;
        for (uint256 id = 1; id <= handler.dealCount(); ++id) {
            Bond memory b = bond.bondOf(id);
            if (b.status != BondStatus.Active) continue;
            uint256 inVault = musd.balanceOf(address(bond.vaultOf(id)));
            assertGe(inVault, b.covered, "a live vault holds its cover");
            held += inVault;
            covered += b.covered;
        }
        assertGe(held, covered);
    }

    /// A claim pays exactly min(amount, covered): never more, and never less while live.
    function invariant_claimsPayExactly() public view {
        assertFalse(handler.overpaid(), "overpaid");
        assertFalse(handler.shortPaid(), "short paid");
    }

    /// The bond contract itself never holds assets; a closed vault holds nothing.
    function invariant_noAssetsOutsideVaultsAndClosedVaultsEmpty() public view {
        assertEq(musd.balanceOf(address(bond)), 0);
        assertEq(address(bond).balance, 0);
        for (uint256 id = 1; id <= handler.dealCount(); ++id) {
            if (!bond.closed(id)) continue;
            address v = address(bond.vaultOf(id));
            assertEq(musd.balanceOf(v), 0);
            assertEq(v.balance, 0);
        }
    }
}
