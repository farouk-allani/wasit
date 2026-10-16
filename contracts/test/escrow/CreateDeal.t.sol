// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {WasitEscrow} from "../../src/WasitEscrow.sol";
import {IAdvanceBond} from "../../src/interfaces/IAdvanceBond.sol";
import {IWasitEscrow} from "../../src/interfaces/IWasitEscrow.sol";
import {Deal, DealState, DealTerms, WasitTypes} from "../../src/libraries/WasitTypes.sol";
import {EscrowBase} from "../utils/EscrowBase.t.sol";

contract CreateDealTest is EscrowBase {
    // ── constructor ──

    function test_constructor_setsConfig() public view {
        assertEq(escrow.owner(), owner);
        assertEq(escrow.bond(), address(bond));
        assertEq(escrow.feeRecipient(), feeRecipient);
        assertEq(escrow.defaultFeeBps(), DEFAULT_FEE_BPS);
        assertTrue(escrow.isTokenAllowed(address(musd)));
        assertEq(escrow.nextDealId(), 1);
    }

    function test_constructor_revertsOnBadConfig() public {
        address[] memory tokens = new address[](1);
        tokens[0] = address(musd);
        IAdvanceBond b = IAdvanceBond(address(bond));

        vm.expectRevert(IWasitEscrow.ZeroAddress.selector);
        new WasitEscrow(owner, IAdvanceBond(address(0)), feeRecipient, DEFAULT_FEE_BPS, tokens);
        vm.expectRevert(IWasitEscrow.ZeroAddress.selector);
        new WasitEscrow(owner, b, address(0), DEFAULT_FEE_BPS, tokens);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.FeeTooHigh.selector, 101));
        new WasitEscrow(owner, b, feeRecipient, 101, tokens);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new WasitEscrow(address(0), b, feeRecipient, DEFAULT_FEE_BPS, tokens);

        tokens[0] = address(0);
        vm.expectRevert(IWasitEscrow.ZeroAddress.selector);
        new WasitEscrow(owner, b, feeRecipient, DEFAULT_FEE_BPS, tokens);
    }

    // ── happy path ──

    function test_createDeal_storesTermsAndEmits() public {
        DealTerms memory t = _terms();
        vm.expectEmit(address(escrow));
        emit IWasitEscrow.DealCreated(1, buyer, supplier, address(musd), ADVANCE, BALANCE, t.termsHash);

        uint256 id = _create(t);

        assertEq(id, 1);
        assertEq(escrow.nextDealId(), 2);
        Deal memory d = escrow.getDeal(id);
        assertEq(uint8(d.state), uint8(DealState.Created));
        assertEq(abi.encode(d.terms), abi.encode(t));
        assertFalse(d.arbiterAccepted);
        assertEq(d.balanceHeld, 0);
    }

    function test_createDeal_idsIncrement() public {
        assertEq(_create(_terms()), 1);
        assertEq(_create(_termsWithoutBond()), 2);
    }

    function test_bondTerms_coverNetAdvance() public {
        uint256 id = _create(_terms());
        (address bonder, uint256 covered, uint16 ratio, DealState state) = escrow.bondTerms(id);
        assertEq(bonder, agent);
        assertEq(covered, ADVANCE - _advanceFee());
        assertEq(covered, 2_985e18);
        assertEq(ratio, 15_000);
        assertEq(uint8(state), uint8(DealState.Created));
    }

    function test_deadlines_zeroBeforeAdvance() public {
        uint256 id = _create(_terms());
        (uint256 a, uint256 b, uint256 c, uint256 d, uint256 e) = escrow.deadlines(id);
        assertEq(a + b + c + d + e, 0);
    }

    function test_createDeal_acceptsBoundaryValues() public {
        DealTerms memory t = _terms();
        t.productionPeriod = WasitTypes.MIN_PERIOD;
        t.challengeWindow = WasitTypes.MAX_PERIOD;
        t.bondRatioBps = WasitTypes.MIN_BOND_RATIO_BPS;
        _create(t);
        t.bondRatioBps = WasitTypes.MAX_BOND_RATIO_BPS;
        _create(t);
    }

    function testFuzz_createDeal_feeSplitAddsUp(uint128 advance, uint128 balance) public {
        advance = uint128(bound(advance, 1, type(uint128).max));
        balance = uint128(bound(balance, 1, type(uint128).max));
        DealTerms memory t = _terms();
        t.advanceAmount = advance;
        t.balanceAmount = balance;
        uint256 id = _create(t);

        (, uint256 covered,,) = escrow.bondTerms(id);
        uint256 fee = uint256(advance) * DEFAULT_FEE_BPS / 10_000;
        assertEq(covered + fee, advance);
        assertLe(fee * 10_000, uint256(advance) * DEFAULT_FEE_BPS);
    }

    // ── reverts ──

    function test_createDeal_revertsIfCallerNotBuyer() public {
        DealTerms memory t = _terms();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IWasitEscrow.Unauthorized.selector, stranger));
        escrow.createDeal(t);
    }

    function test_createDeal_revertsOnZeroParty() public {
        DealTerms memory t = _terms();
        t.supplier = address(0);
        _expectCreateRevert(t, abi.encodeWithSelector(IWasitEscrow.ZeroAddress.selector));
        t = _terms();
        t.inspector = address(0);
        _expectCreateRevert(t, abi.encodeWithSelector(IWasitEscrow.ZeroAddress.selector));
        t = _terms();
        t.carrier = address(0);
        _expectCreateRevert(t, abi.encodeWithSelector(IWasitEscrow.ZeroAddress.selector));
        t = _terms();
        t.arbiter = address(0);
        _expectCreateRevert(t, abi.encodeWithSelector(IWasitEscrow.ZeroAddress.selector));
    }

    function test_createDeal_revertsOnConflictingParties() public {
        DealTerms memory t = _terms();
        t.supplier = buyer;
        _expectCreateRevert(t, abi.encodeWithSelector(IWasitEscrow.ConflictingParties.selector));
        t = _terms();
        t.arbiter = buyer;
        _expectCreateRevert(t, abi.encodeWithSelector(IWasitEscrow.ConflictingParties.selector));
        t = _terms();
        t.arbiter = supplier;
        _expectCreateRevert(t, abi.encodeWithSelector(IWasitEscrow.ConflictingParties.selector));
    }

    function test_createDeal_allowsAttestorsAndBonderToOverlap() public {
        DealTerms memory t = _terms();
        t.carrier = inspector;
        t.bonder = supplier;
        _create(t);
    }

    function test_createDeal_revertsOnTokenNotAllowed() public {
        DealTerms memory t = _terms();
        t.token = stranger;
        _expectCreateRevert(t, abi.encodeWithSelector(IWasitEscrow.TokenNotAllowed.selector, stranger));
    }

    function test_createDeal_revertsOnZeroAmounts() public {
        DealTerms memory t = _terms();
        t.advanceAmount = 0;
        _expectCreateRevert(t, abi.encodeWithSelector(IWasitEscrow.ZeroAmount.selector));
        t = _terms();
        t.balanceAmount = 0;
        _expectCreateRevert(t, abi.encodeWithSelector(IWasitEscrow.ZeroAmount.selector));
    }

    function test_createDeal_revertsOnFeeMismatch() public {
        DealTerms memory t = _terms();
        t.feeBps = 0;
        _expectCreateRevert(t, abi.encodeWithSelector(IWasitEscrow.FeeMismatch.selector, DEFAULT_FEE_BPS, uint16(0)));
    }

    function test_createDeal_revertsOnMissingTermsHash() public {
        DealTerms memory t = _terms();
        t.termsHash = bytes32(0);
        _expectCreateRevert(t, abi.encodeWithSelector(IWasitEscrow.MissingTermsHash.selector));
    }

    function test_createDeal_revertsOnEachPeriodOutOfBounds() public {
        bytes memory err = abi.encodeWithSelector(IWasitEscrow.InvalidPeriod.selector);
        uint32[2] memory bad = [WasitTypes.MIN_PERIOD - 1, WasitTypes.MAX_PERIOD + 1];
        for (uint256 i; i < 2; ++i) {
            DealTerms memory t = _terms();
            t.productionPeriod = bad[i];
            _expectCreateRevert(t, err);
            t = _terms();
            t.balanceWindow = bad[i];
            _expectCreateRevert(t, err);
            t = _terms();
            t.shippingPeriod = bad[i];
            _expectCreateRevert(t, err);
            t = _terms();
            t.challengeWindow = bad[i];
            _expectCreateRevert(t, err);
            t = _terms();
            t.arbitrationPeriod = bad[i];
            _expectCreateRevert(t, err);
        }
    }

    function test_createDeal_revertsOnBondRatioWithoutBonder() public {
        DealTerms memory t = _termsWithoutBond();
        t.bondRatioBps = 15_000;
        _expectCreateRevert(t, abi.encodeWithSelector(IWasitEscrow.InvalidBondRatio.selector, uint16(15_000)));
    }

    function test_createDeal_revertsOnBondRatioOutOfBounds() public {
        DealTerms memory t = _terms();
        t.bondRatioBps = WasitTypes.MIN_BOND_RATIO_BPS - 1;
        _expectCreateRevert(t, abi.encodeWithSelector(IWasitEscrow.InvalidBondRatio.selector, t.bondRatioBps));
        t.bondRatioBps = WasitTypes.MAX_BOND_RATIO_BPS + 1;
        _expectCreateRevert(t, abi.encodeWithSelector(IWasitEscrow.InvalidBondRatio.selector, t.bondRatioBps));
    }

    function _expectCreateRevert(DealTerms memory t, bytes memory err) internal {
        vm.prank(t.buyer);
        vm.expectRevert(err);
        escrow.createDeal(t);
    }
}
