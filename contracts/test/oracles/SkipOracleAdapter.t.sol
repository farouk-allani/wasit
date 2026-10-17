// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {OracleMath} from "../../src/libraries/OracleMath.sol";
import {ISkipAggregator, SkipOracleAdapter} from "../../src/oracles/SkipOracleAdapter.sol";
import {MockSkipAggregator} from "../mocks/MockSkipAggregator.sol";

contract SkipOracleAdapterTest is Test {
    MockSkipAggregator internal feed;
    SkipOracleAdapter internal adapter;

    function setUp() public {
        vm.warp(1_792_182_169);
        feed = new MockSkipAggregator();
        adapter = new SkipOracleAdapter(feed, 18, 15 minutes, 1_000e18, 10_000_000e18);
        feed.set(81_542.49658e18, block.timestamp); // sample read on testnet, 2026-10-16
    }

    function test_returnsPriceAndUpdatedAt() public view {
        (uint256 price, uint256 updatedAt) = adapter.btcUsd();
        assertEq(price, 81_542.49658e18);
        assertEq(updatedAt, block.timestamp);
        assertFalse(adapter.isSimulated());
    }

    function test_normalizesEightDecimals() public {
        SkipOracleAdapter eight = new SkipOracleAdapter(feed, 8, 15 minutes, 1_000e18, 10_000_000e18);
        feed.set(65_238_03881085, block.timestamp);
        (uint256 price,) = eight.btcUsd();
        assertEq(price, 65_238.03881085e18);
    }

    function test_acceptsUpdateAtMaxAge() public {
        vm.warp(block.timestamp + 15 minutes);
        adapter.btcUsd();
    }

    function test_revertsWhenStale() public {
        uint256 updatedAt = block.timestamp;
        vm.warp(block.timestamp + 15 minutes + 1);
        vm.expectRevert(abi.encodeWithSelector(SkipOracleAdapter.StalePrice.selector, updatedAt));
        adapter.btcUsd();
    }

    function test_toleratesUpdateAheadOfBlockTime() public {
        feed.set(80_000e18, block.timestamp + 3);
        (uint256 price,) = adapter.btcUsd();
        assertEq(price, 80_000e18);
    }

    function test_revertsOnNonPositiveAnswer() public {
        feed.set(0, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(SkipOracleAdapter.InvalidAnswer.selector, int256(0)));
        adapter.btcUsd();
        feed.set(-1, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(SkipOracleAdapter.InvalidAnswer.selector, int256(-1)));
        adapter.btcUsd();
    }

    function test_revertsOutOfBounds() public {
        feed.set(999e18, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(SkipOracleAdapter.PriceOutOfBounds.selector, 999e18));
        adapter.btcUsd();
        feed.set(10_000_001e18, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(SkipOracleAdapter.PriceOutOfBounds.selector, 10_000_001e18));
        adapter.btcUsd();
    }

    function test_constructorValidation() public {
        vm.expectRevert(SkipOracleAdapter.InvalidConfig.selector);
        new SkipOracleAdapter(ISkipAggregator(address(0)), 18, 15 minutes, 1, 2);
        vm.expectRevert(SkipOracleAdapter.InvalidConfig.selector);
        new SkipOracleAdapter(feed, 37, 15 minutes, 1, 2);
        vm.expectRevert(SkipOracleAdapter.InvalidConfig.selector);
        new SkipOracleAdapter(feed, 18, 0, 1, 2);
        vm.expectRevert(SkipOracleAdapter.InvalidConfig.selector);
        new SkipOracleAdapter(feed, 18, 15 minutes, 0, 2);
        vm.expectRevert(SkipOracleAdapter.InvalidConfig.selector);
        new SkipOracleAdapter(feed, 18, 15 minutes, 2, 2);
    }

    function test_oracleMath_rejectsExtremeExponents() public {
        vm.expectRevert(abi.encodeWithSelector(OracleMath.UnsupportedExponent.selector, int256(-37)));
        this.scale(1, -37);
        vm.expectRevert(abi.encodeWithSelector(OracleMath.UnsupportedExponent.selector, int256(19)));
        this.scale(1, 19);
        assertEq(this.scale(5, 2), 500e18);
        assertEq(this.scale(123_456, -20), 1234);
    }

    function scale(uint256 value, int256 exponent) external pure returns (uint256) {
        return OracleMath.to1e18(value, exponent);
    }

    function testFuzz_normalizationMatchesDecimals(uint64 rawPrice, uint8 decimals) public {
        decimals = uint8(bound(decimals, 0, 18));
        SkipOracleAdapter a = new SkipOracleAdapter(feed, decimals, 15 minutes, 1, type(uint256).max);
        vm.assume(rawPrice > 0);
        feed.set(int256(uint256(rawPrice)), block.timestamp);
        (uint256 price,) = a.btcUsd();
        assertEq(price, uint256(rawPrice) * 10 ** (18 - decimals));
    }
}
