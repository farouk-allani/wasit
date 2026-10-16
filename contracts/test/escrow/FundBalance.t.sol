// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IWasitEscrow} from "../../src/interfaces/IWasitEscrow.sol";
import {AttestationKind, Deal, DealState, DealTerms} from "../../src/libraries/WasitTypes.sol";
import {EscrowBase} from "../utils/EscrowBase.t.sol";

contract FundBalanceTest is EscrowBase {
    AttestationKind internal constant SHIPPED = AttestationKind.Shipped;

    // ── fundBalance ──

    function test_fundBalance_escrowsBalance() public {
        uint256 id = _goodsReady(_terms());
        uint256 buyerBefore = musd.balanceOf(buyer);

        vm.expectEmit(address(escrow));
        emit IWasitEscrow.BalanceFunded(id, BALANCE);
        vm.prank(buyer);
        escrow.fundBalance(id);

        assertEq(musd.balanceOf(buyer), buyerBefore - BALANCE);
        assertEq(musd.balanceOf(address(escrow)), BALANCE + _advanceFee());
        Deal memory d = escrow.getDeal(id);
        assertEq(uint8(d.state), uint8(DealState.BalanceFunded));
        assertEq(d.balanceHeld, BALANCE);
        assertEq(d.balanceFundedAt, block.timestamp);
        (,, uint256 shipBy,,) = escrow.deadlines(id);
        assertEq(shipBy, block.timestamp + 14 days);
    }

    function test_fundBalance_revertsIfNotBuyer() public {
        uint256 id = _goodsReady(_terms());
        vm.prank(supplier);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.Unauthorized.selector, supplier));
        escrow.fundBalance(id);
    }

    function test_fundBalance_revertsBeforeReady() public {
        uint256 id = _advancePaid(_terms());
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.InvalidState.selector, id, DealState.AdvancePaid));
        escrow.fundBalance(id);
    }

    function test_fundBalance_acceptedExactlyAtDue() public {
        uint256 id = _goodsReady(_terms());
        (, uint256 due,,,) = escrow.deadlines(id);
        vm.warp(due);
        vm.prank(buyer);
        escrow.fundBalance(id);
        assertEq(uint8(escrow.getDeal(id).state), uint8(DealState.BalanceFunded));
    }

    function test_fundBalance_revertsAfterDue() public {
        uint256 id = _goodsReady(_terms());
        (, uint256 due,,,) = escrow.deadlines(id);
        vm.warp(due + 1);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.DeadlinePassed.selector, due));
        escrow.fundBalance(id);
    }

    function test_fundBalanceWithPermit_noPriorAllowance() public {
        uint256 id = _goodsReady(_terms());
        vm.prank(buyer);
        musd.approve(address(escrow), 0);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSignature(buyerKey, address(escrow), BALANCE, deadline);

        vm.prank(buyer);
        escrow.fundBalanceWithPermit(id, deadline, v, r, s);

        assertEq(escrow.getDeal(id).balanceHeld, BALANCE);
    }

    // ── SHIPPED attestation ──

    function test_shipped_byCarrier() public {
        uint256 id = _balanceFunded(_terms());
        vm.warp(block.timestamp + 2 days);
        bytes32 evidence = _evidence(id, SHIPPED);
        uint64 issuedAt = uint64(block.timestamp - 1 days);
        bytes memory sig = _sign(carrierKey, _attestationDigest(address(escrow), id, SHIPPED, evidence, issuedAt, 1));

        vm.expectEmit(address(escrow));
        emit IWasitEscrow.Attested(id, SHIPPED, carrier, evidence, issuedAt);
        escrow.submitAttestation(id, SHIPPED, evidence, issuedAt, sig);

        Deal memory d = escrow.getDeal(id);
        assertEq(uint8(d.state), uint8(DealState.Shipped));
        assertEq(d.shippedAt, block.timestamp);
        assertEq(d.attestationNonce, 2);
        (,,, uint256 challengeEnds,) = escrow.deadlines(id);
        assertEq(challengeEnds, block.timestamp + 3 days);
    }

    function test_shipped_revertsWhenInspectorSigns() public {
        uint256 id = _balanceFunded(_terms());
        bytes32 evidence = _evidence(id, SHIPPED);
        uint64 issuedAt = uint64(block.timestamp);
        bytes memory sig = _sign(inspectorKey, _attestationDigest(address(escrow), id, SHIPPED, evidence, issuedAt, 1));
        vm.expectRevert(IWasitEscrow.InvalidSignature.selector);
        escrow.submitAttestation(id, SHIPPED, evidence, issuedAt, sig);
    }

    function test_shipped_sameAddressForBothRoles() public {
        DealTerms memory t = _terms();
        t.carrier = inspector;
        uint256 id = _balanceFunded(t);
        _attest(id, SHIPPED, inspectorKey);
        assertEq(uint8(escrow.getDeal(id).state), uint8(DealState.Shipped));
    }

    function test_shipped_revertsOnReadySignatureReuse() public {
        uint256 id = _balanceFunded(_terms());
        bytes32 evidence = _evidence(id, SHIPPED);
        uint64 issuedAt = uint64(block.timestamp);
        // A READY signature with nonce 0 cannot pass as SHIPPED: kind and nonce both differ.
        bytes memory sig = _sign(
            carrierKey, _attestationDigest(address(escrow), id, AttestationKind.ReadyInspected, evidence, issuedAt, 0)
        );
        vm.expectRevert(IWasitEscrow.InvalidSignature.selector);
        escrow.submitAttestation(id, SHIPPED, evidence, issuedAt, sig);
    }

    function test_ready_revertsAfterBalanceFunded() public {
        uint256 id = _balanceFunded(_terms());
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.InvalidState.selector, id, DealState.BalanceFunded));
        escrow.submitAttestation(id, AttestationKind.ReadyInspected, bytes32(0), uint64(block.timestamp), "");
    }

    function test_shipped_revertsAfterShipBy() public {
        uint256 id = _balanceFunded(_terms());
        (,, uint256 shipBy,,) = escrow.deadlines(id);
        vm.warp(shipBy + 1);
        bytes32 evidence = _evidence(id, SHIPPED);
        uint64 issuedAt = uint64(block.timestamp);
        bytes memory sig = _sign(carrierKey, _attestationDigest(address(escrow), id, SHIPPED, evidence, issuedAt, 1));
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.DeadlinePassed.selector, shipBy));
        escrow.submitAttestation(id, SHIPPED, evidence, issuedAt, sig);
    }

    function test_shipped_revertsOnIssuedAtBeforeBalance() public {
        uint256 id = _balanceFunded(_terms());
        vm.warp(block.timestamp + 1 days);
        bytes32 evidence = _evidence(id, SHIPPED);
        uint64 issuedAt = escrow.getDeal(id).balanceFundedAt - 1;
        bytes memory sig = _sign(carrierKey, _attestationDigest(address(escrow), id, SHIPPED, evidence, issuedAt, 1));
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.InvalidIssuedAt.selector, issuedAt));
        escrow.submitAttestation(id, SHIPPED, evidence, issuedAt, sig);
    }
}
