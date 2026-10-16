// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {WasitEscrow} from "../../src/WasitEscrow.sol";
import {IAdvanceBond} from "../../src/interfaces/IAdvanceBond.sol";
import {BondStatus, DealTerms} from "../../src/libraries/WasitTypes.sol";
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

    /// @dev Created + supplier accepted + arbiter accepted + (mock) bond Active at the required ratio.
    function _accepted(DealTerms memory t) internal returns (uint256 dealId) {
        dealId = _create(t);
        vm.prank(t.supplier);
        escrow.accept(dealId);
        vm.prank(t.arbiter);
        escrow.acceptArbiter(dealId);
        if (t.bonder != address(0)) bond.setBond(dealId, t.bonder, BondStatus.Active, t.bondRatioBps);
    }

    function _advancePaid(DealTerms memory t) internal returns (uint256 dealId) {
        dealId = _accepted(t);
        vm.prank(t.buyer);
        escrow.fundAdvance(dealId);
    }

    /// @dev 0.5% of the default 3,000 advance.
    function _advanceFee() internal pure returns (uint256) {
        return uint256(ADVANCE) * DEFAULT_FEE_BPS / 10_000;
    }
}
