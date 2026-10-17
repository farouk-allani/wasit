// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {IAdvanceBond} from "../src/interfaces/IAdvanceBond.sol";
import {BondStatus} from "../src/libraries/WasitTypes.sol";
import {MockAdvanceBond} from "./mocks/MockAdvanceBond.sol";
import {MockERC1271Wallet} from "./mocks/MockERC1271Wallet.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockOracle} from "./mocks/MockOracle.sol";
import {MockSwap} from "./mocks/MockSwap.sol";
import {Base} from "./utils/Base.t.sol";

/// @notice Checks the test helpers themselves, so escrow tests can rely on them.
contract FixturesTest is Base {
    function test_erc1271WalletAcceptsOwnerSignature() public {
        MockERC1271Wallet wallet = new MockERC1271Wallet(inspector);
        bytes32 digest = keccak256("message");
        assertEq(wallet.isValidSignature(digest, _sign(inspectorKey, digest)), IERC1271.isValidSignature.selector);
    }

    function test_erc1271WalletRejectsOtherSigner() public {
        MockERC1271Wallet wallet = new MockERC1271Wallet(inspector);
        bytes32 digest = keccak256("message");
        assertEq(wallet.isValidSignature(digest, _sign(carrierKey, digest)), bytes4(0xffffffff));
    }

    function test_permitHelperProducesValidPermit() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSignature(buyerKey, stranger, 123e18, deadline);
        musd.permit(buyer, stranger, 123e18, deadline, v, r, s);
        assertEq(musd.allowance(buyer, stranger), 123e18);
    }

    function test_mockBondClaimPaysAndCapsAtBalance() public {
        bond.setEscrow(address(this));
        bond.setBond(1, agent, BondStatus.Active, 15_000);
        uint256 available = musd.balanceOf(address(bond));

        uint256 paid = bond.claim(1, available + 1, buyer);

        assertEq(paid, available);
        assertEq(uint8(bond.bondOf(1).status), uint8(BondStatus.Claimed));
    }

    function test_mockBondOnlyEscrow() public {
        bond.setEscrow(address(this));
        vm.prank(stranger);
        vm.expectRevert(IAdvanceBond.NotEscrow.selector);
        bond.release(1);
    }

    function test_mockBondFailureSwitch() public {
        bond.setEscrow(address(this));
        bond.setBond(1, agent, BondStatus.Active, 15_000);
        bond.setFailures(true, true);
        vm.expectRevert(MockAdvanceBond.MockFailure.selector);
        bond.claim(1, 1, buyer);
        vm.expectRevert(MockAdvanceBond.MockFailure.selector);
        bond.release(1);
    }

    function test_mockOracleReturnsAndGoesStale() public {
        MockOracle oracle = new MockOracle(80_000e18);
        (uint256 price, uint256 updatedAt) = oracle.btcUsd();
        assertEq(price, 80_000e18);
        assertEq(updatedAt, block.timestamp);
        assertFalse(oracle.isSimulated());
        oracle.setStale(true);
        vm.expectRevert(MockOracle.StalePrice.selector);
        oracle.btcUsd();
    }

    function test_mockSwapAppliesRateAndSlippage() public {
        MockERC20 btc = new MockERC20("BTC", "BTC", 18);
        MockSwap swap = new MockSwap(80_000e18);
        swap.setSlippage(100); // 1%
        btc.mint(address(this), 1e18);
        musd.mint(address(swap), 100_000e18);
        btc.approve(address(swap), 1e18);

        uint256 out = swap.swapExactIn(address(btc), address(musd), 0.5e18, 39_600e18, stranger);

        assertEq(out, 39_600e18);
        assertEq(musd.balanceOf(stranger), 39_600e18);
        assertEq(btc.balanceOf(address(swap)), 0.5e18);
    }

    function test_mockSwapEnforcesMinOutAndFailure() public {
        MockERC20 btc = new MockERC20("BTC", "BTC", 18);
        MockSwap swap = new MockSwap(80_000e18);
        vm.expectRevert(abi.encodeWithSelector(MockSwap.InsufficientOutput.selector, 80_000e18, 80_001e18));
        swap.swapExactIn(address(btc), address(musd), 1e18, 80_001e18, stranger);
        swap.setFail(true);
        vm.expectRevert(MockSwap.MockSwapFailure.selector);
        swap.swapExactIn(address(btc), address(musd), 1e18, 0, stranger);
    }
}
