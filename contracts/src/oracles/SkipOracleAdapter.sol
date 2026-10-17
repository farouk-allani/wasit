// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IPriceOracle} from "../interfaces/IPriceOracle.sol";
import {OracleMath} from "../libraries/OracleMath.sol";

/// @notice The subset of the Chainlink aggregator interface that Mezo's Skip feed implements.
interface ISkipAggregator {
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @title SkipOracleAdapter
/// @notice BTC/USD from Mezo's Skip aggregator (updated every block), normalized to 1e18.
/// @dev Behavior verified on Mezo testnet (VERIFIED-FACTS): `answeredInRound` is always 0, so it is
///      not checked; `description()` and `version()` do not exist; decimals are passed in rather
///      than read, because constructors must not call the precompile (ADR-015).
contract SkipOracleAdapter is IPriceOracle {
    error InvalidConfig();
    error InvalidAnswer(int256 answer);
    error StalePrice(uint256 updatedAt);
    error PriceOutOfBounds(uint256 price);

    /// @notice The Skip aggregator.
    ISkipAggregator public immutable feed;
    /// @notice Decimals of the aggregator's answer (18 on Mezo).
    uint8 public immutable feedDecimals;
    /// @notice Oldest acceptable update, in seconds.
    uint256 public immutable maxAge;
    /// @notice Lowest plausible price (1e18); anything below is treated as a broken feed.
    uint256 public immutable minPrice;
    /// @notice Highest plausible price (1e18).
    uint256 public immutable maxPrice;

    constructor(ISkipAggregator feed_, uint8 feedDecimals_, uint256 maxAge_, uint256 minPrice_, uint256 maxPrice_) {
        if (address(feed_) == address(0) || feedDecimals_ > 36 || maxAge_ == 0) revert InvalidConfig();
        if (minPrice_ == 0 || minPrice_ >= maxPrice_) revert InvalidConfig();
        feed = feed_;
        feedDecimals = feedDecimals_;
        maxAge = maxAge_;
        minPrice = minPrice_;
        maxPrice = maxPrice_;
    }

    /// @inheritdoc IPriceOracle
    /// @dev An `updatedAt` slightly ahead of the block time counts as fresh rather than failing.
    function btcUsd() external view returns (uint256 price, uint256 updatedAt) {
        int256 answer;
        (, answer,, updatedAt,) = feed.latestRoundData();
        if (answer <= 0) revert InvalidAnswer(answer);
        if (block.timestamp > updatedAt && block.timestamp - updatedAt > maxAge) revert StalePrice(updatedAt);
        price = OracleMath.to1e18(uint256(answer), -int256(uint256(feedDecimals)));
        if (price < minPrice || price > maxPrice) revert PriceOutOfBounds(price);
    }

    /// @inheritdoc IPriceOracle
    function isSimulated() external pure returns (bool) {
        return false;
    }
}
