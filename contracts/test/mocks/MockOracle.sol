// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IPriceOracle} from "../../src/interfaces/IPriceOracle.sol";

/// @notice Settable BTC/USD price (1e18) that can be switched to "stale" to test oracle failure.
contract MockOracle is IPriceOracle {
    error StalePrice();

    uint256 public price;
    uint256 public updatedAt;
    bool public stale;

    constructor(uint256 price_) {
        price = price_;
        updatedAt = block.timestamp;
    }

    function setPrice(uint256 price_) external {
        price = price_;
        updatedAt = block.timestamp;
    }

    function setStale(bool stale_) external {
        stale = stale_;
    }

    function btcUsd() external view returns (uint256, uint256) {
        if (stale) revert StalePrice();
        return (price, updatedAt);
    }

    function isSimulated() external pure returns (bool) {
        return false;
    }
}
