// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IERC20Like {
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @dev Route struct as read from the verified Router on the testnet explorer.
interface IRouterLike {
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

/// @notice Pulls BTC from the caller with `transferFrom` and sends it back with `transfer`.
contract BtcPuller {
    error TransferFailed();

    /// @notice Moves `amount` BTC from `from` to this contract (needs an allowance).
    function pull(IERC20Like btc, address from, uint256 amount) external {
        if (!btc.transferFrom(from, address(this), amount)) revert TransferFailed();
    }

    /// @notice Sends `amount` BTC held by this contract to `to`.
    function push(IERC20Like btc, address to, uint256 amount) external {
        if (!btc.transfer(to, amount)) revert TransferFailed();
    }
}

/// @notice Phase 0 probe for the BTC ERC-20 precompile and the Router. Meant to be simulated with
///         `cast call --from <funded EOA> --value <wei> --create <initcode>`: it never deploys,
///         it always reverts with `Results` so the caller can decode what happened.
/// @dev Splits msg.value in two. Half goes through approve → transferFrom → transfer; the other
///      half is swapped BTC → MUSD through the Router with the quoted amount as minimum.
contract BtcProbe {
    error Results(uint256[10] r);
    error CallFailed(uint256 step);

    constructor(IERC20Like btc, IERC20Like musd, IRouterLike router, address factory) payable {
        uint256[10] memory r;
        uint256 half = msg.value / 2;

        // r0: ERC-20 view of the native value just received (expect msg.value)
        r[0] = btc.balanceOf(address(this));

        BtcPuller puller = new BtcPuller();
        if (!btc.approve(address(puller), half)) revert CallFailed(1);
        // r1: allowance after approve (expect half)
        r[1] = btc.allowance(address(this), address(puller));
        puller.pull(btc, address(this), half);
        // r2, r3: puller balance seen as ERC-20 and as native (expect half, half)
        r[2] = btc.balanceOf(address(puller));
        r[3] = address(puller).balance;
        // r4: allowance consumed (expect 0)
        r[4] = btc.allowance(address(this), address(puller));
        puller.push(btc, address(this), half);
        // r5: balance after the round trip (expect msg.value)
        r[5] = btc.balanceOf(address(this));

        IRouterLike.Route[] memory routes = new IRouterLike.Route[](1);
        routes[0] = IRouterLike.Route({from: address(btc), to: address(musd), stable: false, factory: factory});
        // r6: quoted MUSD out for `half` BTC
        r[6] = router.getAmountsOut(half, routes)[1];
        if (!btc.approve(address(router), half)) revert CallFailed(2);
        // r7: MUSD actually received from the swap
        r[7] = router.swapExactTokensForTokens(half, r[6], routes, address(this), block.timestamp)[1];
        // r8, r9: final MUSD and BTC balances (expect r7, msg.value - half)
        r[8] = musd.balanceOf(address(this));
        r[9] = btc.balanceOf(address(this));

        revert Results(r);
    }
}
