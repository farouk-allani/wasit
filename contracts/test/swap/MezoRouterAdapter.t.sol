// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IMezoRouter, MezoRouterAdapter} from "../../src/swap/MezoRouterAdapter.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockMezoRouter} from "../mocks/MockMezoRouter.sol";

contract MezoRouterAdapterTest is Test {
    address internal constant FACTORY = 0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A;
    address internal recipient = makeAddr("recipient");

    MockERC20 internal btc;
    MockERC20 internal musd;
    MockMezoRouter internal router;
    MezoRouterAdapter internal adapter;

    function setUp() public {
        btc = new MockERC20("BTC", "BTC", 18);
        musd = new MockERC20("Mezo USD", "MUSD", 18);
        router = new MockMezoRouter(80_000e18);
        adapter = new MezoRouterAdapter(router, FACTORY, false);
        musd.mint(address(router), 1_000_000e18);
        btc.mint(address(this), 10e18);
        btc.approve(address(adapter), type(uint256).max);
    }

    function test_swapsThroughVolatileRouteAndPaysRecipient() public {
        uint256 expected = 0.1e18 * uint256(80_000) * 9_970 / 10_000; // 7,976 MUSD after the 0.30% fee
        uint256 out = adapter.swapExactIn(address(btc), address(musd), 0.1e18, expected, recipient);

        assertEq(out, expected);
        assertEq(musd.balanceOf(recipient), expected);
        assertEq(btc.balanceOf(address(router)), 0.1e18);
        assertEq(btc.balanceOf(address(adapter)), 0, "adapter keeps nothing");
        assertEq(btc.allowance(address(adapter), address(router)), 0, "no allowance left behind");
        (address from, address to, bool stable, address factory) = router.lastRoute();
        assertEq(from, address(btc));
        assertEq(to, address(musd));
        assertFalse(stable);
        assertEq(factory, FACTORY);
    }

    function test_quoteMatchesRouter() public view {
        assertEq(adapter.quote(address(btc), address(musd), 1e18), 79_760e18);
    }

    function test_routerEnforcesMinOut() public {
        vm.expectRevert(MockMezoRouter.InsufficientOutputAmount.selector);
        adapter.swapExactIn(address(btc), address(musd), 0.1e18, 7_977e18, recipient);
    }

    function test_adapterChecksWhatRecipientReceived() public {
        router.setShortChange(1);
        vm.expectRevert(abi.encodeWithSelector(MezoRouterAdapter.InsufficientOutput.selector, 7_976e18 - 1, 7_976e18));
        adapter.swapExactIn(address(btc), address(musd), 0.1e18, 7_976e18, recipient);
    }

    function test_rejectsZeroAmountAndSameToken() public {
        vm.expectRevert(MezoRouterAdapter.ZeroAmount.selector);
        adapter.swapExactIn(address(btc), address(musd), 0, 0, recipient);
        vm.expectRevert(MezoRouterAdapter.SameToken.selector);
        adapter.swapExactIn(address(btc), address(btc), 1, 0, recipient);
    }

    function test_constructorValidation() public {
        vm.expectRevert(MezoRouterAdapter.InvalidConfig.selector);
        new MezoRouterAdapter(IMezoRouter(address(0)), FACTORY, false);
        vm.expectRevert(MezoRouterAdapter.InvalidConfig.selector);
        new MezoRouterAdapter(router, address(0), false);
    }
}
