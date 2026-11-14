// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IMusdPriceFeed} from "../../src/oracles/MusdPriceFeedAdapter.sol";
import {MockSkipAggregator} from "./MockSkipAggregator.sol";

/// @notice Mimics MUSD's PriceFeed as verified on testnet: 18-decimal aggregator, 60 s bound,
///         string revert when stale.
contract MockMusdPriceFeed is IMusdPriceFeed {
    uint256 public constant MAX_PRICE_DELAY = 60;
    MockSkipAggregator public immutable agg;
    bool public broken;

    constructor(MockSkipAggregator agg_) {
        agg = agg_;
    }

    function setBroken(bool b) external {
        broken = b;
    }

    function fetchPrice() external view returns (uint256) {
        (, int256 answer,, uint256 updatedAt,) = agg.latestRoundData();
        require(block.timestamp - updatedAt <= MAX_PRICE_DELAY, "PriceFeed: Oracle is stale.");
        return uint256(answer);
    }

    function oracle() external view returns (address) {
        require(!broken, "broken");
        return address(agg);
    }
}
