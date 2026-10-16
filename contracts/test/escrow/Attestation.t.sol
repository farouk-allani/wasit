// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IWasitEscrow} from "../../src/interfaces/IWasitEscrow.sol";
import {AttestationKind, Deal, DealState, DealTerms} from "../../src/libraries/WasitTypes.sol";
import {MockERC1271Wallet} from "../mocks/MockERC1271Wallet.sol";
import {EscrowBase} from "../utils/EscrowBase.t.sol";

/// @notice READY_INSPECTED paths. SHIPPED needs a funded balance and is covered in FundBalance.t.sol.
contract AttestationTest is EscrowBase {
    AttestationKind internal constant READY = AttestationKind.ReadyInspected;
    uint256 internal id;
    bytes32 internal evidence;

    function setUp() public override {
        super.setUp();
        id = _advancePaid(_terms());
        evidence = _evidence(id, READY);
        vm.warp(block.timestamp + 1 days);
    }

    function _readySig(uint256 key, uint64 issuedAt) internal view returns (bytes memory) {
        return _sign(key, _attestationDigest(address(escrow), id, READY, evidence, issuedAt, 0));
    }

    function test_digestMatchesIndependentImplementation() public view {
        uint64 issuedAt = uint64(block.timestamp);
        assertEq(
            escrow.attestationDigest(id, READY, evidence, issuedAt, 0),
            _attestationDigest(address(escrow), id, READY, evidence, issuedAt, 0)
        );
    }

    function test_ready_eoaSignatureSubmittedByAnyone() public {
        uint64 issuedAt = uint64(block.timestamp - 1 hours);
        bytes memory sig = _readySig(inspectorKey, issuedAt);

        vm.expectEmit(address(escrow));
        emit IWasitEscrow.Attested(id, READY, inspector, evidence, issuedAt);
        vm.prank(stranger);
        escrow.submitAttestation(id, READY, evidence, issuedAt, sig);

        Deal memory d = escrow.getDeal(id);
        assertEq(uint8(d.state), uint8(DealState.GoodsReady));
        assertEq(d.readyAt, block.timestamp);
        assertEq(d.attestationNonce, 1);
        (, uint256 balanceDue,,,) = escrow.deadlines(id);
        assertEq(balanceDue, block.timestamp + 7 days);
    }

    function test_ready_erc1271Wallet() public {
        MockERC1271Wallet wallet = new MockERC1271Wallet(inspector);
        DealTerms memory t = _terms();
        t.inspector = address(wallet);
        uint256 walletDeal = _advancePaid(t);
        uint64 issuedAt = uint64(block.timestamp);
        bytes memory sig =
            _sign(inspectorKey, _attestationDigest(address(escrow), walletDeal, READY, evidence, issuedAt, 0));

        escrow.submitAttestation(walletDeal, READY, evidence, issuedAt, sig);

        assertEq(uint8(escrow.getDeal(walletDeal).state), uint8(DealState.GoodsReady));
    }

    function test_ready_erc1271WalletRejectsOtherKey() public {
        MockERC1271Wallet wallet = new MockERC1271Wallet(inspector);
        DealTerms memory t = _terms();
        t.inspector = address(wallet);
        uint256 walletDeal = _advancePaid(t);
        uint64 issuedAt = uint64(block.timestamp);
        bytes memory sig =
            _sign(carrierKey, _attestationDigest(address(escrow), walletDeal, READY, evidence, issuedAt, 0));

        vm.expectRevert(IWasitEscrow.InvalidSignature.selector);
        escrow.submitAttestation(walletDeal, READY, evidence, issuedAt, sig);
    }

    function test_ready_revertsOnWrongSigner() public {
        uint64 issuedAt = uint64(block.timestamp);
        bytes memory sig = _readySig(carrierKey, issuedAt); // carrier may not sign READY
        vm.expectRevert(IWasitEscrow.InvalidSignature.selector);
        escrow.submitAttestation(id, READY, evidence, issuedAt, sig);
    }

    function test_ready_revertsOnTamperedEvidence() public {
        uint64 issuedAt = uint64(block.timestamp);
        bytes memory sig = _readySig(inspectorKey, issuedAt);
        vm.expectRevert(IWasitEscrow.InvalidSignature.selector);
        escrow.submitAttestation(id, READY, keccak256("other file"), issuedAt, sig);
    }

    function test_ready_revertsOnReplay() public {
        uint64 issuedAt = uint64(block.timestamp);
        bytes memory sig = _readySig(inspectorKey, issuedAt);
        escrow.submitAttestation(id, READY, evidence, issuedAt, sig);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.InvalidState.selector, id, DealState.GoodsReady));
        escrow.submitAttestation(id, READY, evidence, issuedAt, sig);
    }

    function test_ready_revertsOnOtherDealsSignature() public {
        uint256 other = _advancePaid(_terms());
        uint64 issuedAt = uint64(block.timestamp);
        bytes memory sig = _readySig(inspectorKey, issuedAt); // signed for `id`
        vm.expectRevert(IWasitEscrow.InvalidSignature.selector);
        escrow.submitAttestation(other, READY, evidence, issuedAt, sig);
    }

    function test_ready_revertsOnWrongChain() public {
        uint64 issuedAt = uint64(block.timestamp);
        uint256 chainId = block.chainid;
        vm.chainId(999);
        bytes memory sig = _readySig(inspectorKey, issuedAt);
        vm.chainId(chainId);
        vm.expectRevert(IWasitEscrow.InvalidSignature.selector);
        escrow.submitAttestation(id, READY, evidence, issuedAt, sig);
    }

    function test_ready_revertsOnWrongNonce() public {
        uint64 issuedAt = uint64(block.timestamp);
        bytes memory sig = _sign(inspectorKey, _attestationDigest(address(escrow), id, READY, evidence, issuedAt, 1));
        vm.expectRevert(IWasitEscrow.InvalidSignature.selector);
        escrow.submitAttestation(id, READY, evidence, issuedAt, sig);
    }

    function test_shipped_revertsBeforeBalance() public {
        uint64 issuedAt = uint64(block.timestamp);
        bytes memory sig =
            _sign(carrierKey, _attestationDigest(address(escrow), id, AttestationKind.Shipped, evidence, issuedAt, 0));
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.InvalidState.selector, id, DealState.AdvancePaid));
        escrow.submitAttestation(id, AttestationKind.Shipped, evidence, issuedAt, sig);
    }

    function test_revertsOnKindNone() public {
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.InvalidAttestationKind.selector, AttestationKind.None));
        escrow.submitAttestation(id, AttestationKind.None, evidence, uint64(block.timestamp), "");
    }

    function test_ready_revertsBeforeAdvance() public {
        uint256 accepted = _accepted(_terms());
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.InvalidState.selector, accepted, DealState.Accepted));
        escrow.submitAttestation(accepted, READY, evidence, uint64(block.timestamp), "");
    }

    function test_ready_acceptedExactlyAtDeadline() public {
        (uint256 readyBy,,,,) = escrow.deadlines(id);
        vm.warp(readyBy);
        uint64 issuedAt = uint64(block.timestamp);
        escrow.submitAttestation(id, READY, evidence, issuedAt, _readySig(inspectorKey, issuedAt));
        assertEq(uint8(escrow.getDeal(id).state), uint8(DealState.GoodsReady));
    }

    function test_ready_revertsAfterDeadline() public {
        (uint256 readyBy,,,,) = escrow.deadlines(id);
        vm.warp(readyBy + 1);
        uint64 issuedAt = uint64(block.timestamp);
        bytes memory sig = _readySig(inspectorKey, issuedAt);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.DeadlinePassed.selector, readyBy));
        escrow.submitAttestation(id, READY, evidence, issuedAt, sig);
    }

    function test_ready_revertsOnFutureIssuedAt() public {
        uint64 issuedAt = uint64(block.timestamp + 1);
        bytes memory sig = _readySig(inspectorKey, issuedAt);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.InvalidIssuedAt.selector, issuedAt));
        escrow.submitAttestation(id, READY, evidence, issuedAt, sig);
    }

    function test_ready_revertsOnIssuedAtBeforeAdvance() public {
        uint64 issuedAt = escrow.getDeal(id).advancePaidAt - 1;
        bytes memory sig = _readySig(inspectorKey, issuedAt);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.InvalidIssuedAt.selector, issuedAt));
        escrow.submitAttestation(id, READY, evidence, issuedAt, sig);
    }

    function testFuzz_ready_rejectsAnyOtherKey(uint256 key) public {
        key = bound(key, 1, 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140);
        vm.assume(key != inspectorKey);
        uint64 issuedAt = uint64(block.timestamp);
        bytes memory sig = _readySig(key, issuedAt);
        vm.expectRevert(IWasitEscrow.InvalidSignature.selector);
        escrow.submitAttestation(id, READY, evidence, issuedAt, sig);
    }
}
