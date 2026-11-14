// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IMusdPriceFeed, MusdPriceFeedAdapter} from "../../src/oracles/MusdPriceFeedAdapter.sol";
import {MockMusdPriceFeed} from "../mocks/MockMusdPriceFeed.sol";
import {MockSkipAggregator} from "../mocks/MockSkipAggregator.sol";

contract MusdPriceFeedAdapterTest is Test {
    MockSkipAggregator internal agg;
    MockMusdPriceFeed internal feed;
    MusdPriceFeedAdapter internal adapter;

    function setUp() public {
        vm.warp(1_794_580_463);
        agg = new MockSkipAggregator();
        feed = new MockMusdPriceFeed(agg);
        adapter = new MusdPriceFeedAdapter(feed, 1_000e18, 10_000_000e18);
        agg.set(69_171.58045e18, block.timestamp); // sample read on testnet, 2026-11-13
    }

    function test_returnsThePriceFeedPriceAndItsUpdate() public view {
        (uint256 price, uint256 updatedAt) = adapter.btcUsd();
        assertEq(price, 69_171.58045e18);
        assertEq(price, feed.fetchPrice());
        assertEq(updatedAt, block.timestamp);
        assertFalse(adapter.isSimulated());
    }

    function test_acceptsAnUpdateAtTheProtocolBound() public {
        vm.warp(block.timestamp + 60);
        (, uint256 updatedAt) = adapter.btcUsd();
        assertEq(updatedAt, block.timestamp - 60);
    }

    /// The protocol's own 60 s revert surfaces as a named, honest "price unavailable".
    function test_staleFeedIsPriceUnavailable() public {
        vm.warp(block.timestamp + 61);
        vm.expectRevert(MusdPriceFeedAdapter.PriceUnavailable.selector);
        adapter.btcUsd();
    }

    function test_brokenAggregatorLookupIsPriceUnavailable() public {
        feed.setBroken(true);
        vm.expectRevert(MusdPriceFeedAdapter.PriceUnavailable.selector);
        adapter.btcUsd();
    }

    function test_aggregatorThatRevertsIsPriceUnavailable() public {
        vm.mockCallRevert(address(agg), abi.encodeWithSignature("latestRoundData()"), "down");
        // fetchPrice also reads the aggregator, so it is the first to fail
        vm.expectRevert(MusdPriceFeedAdapter.PriceUnavailable.selector);
        adapter.btcUsd();
    }

    function test_aggregatorFailingAfterFetchIsPriceUnavailable() public {
        vm.mockCall(address(feed), abi.encodeWithSignature("fetchPrice()"), abi.encode(70_000e18));
        vm.mockCallRevert(address(agg), abi.encodeWithSignature("latestRoundData()"), "down");
        vm.expectRevert(MusdPriceFeedAdapter.PriceUnavailable.selector);
        adapter.btcUsd();
    }

    function test_revertsOutsideBounds() public {
        agg.set(999e18, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(MusdPriceFeedAdapter.PriceOutOfBounds.selector, 999e18));
        adapter.btcUsd();
        agg.set(10_000_001e18, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(MusdPriceFeedAdapter.PriceOutOfBounds.selector, 10_000_001e18));
        adapter.btcUsd();
    }

    function test_constructorRejectsBadConfig() public {
        vm.expectRevert(MusdPriceFeedAdapter.InvalidConfig.selector);
        new MusdPriceFeedAdapter(IMusdPriceFeed(address(0xBEEF)), 1, 2); // no code
        vm.expectRevert(MusdPriceFeedAdapter.InvalidConfig.selector);
        new MusdPriceFeedAdapter(feed, 0, 2);
        vm.expectRevert(MusdPriceFeedAdapter.InvalidConfig.selector);
        new MusdPriceFeedAdapter(feed, 2, 2);
    }

    function testFuzz_passesAnyInBoundsPriceThrough(uint256 price, uint256 age) public {
        price = bound(price, 1_000e18, 10_000_000e18);
        age = bound(age, 0, 60);
        agg.set(int256(price), block.timestamp);
        vm.warp(block.timestamp + age);
        (uint256 got, uint256 updatedAt) = adapter.btcUsd();
        assertEq(got, price);
        assertEq(updatedAt, block.timestamp - age);
    }
}
