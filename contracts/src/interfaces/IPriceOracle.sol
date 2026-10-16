// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IPriceOracle
/// @notice BTC/USD price source used by the bond. Adapters normalize every feed to 1e18.
interface IPriceOracle {
    /// @notice USD per 1 BTC scaled to 1e18, and when the underlying feed was updated.
    /// @dev MUST revert if the feed is stale or outside the adapter's bounds. Callers never sell
    ///      BTC on a price this function did not return.
    function btcUsd() external view returns (uint256 price1e18, uint256 updatedAt);

    /// @notice True only for the labeled demo oracle; the UI shows "Simulated price feed" if so.
    function isSimulated() external view returns (bool);
}
