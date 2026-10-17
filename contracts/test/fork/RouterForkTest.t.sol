// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IMezoRouter, MezoRouterAdapter} from "../../src/swap/MezoRouterAdapter.sol";

/// @notice Router quotes on a Mezo testnet fork (pure EVM, so a fork can run them). The swap itself
///         moves BTC, a precompile, and is proven live by script/probes/probe-swap.sh (ADR-015).
contract RouterForkTest is Test {
    // VERIFIED-FACTS
    address internal constant ROUTER = 0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9;
    address internal constant FACTORY = 0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A;
    address internal constant BTC = 0x7b7C000000000000000000000000000000000000;
    address internal constant MUSD = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;

    MezoRouterAdapter internal adapter;

    function setUp() public {
        vm.createSelectFork("mezo_testnet");
        adapter = new MezoRouterAdapter(IMezoRouter(ROUTER), FACTORY, false);
    }

    function test_quote_btcToMusdIsPlausibleAndMonotonic() public view {
        uint256 small = adapter.quote(BTC, MUSD, 0.0001e18);
        uint256 large = adapter.quote(BTC, MUSD, 1e18);
        assertGt(small, 1e18, "0.0001 BTC is worth more than 1 MUSD");
        assertLt(small, 100e18, "and less than 100 MUSD");
        assertLe(large / 10_000, small, "price impact never improves the rate");
    }

    function test_quote_musdToBtc() public view {
        assertGt(adapter.quote(MUSD, BTC, 100e18), 0);
    }
}
