// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IMusdPriceFeed, MusdPriceFeedAdapter} from "../../src/oracles/MusdPriceFeedAdapter.sol";
import {ISkipAggregator} from "../../src/oracles/SkipOracleAdapter.sol";

/// @notice Runs against a Mezo testnet fork: `FOUNDRY_PROFILE=fork MEZO_TESTNET_RPC=... forge test`.
///         The Skip aggregator under the PriceFeed is a Go precompile that a local fork cannot run
///         (ADR-015), so the live price is proven by `eth_call` on the deployed adapter (EVIDENCE.md);
///         here the real PriceFeed proxy runs with the precompile's answer mocked.
contract MusdPriceFeedForkTest is Test {
    // VERIFIED-FACTS
    IMusdPriceFeed internal constant PRICE_FEED = IMusdPriceFeed(0x86bCF0841622a5dAC14A313a15f96A95421b9366);
    address internal constant SKIP_BTC_USD = 0x7b7c000000000000000000000000000000000015;

    MusdPriceFeedAdapter internal adapter;

    function setUp() public {
        vm.createSelectFork("mezo_testnet");
        assertEq(block.chainid, 31_611);
        adapter = new MusdPriceFeedAdapter(PRICE_FEED, 1_000e18, 10_000_000e18);
    }

    function _mockSkip(int256 answer, uint256 updatedAt) internal {
        vm.mockCall(
            SKIP_BTC_USD,
            abi.encodeWithSelector(ISkipAggregator.latestRoundData.selector),
            abi.encode(uint80(1), answer, updatedAt, updatedAt, uint80(0))
        );
        // The PriceFeed also reads decimals() (18 on testnet, VERIFIED-FACTS)
        vm.mockCall(SKIP_BTC_USD, abi.encodeWithSignature("decimals()"), abi.encode(uint8(18)));
    }

    function test_wrapsTheLiveSkipFeed() public view {
        assertEq(PRICE_FEED.oracle(), SKIP_BTC_USD);
    }

    /// The real PriceFeed code prices through the adapter unchanged.
    function test_freshAnswerPassesThrough() public {
        _mockSkip(69_171.58045e18, block.timestamp - 5);
        (uint256 price, uint256 updatedAt) = adapter.btcUsd();
        assertEq(price, 69_171.58045e18);
        assertEq(updatedAt, block.timestamp - 5);
    }

    /// The real PriceFeed's 60 s revert becomes PriceUnavailable.
    function test_staleAnswerIsPriceUnavailable() public {
        _mockSkip(69_171.58045e18, block.timestamp - 61);
        vm.expectRevert(MusdPriceFeedAdapter.PriceUnavailable.selector);
        adapter.btcUsd();
    }

    /// Without the precompile (unmocked on a fork) the adapter says unavailable, never a stale price.
    function test_unreachableFeedIsPriceUnavailable() public {
        vm.expectRevert(MusdPriceFeedAdapter.PriceUnavailable.selector);
        adapter.btcUsd();
    }
}
