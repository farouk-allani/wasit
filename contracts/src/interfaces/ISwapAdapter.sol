// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ISwapAdapter
/// @notice Exact-input swap used by the bond to convert BTC collateral into MUSD.
interface ISwapAdapter {
    /// @notice Pulls `amountIn` of `tokenIn` from the caller and sends at least `minOut` of
    ///         `tokenOut` to `recipient`.
    /// @dev MUST revert if the output is below `minOut`. MUST leave no allowance behind.
    /// @return amountOut Amount of `tokenOut` sent to `recipient`.
    function swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address recipient)
        external
        returns (uint256 amountOut);
}
