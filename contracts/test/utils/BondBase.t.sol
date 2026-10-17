// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AdvanceBond} from "../../src/AdvanceBond.sol";
import {WasitEscrow} from "../../src/WasitEscrow.sol";
import {IWasitEscrow} from "../../src/interfaces/IWasitEscrow.sol";
import {AttestationKind, DealTerms} from "../../src/libraries/WasitTypes.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockOracle} from "../mocks/MockOracle.sol";
import {MockSwap} from "../mocks/MockSwap.sol";
import {Base} from "./Base.t.sol";

/// @notice Real escrow wired to the real bond, with mock BTC, oracle and swap.
abstract contract BondBase is Base {
    uint256 internal constant BTC_PRICE = 80_000e18;
    uint256 internal constant NET_ADVANCE = 2_985e18;
    uint16 internal constant TOP_UP_BPS = 13_000;
    uint16 internal constant PROTECT_BPS = 11_500;
    uint16 internal constant SLIPPAGE_BPS = 600;

    WasitEscrow internal escrow;
    AdvanceBond internal advanceBond;
    MockERC20 internal btc;
    MockOracle internal oracle;
    MockSwap internal swap;

    function setUp() public virtual override {
        super.setUp();
        btc = new MockERC20("BTC", "BTC", 18);
        oracle = new MockOracle(BTC_PRICE);
        swap = new MockSwap(BTC_PRICE);

        // The bond and the escrow point at each other immutably: deploy the bond against the
        // escrow's precomputed address, then the escrow (same pattern as the deploy script).
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        advanceBond = new AdvanceBond(
            owner, btc, musd, IWasitEscrow(predicted), oracle, swap, TOP_UP_BPS, PROTECT_BPS, SLIPPAGE_BPS
        );
        address[] memory tokens = new address[](1);
        tokens[0] = address(musd);
        escrow = new WasitEscrow(owner, advanceBond, feeRecipient, DEFAULT_FEE_BPS, tokens);
        assertEq(address(escrow), predicted, "escrow address prediction");

        btc.mint(agent, 10e18);
        musd.mint(address(swap), 10_000_000e18);
        vm.prank(agent);
        btc.approve(address(advanceBond), type(uint256).max);
        vm.prank(buyer);
        musd.approve(address(escrow), type(uint256).max);
        vm.prank(supplier);
        musd.approve(address(escrow), type(uint256).max);
    }

    function _create(DealTerms memory t) internal returns (uint256 dealId) {
        vm.prank(t.buyer);
        dealId = escrow.createDeal(t);
    }

    /// @dev Created + supplier accepted + arbiter accepted (no bond posted yet).
    function _accepted(DealTerms memory t) internal returns (uint256 dealId) {
        dealId = _create(t);
        vm.prank(t.supplier);
        escrow.accept(dealId);
        vm.prank(t.arbiter);
        escrow.acceptArbiter(dealId);
    }

    function _post(uint256 dealId, uint256 btcAmount) internal {
        vm.prank(agent);
        advanceBond.post(dealId, btcAmount);
    }

    /// @dev Accepted deal with 0.06 BTC posted (4,800 USD for a 2,985 net advance: 160.8%), advance paid.
    function _advancePaid() internal returns (uint256 dealId) {
        dealId = _accepted(_terms());
        _post(dealId, 0.06e18);
        vm.prank(buyer);
        escrow.fundAdvance(dealId);
    }

    function _attest(uint256 dealId, AttestationKind kind, uint256 key) internal {
        bytes32 evidence = keccak256(abi.encode("evidence", dealId, kind));
        uint64 issuedAt = uint64(block.timestamp);
        uint256 nonce = escrow.getDeal(dealId).attestationNonce;
        bytes memory sig = _sign(key, _attestationDigest(address(escrow), dealId, kind, evidence, issuedAt, nonce));
        escrow.submitAttestation(dealId, kind, evidence, issuedAt, sig);
    }
}
