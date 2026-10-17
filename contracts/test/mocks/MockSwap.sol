// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapAdapter} from "../../src/interfaces/ISwapAdapter.sol";

/// @notice Swaps at a settable rate minus a settable slippage, paying out of its own balance.
///         Can be switched to fail outright. Enforces `minOut` like a real adapter.
contract MockSwap is ISwapAdapter {
    using SafeERC20 for IERC20;

    error MockSwapFailure();
    error InsufficientOutput(uint256 amountOut, uint256 minOut);

    uint256 public price; // tokenOut per 1e18 tokenIn, scaled to 1e18
    uint16 public slippageBps; // haircut applied to the output
    bool public fail;

    constructor(uint256 price_) {
        price = price_;
    }

    function setPrice(uint256 price_) external {
        price = price_;
    }

    function setSlippage(uint16 slippageBps_) external {
        slippageBps = slippageBps_;
    }

    function setFail(bool fail_) external {
        fail = fail_;
    }

    function swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address recipient)
        external
        returns (uint256 amountOut)
    {
        if (fail) revert MockSwapFailure();
        amountOut = amountIn * price / 1e18 * (10_000 - slippageBps) / 10_000;
        if (amountOut < minOut) revert InsufficientOutput(amountOut, minOut);
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(recipient, amountOut);
    }
}
