// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IMezoRouter, MezoRouterAdapter} from "../../src/swap/MezoRouterAdapter.sol";

/// @notice Live integration probe (ADR-015). Simulated on Mezo testnet with
///         `cast call --from <funded EOA> --value <wei> --create`: the native BTC sent with the call
///         is used as the BTC ERC-20 (precompile), swapped to MUSD through a freshly deployed
///         MezoRouterAdapter, and the results are returned as a revert. Nothing is deployed or signed.
contract SwapProbe {
    error Results(uint256 quoted, uint256 received, uint256 musdBalance, uint256 btcLeft, uint256 allowanceLeft);

    constructor(IMezoRouter router, address factory, IERC20 btc, IERC20 musd) payable {
        MezoRouterAdapter adapter = new MezoRouterAdapter(router, factory, false);
        uint256 amountIn = msg.value;
        uint256 quoted = adapter.quote(address(btc), address(musd), amountIn);

        btc.approve(address(adapter), amountIn);
        uint256 received = adapter.swapExactIn(address(btc), address(musd), amountIn, quoted * 99 / 100, address(this));

        revert Results(
            quoted,
            received,
            musd.balanceOf(address(this)),
            btc.balanceOf(address(this)),
            btc.allowance(address(adapter), address(router))
        );
    }
}
