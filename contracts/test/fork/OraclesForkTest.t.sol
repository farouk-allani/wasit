// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythErrors} from "@pythnetwork/pyth-sdk-solidity/PythErrors.sol";
import {PythOracleAdapter} from "../../src/oracles/PythOracleAdapter.sol";
import {ISkipAggregator, SkipOracleAdapter} from "../../src/oracles/SkipOracleAdapter.sol";

/// @notice Runs against a Mezo testnet fork: `FOUNDRY_PROFILE=fork MEZO_TESTNET_RPC=... forge test`.
///         Skip itself is proven live by script/probes/probe-oracles.sh (ADR-015).
contract OraclesForkTest is Test {
    // VERIFIED-FACTS
    address internal constant PYTH = 0x2880aB155794e7179c9eE2e38200202908C17B43;
    bytes32 internal constant PYTH_BTC_USD = 0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43;
    address internal constant SKIP_BTC_USD = 0x7b7c000000000000000000000000000000000015;

    function setUp() public {
        vm.createSelectFork("mezo_testnet");
        assertEq(block.chainid, 31_611);
    }

    /// Fresh feed → a plausible price; stale feed (as on 2026-10-16) → Pyth's StalePrice, never a
    /// silently old price.
    function test_pythAdapter_freshPriceOrStaleRevert() public {
        PythOracleAdapter adapter =
            new PythOracleAdapter(IPyth(PYTH), PYTH_BTC_USD, 1 hours, 100, 1_000e18, 10_000_000e18);
        try adapter.btcUsd() returns (uint256 price, uint256 updatedAt) {
            assertGe(block.timestamp - updatedAt, 0);
            assertLe(block.timestamp - updatedAt, 1 hours);
            assertGt(price, 1_000e18);
        } catch (bytes memory reason) {
            assertEq(bytes4(reason), PythErrors.StalePrice.selector);
        }
    }

    /// Documents ADR-015: the Skip feed is a Go precompile, and a local fork only sees its stub code.
    function test_skipPrecompile_cannotRunOnAFork() public {
        SkipOracleAdapter adapter =
            new SkipOracleAdapter(ISkipAggregator(SKIP_BTC_USD), 18, 15 minutes, 1_000e18, 10_000_000e18);
        vm.expectRevert();
        adapter.btcUsd();
    }
}
