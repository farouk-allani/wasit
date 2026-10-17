// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title OracleMath
/// @notice Shared helpers for oracle adapters.
library OracleMath {
    /// @notice The exponent is outside what a BTC/USD feed can sensibly use.
    error UnsupportedExponent(int256 exponent);

    /// @notice Converts `value × 10^exponent` to an 18-decimal fixed-point number.
    /// @dev Rounds down when scaling down. Exponents are limited to [-36, 18].
    function to1e18(uint256 value, int256 exponent) internal pure returns (uint256) {
        if (exponent < -36 || exponent > 18) revert UnsupportedExponent(exponent);
        int256 shift = 18 + exponent;
        if (shift >= 0) return value * 10 ** uint256(shift);
        return value / 10 ** uint256(-shift);
    }
}
