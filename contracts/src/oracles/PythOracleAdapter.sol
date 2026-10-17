// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {IPriceOracle} from "../interfaces/IPriceOracle.sol";
import {OracleMath} from "../libraries/OracleMath.sol";
import {WasitTypes} from "../libraries/WasitTypes.sol";

/// @title PythOracleAdapter
/// @notice BTC/USD from Pyth on Mezo, normalized to 1e18. Alternative to the Skip adapter (ADR-002).
/// @dev On Mezo testnet the Pyth feeds were ~81 days stale when checked (VERIFIED-FACTS), so this
///      adapter can only serve where Mezo's scheduler keeps them fresh.
contract PythOracleAdapter is IPriceOracle {
    error InvalidConfig();
    error InvalidAnswer(int64 price);
    error ConfidenceTooWide(uint256 confidence, uint256 price);
    error PriceOutOfBounds(uint256 price);

    /// @notice Pyth contract.
    IPyth public immutable pyth;
    /// @notice Pyth price feed id (BTC/USD).
    bytes32 public immutable priceId;
    /// @notice Oldest acceptable publish time, in seconds.
    uint256 public immutable maxAge;
    /// @notice Widest acceptable confidence interval, as a share of the price.
    uint16 public immutable maxConfidenceBps;
    /// @notice Lowest plausible price (1e18).
    uint256 public immutable minPrice;
    /// @notice Highest plausible price (1e18).
    uint256 public immutable maxPrice;

    constructor(
        IPyth pyth_,
        bytes32 priceId_,
        uint256 maxAge_,
        uint16 maxConfidenceBps_,
        uint256 minPrice_,
        uint256 maxPrice_
    ) {
        if (address(pyth_) == address(0) || priceId_ == bytes32(0) || maxAge_ == 0) revert InvalidConfig();
        if (maxConfidenceBps_ == 0 || maxConfidenceBps_ > WasitTypes.BPS) revert InvalidConfig();
        if (minPrice_ == 0 || minPrice_ >= maxPrice_) revert InvalidConfig();
        pyth = pyth_;
        priceId = priceId_;
        maxAge = maxAge_;
        maxConfidenceBps = maxConfidenceBps_;
        minPrice = minPrice_;
        maxPrice = maxPrice_;
    }

    /// @inheritdoc IPriceOracle
    /// @dev Reverts with Pyth's `StalePrice()` when the last update is older than `maxAge`.
    function btcUsd() external view returns (uint256 price, uint256 updatedAt) {
        PythStructs.Price memory p = pyth.getPriceNoOlderThan(priceId, maxAge);
        if (p.price <= 0) revert InvalidAnswer(p.price);
        price = OracleMath.to1e18(uint256(uint64(p.price)), p.expo);
        uint256 confidence = OracleMath.to1e18(p.conf, p.expo);
        if (confidence * WasitTypes.BPS > price * maxConfidenceBps) revert ConfidenceTooWide(confidence, price);
        if (price < minPrice || price > maxPrice) revert PriceOutOfBounds(price);
        updatedAt = p.publishTime;
    }

    /// @inheritdoc IPriceOracle
    function isSimulated() external pure returns (bool) {
        return false;
    }
}
