// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IPriceOracle} from "../interfaces/IPriceOracle.sol";
import {ISkipAggregator} from "./SkipOracleAdapter.sol";

/// @notice The two views of MUSD's own PriceFeed that the adapter reads (VERIFIED-FACTS).
interface IMusdPriceFeed {
    /// @notice BTC/USD scaled to 1e18; reverts "PriceFeed: Oracle is stale." past 60 s.
    function fetchPrice() external view returns (uint256);

    /// @notice The aggregator the PriceFeed wraps (Mezo's Skip feed).
    function oracle() external view returns (address);
}

/// @title MusdPriceFeedAdapter
/// @notice BTC/USD from MUSD's own PriceFeed, the price the MUSD system liquidates troves on, under
///         the protocol's own 60 s staleness policy. It wraps the same Skip aggregator as
///         `SkipOracleAdapter`, so it is not a second price source: its value is that a bond is
///         priced exactly as MUSD prices collateral.
/// @dev Any revert of the PriceFeed (stale, broken aggregator) becomes `PriceUnavailable`, so the
///      app can show "price unavailable" instead of an opaque error. The PriceFeed is an
///      upgradeable proxy under Mezo governance; the plausibility bounds guard against a broken
///      upgrade returning nonsense.
contract MusdPriceFeedAdapter is IPriceOracle {
    error InvalidConfig();
    error PriceUnavailable();
    error PriceOutOfBounds(uint256 price);

    /// @notice MUSD's PriceFeed.
    IMusdPriceFeed public immutable priceFeed;
    /// @notice Lowest plausible price (1e18).
    uint256 public immutable minPrice;
    /// @notice Highest plausible price (1e18).
    uint256 public immutable maxPrice;

    constructor(IMusdPriceFeed priceFeed_, uint256 minPrice_, uint256 maxPrice_) {
        if (address(priceFeed_).code.length == 0) revert InvalidConfig();
        if (minPrice_ == 0 || minPrice_ >= maxPrice_) revert InvalidConfig();
        priceFeed = priceFeed_;
        minPrice = minPrice_;
        maxPrice = maxPrice_;
    }

    /// @inheritdoc IPriceOracle
    /// @dev `updatedAt` is the wrapped aggregator's, read in the same call, i.e. the timestamp the
    ///      PriceFeed itself just checked against its 60 s bound.
    function btcUsd() external view returns (uint256 price, uint256 updatedAt) {
        try priceFeed.fetchPrice() returns (uint256 p) {
            price = p;
        } catch {
            revert PriceUnavailable();
        }
        if (price < minPrice || price > maxPrice) revert PriceOutOfBounds(price);
        try priceFeed.oracle() returns (address aggregator) {
            try ISkipAggregator(aggregator).latestRoundData() returns (uint80, int256, uint256, uint256 u, uint80) {
                updatedAt = u;
            } catch {
                revert PriceUnavailable();
            }
        } catch {
            revert PriceUnavailable();
        }
    }

    /// @inheritdoc IPriceOracle
    function isSimulated() external pure returns (bool) {
        return false;
    }
}
