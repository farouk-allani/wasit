// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../../script/Deploy.s.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockMezoRouter} from "../mocks/MockMezoRouter.sol";
import {MockOracle} from "../mocks/MockOracle.sol";

contract DeployScriptTest is Test {
    Deploy internal script;

    function setUp() public {
        script = new Deploy();
    }

    function test_loadConfig_matchesVerifiedFacts() public view {
        Deploy.Config memory c = script.loadConfig("mezo-testnet");
        assertEq(c.chainId, 31_611);
        assertEq(c.btc, 0x7b7C000000000000000000000000000000000000);
        assertEq(c.musd, 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503);
        assertEq(c.skipBtcUsd, 0x7b7c000000000000000000000000000000000015);
        assertEq(c.skipDecimals, 18);
        assertEq(c.router, 0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9);
        assertEq(c.poolFactory, 0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A);
        assertEq(c.feeBps, 50);
        assertEq(c.topUpRatioBps, 13_000);
        assertEq(c.protectRatioBps, 11_500);
        assertEq(c.maxSlippageBps, 600, "ADR-016 testnet tolerance");
        assertEq(c.minPrice, 1_000e18);
        assertEq(c.maxPrice, 10_000_000e18);
    }

    function test_deploy_wiresEscrowAndBond() public {
        Deploy.Config memory c = script.loadConfig("mezo-testnet");
        c.owner = makeAddr("owner");
        c.feeRecipient = makeAddr("fees");
        c.btc = address(new MockERC20("BTC", "BTC", 18));
        c.musd = address(new MockERC20("Mezo USD", "MUSD", 18));
        c.router = address(new MockMezoRouter(80_000e18));
        MockOracle oracle = new MockOracle(80_000e18);

        Deploy.Deployment memory d = script.deploy(c, oracle, address(script));

        assertEq(d.escrow.bond(), address(d.bond));
        assertEq(address(d.bond.escrow()), address(d.escrow));
        assertEq(address(d.bond.oracle()), address(oracle));
        assertEq(address(d.bond.swapAdapter()), address(d.swapAdapter));
        assertEq(address(d.swapAdapter.router()), c.router);
        assertEq(d.swapAdapter.factory(), c.poolFactory);
        assertEq(d.escrow.owner(), c.owner);
        assertEq(d.bond.owner(), c.owner);
        assertEq(d.escrow.feeRecipient(), c.feeRecipient);
        assertEq(d.escrow.defaultFeeBps(), 50);
        assertTrue(d.escrow.isTokenAllowed(c.musd));
        assertEq(d.bond.maxSlippageBps(), 600);
        assertEq(d.deployBlock, block.number);
    }
}
