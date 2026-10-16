// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {IAdvanceBond} from "../src/interfaces/IAdvanceBond.sol";
import {BondStatus} from "../src/libraries/WasitTypes.sol";
import {MockAdvanceBond} from "./mocks/MockAdvanceBond.sol";
import {MockERC1271Wallet} from "./mocks/MockERC1271Wallet.sol";
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
}
