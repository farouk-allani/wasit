// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISkipAggregator} from "../../src/oracles/SkipOracleAdapter.sol";

/// @notice Mimics Mezo's Skip feed as observed on testnet: answeredInRound is always 0.
contract MockSkipAggregator is ISkipAggregator {
    int256 public answer;
    uint256 public updatedAt;

    function set(int256 answer_, uint256 updatedAt_) external {
        answer = answer_;
        updatedAt = updatedAt_;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (15_100_875, answer, updatedAt, updatedAt, 0);
    }
}
