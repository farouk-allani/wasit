// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IAdvanceBond} from "../../src/interfaces/IAdvanceBond.sol";
import {DemoOracle} from "../../src/oracles/DemoOracle.sol";
import {BondStatus} from "../../src/libraries/WasitTypes.sol";
import {BondBase} from "../utils/BondBase.t.sol";

contract DemoOracleTest is BondBase {
    DemoOracle internal demo;

    function setUp() public override {
        super.setUp();
        demo = new DemoOracle(owner, BTC_PRICE);
    }

    function test_reportsSimulatedPrice() public {
        (uint256 price, uint256 updatedAt) = demo.btcUsd();
        assertEq(price, BTC_PRICE);
        assertEq(updatedAt, block.timestamp);
        assertTrue(demo.isSimulated(), "the UI keys its banner on this");

        vm.warp(block.timestamp + 1 hours);
        vm.expectEmit(address(demo));
        emit DemoOracle.PriceSet(60_000e18, block.timestamp);
        vm.prank(owner);
        demo.setPrice(60_000e18);
        (price, updatedAt) = demo.btcUsd();
        assertEq(price, 60_000e18);
        assertEq(updatedAt, block.timestamp);
    }

    function test_onlyOwnerSetsPrice() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        demo.setPrice(1);
    }

    function test_rejectsZeroPrice() public {
        vm.prank(owner);
        vm.expectRevert(DemoOracle.InvalidPrice.selector);
        demo.setPrice(0);
        vm.expectRevert(DemoOracle.InvalidPrice.selector);
        new DemoOracle(owner, 0);
    }

    /// The demo's protection scene: a bond priced by the demo oracle drops 150% → 120% → 110% and is
    /// protected. The swap still runs at the mock pool's own rate.
    function test_demoScene_protectionWithSimulatedDrop() public {
        vm.prank(owner);
        advanceBond.setOracle(demo);
        uint256 id = _advancePaid();
        assertTrue(advanceBond.bondOf(id).oracle.isSimulated(), "bond carries the simulated feed");

        vm.startPrank(owner);
        demo.setPrice(60_000e18);
        assertEq(advanceBond.coverageBps(id), 12_060); // top-up warning
        demo.setPrice(54_700e18);
        vm.stopPrank();
        swap.setPrice(54_700e18);
        vm.expectEmit(true, false, false, false, address(advanceBond));
        emit IAdvanceBond.BondProtected(id, 0, 0, 0);
        vm.prank(keeper);
        advanceBond.protect(id);
        assertEq(uint8(advanceBond.bondOf(id).status), uint8(BondStatus.Protected));
    }
}
