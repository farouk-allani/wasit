// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IMezoRouter} from "../../src/swap/MezoRouterAdapter.sol";

/// @notice Router stand-in: fixed rate minus a 0.30% fee, checks the route and the deadline, and
///         records the last route it saw.
contract MockMezoRouter is IMezoRouter {
    using SafeERC20 for IERC20;

    error Expired();
    error InsufficientOutputAmount();
    error BadRoute();

    uint256 public rate; // tokenOut per 1e18 tokenIn, scaled to 1e18
    uint256 public shortChangeBy; // deliver this much less than reported
    Route public lastRoute;

    constructor(uint256 rate_) {
        rate = rate_;
    }

    function setRate(uint256 rate_) external {
        rate = rate_;
    }

    function setShortChange(uint256 amount) external {
        shortChangeBy = amount;
    }

    function getAmountsOut(uint256 amountIn, Route[] calldata routes) public view returns (uint256[] memory amounts) {
        if (routes.length != 1) revert BadRoute();
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = amountIn * rate / 1e18 * 9_970 / 10_000;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        if (deadline < block.timestamp) revert Expired();
        amounts = getAmountsOut(amountIn, routes);
        if (amounts[1] < amountOutMin) revert InsufficientOutputAmount();
        lastRoute = routes[0];
        IERC20(routes[0].from).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(routes[0].to).safeTransfer(to, amounts[1] - shortChangeBy);
    }
}
