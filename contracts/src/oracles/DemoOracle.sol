// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IPriceOracle} from "../interfaces/IPriceOracle.sol";

/// @title DemoOracle
/// @notice Owner-set BTC/USD price for the labeled `demo-sim` deployment ONLY (ADR-008). Testnet BTC
///         cannot be moved for a demo, so this shows the protection mechanism honestly: it reports
///         `isSimulated() == true` and the UI must show "Simulated price feed" whenever it is used.
///         Never part of the live deployment.
contract DemoOracle is IPriceOracle, Ownable2Step {
    error InvalidPrice();

    event PriceSet(uint256 price, uint256 updatedAt);

    /// @notice Simulated USD per BTC, 1e18.
    uint256 public price;
    /// @notice When the simulated price was last set.
    uint256 public updatedAt;

    constructor(address initialOwner, uint256 initialPrice) Ownable(initialOwner) {
        _setPrice(initialPrice);
    }

    /// @notice Sets the simulated price.
    function setPrice(uint256 newPrice) external onlyOwner {
        _setPrice(newPrice);
    }

    /// @inheritdoc IPriceOracle
    function btcUsd() external view returns (uint256, uint256) {
        return (price, updatedAt);
    }

    /// @inheritdoc IPriceOracle
    function isSimulated() external pure returns (bool) {
        return true;
    }

    function _setPrice(uint256 newPrice) private {
        if (newPrice == 0) revert InvalidPrice();
        price = newPrice;
        updatedAt = block.timestamp;
        emit PriceSet(newPrice, block.timestamp);
    }
}
