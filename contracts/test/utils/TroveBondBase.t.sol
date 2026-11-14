// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TroveBond} from "../../src/TroveBond.sol";
import {WasitEscrow} from "../../src/WasitEscrow.sol";
import {IAdvanceBond} from "../../src/interfaces/IAdvanceBond.sol";
import {IWasitEscrow} from "../../src/interfaces/IWasitEscrow.sol";
import {AttestationKind, DealTerms} from "../../src/libraries/WasitTypes.sol";
import {MockMusdSystem} from "../mocks/MockMusdSystem.sol";
import {MockOracle} from "../mocks/MockOracle.sol";
import {Base} from "./Base.t.sol";

/// @notice Real, unchanged escrow wired to `TroveBond` over a mock MUSD borrowing system.
abstract contract TroveBondBase is Base {
    uint256 internal constant PRICE = 67_000e18;
    /// @dev Trade-size deal used by 8.3d: 3,000 order, 900 up front, net advance 895.5, 120%.
    uint128 internal constant T_ADVANCE = 900e18;
    uint128 internal constant T_BALANCE = 2_100e18;
    uint256 internal constant T_COVERED = 895.5e18;
    uint16 internal constant T_RATIO = 12_000;

    WasitEscrow internal escrow;
    TroveBond internal troveBond;
    MockMusdSystem internal sys;
    MockOracle internal oracle;

    function setUp() public virtual override {
        super.setUp();
        sys = new MockMusdSystem(musd);
        oracle = new MockOracle(PRICE);
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        troveBond = new TroveBond(IWasitEscrow(predicted), sys, oracle);
        address[] memory tokens = new address[](1);
        tokens[0] = address(musd);
        escrow = new WasitEscrow(owner, IAdvanceBond(address(troveBond)), feeRecipient, DEFAULT_FEE_BPS, tokens);
        assertEq(address(escrow), predicted, "escrow address prediction");

        vm.deal(agent, 100 ether);
        vm.deal(stranger, 10 ether);
        vm.deal(address(sys), 0); // the mock holds trove BTC itself
        musd.mint(agent, 100_000e18);
        vm.prank(agent);
        musd.approve(address(troveBond), type(uint256).max);
        vm.prank(buyer);
        musd.approve(address(escrow), type(uint256).max);
    }

    /// @dev 900 / 2,100 at 120%: the bond borrows the 1,800 floor.
    function _tradeTerms() internal view returns (DealTerms memory t) {
        t = _terms();
        t.advanceAmount = T_ADVANCE;
        t.balanceAmount = T_BALANCE;
        t.bondRatioBps = T_RATIO;
    }

    function _accepted(DealTerms memory t) internal returns (uint256 id) {
        vm.prank(t.buyer);
        id = escrow.createDeal(t);
        vm.prank(t.supplier);
        escrow.accept(id);
        vm.prank(t.arbiter);
        escrow.acceptArbiter(id);
    }

    function _post(uint256 id, uint256 btc) internal {
        vm.prank(agent);
        troveBond.post{value: btc}(id, address(0), address(0));
    }

    /// @dev Trade deal, 0.06 BTC (≈ 200% at 67k) posted, advance paid.
    function _advancePaid() internal returns (uint256 id) {
        id = _accepted(_tradeTerms());
        _post(id, 0.06 ether);
        vm.prank(buyer);
        escrow.fundAdvance(id);
    }

    function _attest(uint256 id, AttestationKind kind, uint256 key) internal {
        bytes32 evidence = keccak256(abi.encode("evidence", id, kind));
        uint64 issuedAt = uint64(block.timestamp);
        uint256 nonce = escrow.getDeal(id).attestationNonce;
        bytes memory sig = _sign(key, _attestationDigest(address(escrow), id, kind, evidence, issuedAt, nonce));
        escrow.submitAttestation(id, kind, evidence, issuedAt, sig);
    }
}
