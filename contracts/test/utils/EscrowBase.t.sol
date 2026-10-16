// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {WasitEscrow} from "../../src/WasitEscrow.sol";
import {IAdvanceBond} from "../../src/interfaces/IAdvanceBond.sol";
import {AttestationKind, BondStatus, DealTerms} from "../../src/libraries/WasitTypes.sol";
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

    function _goodsReady(DealTerms memory t) internal returns (uint256 dealId) {
        dealId = _advancePaid(t);
        _attest(dealId, AttestationKind.ReadyInspected, inspectorKey);
    }

    function _evidence(uint256 dealId, AttestationKind kind) internal pure returns (bytes32) {
        return keccak256(abi.encode("evidence", dealId, kind));
    }

    /// @dev Signs with `key` for the deal's current nonce, issued now, and submits as the keeper.
    function _attest(uint256 dealId, AttestationKind kind, uint256 key) internal {
        bytes32 evidence = _evidence(dealId, kind);
        uint64 issuedAt = uint64(block.timestamp);
        uint256 nonce = escrow.getDeal(dealId).attestationNonce;
        bytes memory sig = _sign(key, _attestationDigest(address(escrow), dealId, kind, evidence, issuedAt, nonce));
        vm.prank(keeper);
        escrow.submitAttestation(dealId, kind, evidence, issuedAt, sig);
    }

    /// @dev 0.5% of the default 3,000 advance.
    function _advanceFee() internal pure returns (uint256) {
        return uint256(ADVANCE) * DEFAULT_FEE_BPS / 10_000;
    }
}
