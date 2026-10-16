// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AttestationKind, DealTerms} from "../../src/libraries/WasitTypes.sol";
import {MockAdvanceBond} from "../mocks/MockAdvanceBond.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// @notice Shared actors, mocks and helpers. Signing helpers recompute EIP-712 digests here, so
///         tests check the contracts against an independent implementation.
abstract contract Base is Test {
    uint16 internal constant DEFAULT_FEE_BPS = 50;
    uint128 internal constant ADVANCE = 3_000e18;
    uint128 internal constant BALANCE = 7_000e18;

    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant ATTESTATION_TYPEHASH =
        keccak256("Attestation(uint256 dealId,uint8 kind,bytes32 evidenceHash,uint64 issuedAt,uint256 nonce)");
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    address internal owner = makeAddr("owner");
    address internal feeRecipient = makeAddr("feeRecipient");
    address internal agent = makeAddr("agent");
    address internal arbiter = makeAddr("arbiter");
    address internal keeper = makeAddr("keeper");
    address internal stranger = makeAddr("stranger");
    address internal buyer;
    uint256 internal buyerKey;
    address internal supplier;
    uint256 internal supplierKey;
    address internal inspector;
    uint256 internal inspectorKey;
    address internal carrier;
    uint256 internal carrierKey;

    MockERC20 internal musd;
    MockAdvanceBond internal bond;

    function setUp() public virtual {
        (buyer, buyerKey) = makeAddrAndKey("buyer");
        (supplier, supplierKey) = makeAddrAndKey("supplier");
        (inspector, inspectorKey) = makeAddrAndKey("inspector");
        (carrier, carrierKey) = makeAddrAndKey("carrier");

        musd = new MockERC20("Mezo USD", "MUSD", 18);
        bond = new MockAdvanceBond(musd);
        musd.mint(buyer, 1_000_000e18);
        musd.mint(supplier, 100_000e18);
        musd.mint(address(bond), 1_000_000e18);
    }

    /// @dev 3,000 advance / 7,000 balance, bonded by the agent at 150%.
    function _terms() internal view returns (DealTerms memory t) {
        t = DealTerms({
            buyer: buyer,
            supplier: supplier,
            inspector: inspector,
            carrier: carrier,
            arbiter: arbiter,
            bonder: agent,
            token: address(musd),
            advanceAmount: ADVANCE,
            balanceAmount: BALANCE,
            feeBps: DEFAULT_FEE_BPS,
            bondRatioBps: 15_000,
            productionPeriod: 30 days,
            balanceWindow: 7 days,
            shippingPeriod: 14 days,
            challengeWindow: 3 days,
            arbitrationPeriod: 14 days,
            termsHash: keccak256("terms-v1")
        });
    }

    function _termsWithoutBond() internal view returns (DealTerms memory t) {
        t = _terms();
        t.bonder = address(0);
        t.bondRatioBps = 0;
    }

    function _attestationDigest(
        address escrow,
        uint256 dealId,
        AttestationKind kind,
        bytes32 evidenceHash,
        uint64 issuedAt,
        uint256 nonce
    ) internal view returns (bytes32) {
        bytes32 domainSeparator =
            keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("Wasit"), keccak256("1"), block.chainid, escrow));
        bytes32 structHash =
            keccak256(abi.encode(ATTESTATION_TYPEHASH, dealId, uint8(kind), evidenceHash, issuedAt, nonce));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _permitSignature(uint256 ownerKey, address spender, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        address holder = vm.addr(ownerKey);
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, holder, spender, value, musd.nonces(holder), deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", musd.DOMAIN_SEPARATOR(), structHash));
        return vm.sign(ownerKey, digest);
    }
}
