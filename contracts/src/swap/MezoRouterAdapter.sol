// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapAdapter} from "../interfaces/ISwapAdapter.sol";

/// @notice Mezo's basic (Aerodrome-style) Router, as read from its verified source on the testnet
///         explorer (VERIFIED-FACTS).
interface IMezoRouter {
    struct Route {
        address from;
        address to;
        bool stable;
        address factory;
    }

    function getAmountsOut(uint256 amountIn, Route[] calldata routes) external view returns (uint256[] memory);

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory);
}

/// @title MezoRouterAdapter
/// @notice Single-hop exact-input swaps through Mezo's Router (MUSD/BTC is a volatile pool).
///         Holds no funds between calls: pulls the input from the caller, pays the recipient, and
///         leaves no allowance behind.
contract MezoRouterAdapter is ISwapAdapter {
    using SafeERC20 for IERC20;

    error InvalidConfig();
    error ZeroAmount();
    error SameToken();
    error InsufficientOutput(uint256 amountOut, uint256 minOut);

    /// @notice Mezo basic Router.
    IMezoRouter public immutable router;
    /// @notice Pool factory used in routes.
    address public immutable factory;
    /// @notice Pool type used in routes (false = volatile, as for MUSD/BTC).
    bool public immutable stable;

    constructor(IMezoRouter router_, address factory_, bool stable_) {
        if (address(router_) == address(0) || factory_ == address(0)) revert InvalidConfig();
        router = router_;
        factory = factory_;
        stable = stable_;
    }

    /// @inheritdoc ISwapAdapter
    /// @dev The deadline is the current block: the swap runs atomically inside the caller's
    ///      transaction, and `minOut` (set by the caller from its oracle) is the real protection.
    function swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address recipient)
        external
        returns (uint256 amountOut)
    {
        if (amountIn == 0) revert ZeroAmount();
        if (tokenIn == tokenOut) revert SameToken();

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).forceApprove(address(router), amountIn);
        uint256 before = IERC20(tokenOut).balanceOf(recipient);
        // Measured, not trusted: the router's return value is ignored on purpose (ADR-021).
        // slither-disable-next-line reentrancy-balance,unused-return
        router.swapExactTokensForTokens(amountIn, minOut, _route(tokenIn, tokenOut), recipient, block.timestamp);
        IERC20(tokenIn).forceApprove(address(router), 0);

        amountOut = IERC20(tokenOut).balanceOf(recipient) - before;
        if (amountOut < minOut) revert InsufficientOutput(amountOut, minOut);
    }

    /// @notice Router quote for `amountIn` of `tokenIn` (pool price and fee, before slippage).
    function quote(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256) {
        return router.getAmountsOut(amountIn, _route(tokenIn, tokenOut))[1];
    }

    function _route(address tokenIn, address tokenOut) private view returns (IMezoRouter.Route[] memory routes) {
        routes = new IMezoRouter.Route[](1);
        routes[0] = IMezoRouter.Route({from: tokenIn, to: tokenOut, stable: stable, factory: factory});
    }
}
