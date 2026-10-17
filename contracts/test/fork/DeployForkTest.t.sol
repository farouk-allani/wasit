// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../../script/Deploy.s.sol";
import {DealState, DealTerms} from "../../src/libraries/WasitTypes.sol";
import {ISkipAggregator, SkipOracleAdapter} from "../../src/oracles/SkipOracleAdapter.sol";

/// @notice The live deployment, rehearsed on a Mezo testnet fork with the real addresses from
///         deployments/config/mezo-testnet.json. Constructors never touch the precompiles, so the
///         whole set deploys on a fork (ADR-015).
contract DeployForkTest is Test {
    Deploy internal script;
    Deploy.Config internal c;
    Deploy.Deployment internal d;

    function setUp() public {
        vm.createSelectFork("mezo_testnet");
        script = new Deploy();
        c = script.loadConfig("mezo-testnet");
        c.owner = makeAddr("owner");
        c.feeRecipient = makeAddr("fees");
        SkipOracleAdapter oracle =
            new SkipOracleAdapter(ISkipAggregator(c.skipBtcUsd), c.skipDecimals, c.skipMaxAge, c.minPrice, c.maxPrice);
        d = script.deploy(c, oracle, address(script));
    }

    function test_deploysAgainstRealAddresses() public view {
        assertEq(block.chainid, 31_611);
        assertEq(d.escrow.bond(), address(d.bond));
        assertEq(address(d.bond.escrow()), address(d.escrow));
        assertEq(address(d.bond.btc()), c.btc);
        assertEq(address(d.bond.musd()), c.musd);
        assertTrue(d.escrow.isTokenAllowed(c.musd));
        assertFalse(d.bond.oracle().isSimulated());
    }

    function test_swapAdapterQuotesTheRealPool() public view {
        assertGt(d.swapAdapter.quote(c.btc, c.musd, 0.0001e18), 1e18);
    }

    function test_buyerCanCreateADeal() public {
        address buyer = makeAddr("buyer");
        DealTerms memory t = DealTerms({
            buyer: buyer,
            supplier: makeAddr("supplier"),
            inspector: makeAddr("inspector"),
            carrier: makeAddr("carrier"),
            arbiter: makeAddr("arbiter"),
            bonder: makeAddr("agent"),
            token: c.musd,
            advanceAmount: 3_000e18,
            balanceAmount: 7_000e18,
            feeBps: c.feeBps,
            bondRatioBps: 15_000,
            productionPeriod: 30 days,
            balanceWindow: 7 days,
            shippingPeriod: 14 days,
            challengeWindow: 3 days,
            arbitrationPeriod: 14 days,
            termsHash: keccak256("terms")
        });
        vm.prank(buyer);
        uint256 id = d.escrow.createDeal(t);
        assertEq(uint8(d.escrow.getDeal(id).state), uint8(DealState.Created));
    }
}
