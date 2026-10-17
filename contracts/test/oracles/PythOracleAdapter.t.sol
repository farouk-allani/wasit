// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {MockPyth} from "@pythnetwork/pyth-sdk-solidity/MockPyth.sol";
import {PythErrors} from "@pythnetwork/pyth-sdk-solidity/PythErrors.sol";
import {PythOracleAdapter} from "../../src/oracles/PythOracleAdapter.sol";

contract PythOracleAdapterTest is Test {
    bytes32 internal constant BTC_USD = 0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43;

    MockPyth internal pyth;
    PythOracleAdapter internal adapter;

    function setUp() public {
        vm.warp(1_792_182_169);
        pyth = new MockPyth(60, 1);
        adapter = new PythOracleAdapter(pyth, BTC_USD, 1 hours, 100, 1_000e18, 10_000_000e18);
    }

    function _push(int64 price, uint64 conf, int32 expo, uint256 publishTime) internal {
        bytes[] memory data = new bytes[](1);
        data[0] = pyth.createPriceFeedUpdateData(BTC_USD, price, conf, expo, price, conf, uint64(publishTime), 0);
        pyth.updatePriceFeeds{value: pyth.getUpdateFee(data)}(data);
    }

    function test_returnsNormalizedPrice() public {
        _push(6_523_803_881_085, 1_777_881_084, -8, block.timestamp); // values read on Mezo testnet
        (uint256 price, uint256 updatedAt) = adapter.btcUsd();
        assertEq(price, 65_238.03881085e18);
        assertEq(updatedAt, block.timestamp);
        assertFalse(adapter.isSimulated());
    }

    function test_revertsWhenStale() public {
        _push(6_523_803_881_085, 1_000_000, -8, block.timestamp);
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(PythErrors.StalePrice.selector);
        adapter.btcUsd();
    }

    function test_revertsOnWideConfidence() public {
        // conf 1.1% of price, adapter accepts up to 1%
        _push(8_000_000_000_000, 88_000_000_000, -8, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(PythOracleAdapter.ConfidenceTooWide.selector, 880e18, 80_000e18));
        adapter.btcUsd();
    }

    function test_acceptsConfidenceAtLimit() public {
        _push(8_000_000_000_000, 80_000_000_000, -8, block.timestamp); // exactly 1%
        (uint256 price,) = adapter.btcUsd();
        assertEq(price, 80_000e18);
    }

    function test_revertsOnNonPositivePrice() public {
        _push(-1, 0, -8, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(PythOracleAdapter.InvalidAnswer.selector, int64(-1)));
        adapter.btcUsd();
    }

    function test_revertsOutOfBounds() public {
        _push(99_900_000_000, 0, -8, block.timestamp); // 999 USD
        vm.expectRevert(abi.encodeWithSelector(PythOracleAdapter.PriceOutOfBounds.selector, 999e18));
        adapter.btcUsd();
    }

    function test_constructorValidation() public {
        vm.expectRevert(PythOracleAdapter.InvalidConfig.selector);
        new PythOracleAdapter(IPyth(address(0)), BTC_USD, 1 hours, 100, 1, 2);
        vm.expectRevert(PythOracleAdapter.InvalidConfig.selector);
        new PythOracleAdapter(pyth, bytes32(0), 1 hours, 100, 1, 2);
        vm.expectRevert(PythOracleAdapter.InvalidConfig.selector);
        new PythOracleAdapter(pyth, BTC_USD, 0, 100, 1, 2);
        vm.expectRevert(PythOracleAdapter.InvalidConfig.selector);
        new PythOracleAdapter(pyth, BTC_USD, 1 hours, 0, 1, 2);
        vm.expectRevert(PythOracleAdapter.InvalidConfig.selector);
        new PythOracleAdapter(pyth, BTC_USD, 1 hours, 10_001, 1, 2);
        vm.expectRevert(PythOracleAdapter.InvalidConfig.selector);
        new PythOracleAdapter(pyth, BTC_USD, 1 hours, 100, 2, 2);
    }

    function testFuzz_normalizesAnyExpo(uint32 raw, int8 expo) public {
        int32 e = int32(bound(int256(expo), -18, 0));
        raw = uint32(bound(raw, 1, type(uint32).max));
        PythOracleAdapter loose = new PythOracleAdapter(pyth, BTC_USD, 1 hours, 10_000, 1, type(uint256).max);
        _push(int64(uint64(raw)), 0, e, block.timestamp);
        (uint256 price,) = loose.btcUsd();
        assertEq(price, uint256(raw) * 10 ** uint256(int256(18 + e)));
    }
}
