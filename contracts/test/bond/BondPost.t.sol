// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AdvanceBond} from "../../src/AdvanceBond.sol";
import {IAdvanceBond} from "../../src/interfaces/IAdvanceBond.sol";
import {IPriceOracle} from "../../src/interfaces/IPriceOracle.sol";
import {ISwapAdapter} from "../../src/interfaces/ISwapAdapter.sol";
import {IWasitEscrow} from "../../src/interfaces/IWasitEscrow.sol";
import {Bond, BondStatus, DealTerms} from "../../src/libraries/WasitTypes.sol";
import {MockOracle} from "../mocks/MockOracle.sol";
import {MockSwap} from "../mocks/MockSwap.sol";
import {BondBase} from "../utils/BondBase.t.sol";

contract BondPostTest is BondBase {
    // ── constructor and config ──

    function test_constructor_setsConfig() public view {
        assertEq(address(advanceBond.btc()), address(btc));
        assertEq(address(advanceBond.musd()), address(musd));
        assertEq(address(advanceBond.escrow()), address(escrow));
        assertEq(address(advanceBond.oracle()), address(oracle));
        assertEq(address(advanceBond.swapAdapter()), address(swap));
        assertEq(advanceBond.topUpRatioBps(), TOP_UP_BPS);
        assertEq(advanceBond.protectRatioBps(), PROTECT_BPS);
        assertEq(advanceBond.maxSlippageBps(), SLIPPAGE_BPS);
        assertEq(advanceBond.owner(), owner);
    }

    function test_constructor_revertsOnZeroAddresses() public {
        IWasitEscrow e = IWasitEscrow(address(escrow));
        vm.expectRevert(IAdvanceBond.InvalidConfig.selector);
        new AdvanceBond(owner, btc, musd, IWasitEscrow(address(0)), oracle, swap, 13_000, 11_500, 600);
        vm.expectRevert(IAdvanceBond.InvalidConfig.selector);
        new AdvanceBond(owner, btc, musd, e, IPriceOracle(address(0)), swap, 13_000, 11_500, 600);
        vm.expectRevert(IAdvanceBond.InvalidConfig.selector);
        new AdvanceBond(owner, btc, musd, e, oracle, ISwapAdapter(address(0)), 13_000, 11_500, 600);
    }

    function test_setRatios_bounds() public {
        vm.startPrank(owner);
        vm.expectRevert(IAdvanceBond.InvalidConfig.selector);
        advanceBond.setRatios(13_000, 10_000); // protect must exceed 100%
        vm.expectRevert(IAdvanceBond.InvalidConfig.selector);
        advanceBond.setRatios(11_000, 11_000); // protect below top-up
        vm.expectRevert(IAdvanceBond.InvalidConfig.selector);
        advanceBond.setRatios(15_000, 12_000); // protect below the lowest deal ratio
        vm.expectRevert(IAdvanceBond.InvalidConfig.selector);
        advanceBond.setRatios(50_001, 11_500);
        vm.expectEmit(address(advanceBond));
        emit IAdvanceBond.RatiosSet(14_000, 11_000);
        advanceBond.setRatios(14_000, 11_000);
    }

    function test_setMaxSlippage_cappedAt10Percent() public {
        vm.startPrank(owner);
        vm.expectRevert(IAdvanceBond.InvalidConfig.selector);
        advanceBond.setMaxSlippage(1_001);
        advanceBond.setMaxSlippage(1_000);
        assertEq(advanceBond.maxSlippageBps(), 1_000);
    }

    function test_config_onlyOwner() public {
        bytes memory err = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger);
        vm.startPrank(stranger);
        vm.expectRevert(err);
        advanceBond.setOracle(oracle);
        vm.expectRevert(err);
        advanceBond.setSwapAdapter(swap);
        vm.expectRevert(err);
        advanceBond.setRatios(13_000, 11_500);
        vm.expectRevert(err);
        advanceBond.setMaxSlippage(500);
    }

    // ── post ──

    function test_post_byBonderSnapshotsConfig() public {
        uint256 id = _create(_terms());
        vm.expectEmit(address(advanceBond));
        emit IAdvanceBond.BondPosted(id, agent, 0.06e18, 16_080); // 4,800 / 2,985
        _post(id, 0.06e18);

        Bond memory b = advanceBond.bondOf(id);
        assertEq(b.bonder, agent);
        assertEq(address(b.oracle), address(oracle));
        assertEq(address(b.swap), address(swap));
        assertEq(b.covered, NET_ADVANCE);
        assertEq(b.btcHeld, 0.06e18);
        assertEq(b.musdHeld, 0);
        assertEq(b.initialRatioBps, 15_000);
        assertEq(b.topUpRatioBps, TOP_UP_BPS);
        assertEq(b.protectRatioBps, PROTECT_BPS);
        assertEq(b.maxSlippageBps, SLIPPAGE_BPS);
        assertEq(uint8(b.status), uint8(BondStatus.Active));
        assertEq(btc.balanceOf(address(advanceBond)), 0.06e18);
        assertEq(advanceBond.coverageBps(id), 16_080);
    }

    function test_post_inAcceptedState() public {
        uint256 id = _accepted(_terms());
        _post(id, 0.06e18);
        assertEq(uint8(advanceBond.bondOf(id).status), uint8(BondStatus.Active));
    }

    function test_post_laterConfigChangesDoNotTouchTheBond() public {
        uint256 id = _create(_terms());
        _post(id, 0.06e18);
        MockOracle otherOracle = new MockOracle(1e18);
        vm.startPrank(owner);
        advanceBond.setOracle(otherOracle);
        advanceBond.setSwapAdapter(new MockSwap(1e18));
        advanceBond.setRatios(14_000, 11_000);
        advanceBond.setMaxSlippage(100);
        vm.stopPrank();

        Bond memory b = advanceBond.bondOf(id);
        assertEq(address(b.oracle), address(oracle));
        assertEq(address(b.swap), address(swap));
        assertEq(b.protectRatioBps, PROTECT_BPS);
        assertEq(b.maxSlippageBps, SLIPPAGE_BPS);
        assertEq(advanceBond.coverageBps(id), 16_080, "still priced by the bond's own oracle");
    }

    function test_post_revertsIfNotBonder() public {
        uint256 id = _create(_terms());
        btc.mint(supplier, 1e18);
        vm.prank(supplier);
        vm.expectRevert(IAdvanceBond.NotBonder.selector);
        advanceBond.post(id, 0.06e18);
    }

    function test_post_revertsWithoutBonderInTerms() public {
        uint256 id = _create(_termsWithoutBond());
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(IAdvanceBond.DealNotOpenForBond.selector, id));
        advanceBond.post(id, 0.06e18);
    }

    function test_post_revertsAfterAdvance() public {
        uint256 id = _advancePaid();
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(IAdvanceBond.DealNotOpenForBond.selector, id));
        advanceBond.post(id, 0.06e18);
    }

    function test_post_revertsWhenBondExists() public {
        uint256 id = _create(_terms());
        _post(id, 0.06e18);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(IAdvanceBond.BondExists.selector, id));
        advanceBond.post(id, 0.06e18);
    }

    function test_post_revertsOnZeroAmount() public {
        uint256 id = _create(_terms());
        vm.prank(agent);
        vm.expectRevert(IAdvanceBond.ZeroAmount.selector);
        advanceBond.post(id, 0);
    }

    function test_post_revertsBelowDealRatio() public {
        uint256 id = _create(_terms());
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(IAdvanceBond.InsufficientCoverage.selector, 13_400, 15_000));
        advanceBond.post(id, 0.05e18); // 4,000 / 2,985 = 134%
    }

    function test_post_revertsOnStaleOracle() public {
        uint256 id = _create(_terms());
        oracle.setStale(true);
        vm.prank(agent);
        vm.expectRevert(MockOracle.StalePrice.selector);
        advanceBond.post(id, 0.06e18);
    }

    function test_post_revertsOnZeroPrice() public {
        uint256 id = _create(_terms());
        oracle.setPrice(0);
        vm.prank(agent);
        vm.expectRevert(IAdvanceBond.InvalidPrice.selector);
        advanceBond.post(id, 1e18);
    }

    // ── coverage ──

    function test_coverage_followsPrice() public {
        uint256 id = _create(_terms());
        _post(id, 0.06e18);
        oracle.setPrice(60_000e18);
        assertEq(advanceBond.coverageBps(id), 12_060); // 3,600 / 2,985
        oracle.setStale(true);
        vm.expectRevert(MockOracle.StalePrice.selector);
        advanceBond.coverageBps(id);
    }

    function test_coverage_zeroWithoutBond() public view {
        assertEq(advanceBond.coverageBps(123), 0);
    }

    function testFuzz_coverage_matchesFormula(uint96 btcAmount, uint64 priceUsd, uint128 advance) public {
        btcAmount = uint96(bound(btcAmount, 1e10, 100e18));
        uint256 price = bound(priceUsd, 1_000, 1_000_000) * 1e18;
        advance = uint128(bound(advance, 1e18, 1_000_000e18));
        oracle.setPrice(price);
        DealTerms memory t = _terms();
        t.advanceAmount = advance;
        t.bondRatioBps = 12_000;
        uint256 id = _create(t);
        (, uint256 covered,,) = escrow.bondTerms(id);
        uint256 expected = uint256(btcAmount) * price / 1e18 * 10_000 / covered;
        btc.mint(agent, btcAmount);

        vm.prank(agent);
        if (expected < 12_000) {
            vm.expectRevert(abi.encodeWithSelector(IAdvanceBond.InsufficientCoverage.selector, expected, 12_000));
            advanceBond.post(id, btcAmount);
        } else {
            advanceBond.post(id, btcAmount);
            assertEq(advanceBond.coverageBps(id), expected);
        }
    }
}
