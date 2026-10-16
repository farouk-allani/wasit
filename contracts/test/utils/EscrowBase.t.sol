// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {WasitEscrow} from "../../src/WasitEscrow.sol";
import {IAdvanceBond} from "../../src/interfaces/IAdvanceBond.sol";
import {DealTerms} from "../../src/libraries/WasitTypes.sol";
import {Base} from "./Base.t.sol";

/// @notice Deploys the escrow against the mock bond and drives deals through their states.
abstract contract EscrowBase is Base {
    WasitEscrow internal escrow;

    function setUp() public virtual override {
        super.setUp();
        address[] memory tokens = new address[](1);
        tokens[0] = address(musd);
        escrow = new WasitEscrow(owner, IAdvanceBond(address(bond)), feeRecipient, DEFAULT_FEE_BPS, tokens);
        bond.setEscrow(address(escrow));

        vm.prank(buyer);
        musd.approve(address(escrow), type(uint256).max);
        vm.prank(supplier);
        musd.approve(address(escrow), type(uint256).max);
    }

    function _create(DealTerms memory t) internal returns (uint256 dealId) {
        vm.prank(t.buyer);
        dealId = escrow.createDeal(t);
    }

    /// @dev 0.5% of the default 3,000 advance.
    function _advanceFee() internal pure returns (uint256) {
        return uint256(ADVANCE) * DEFAULT_FEE_BPS / 10_000;
    }
}
