// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAdvanceBond} from "../../src/interfaces/IAdvanceBond.sol";
import {ISwapAdapter} from "../../src/interfaces/ISwapAdapter.sol";
import {AttestationKind, Bond, BondStatus} from "../../src/libraries/WasitTypes.sol";
import {MockOracle} from "../mocks/MockOracle.sol";
import {MockSwap} from "../mocks/MockSwap.sol";
import {BondBase} from "../utils/BondBase.t.sol";

/// @notice Adapter that reports the minimum but delivers one wei less.
contract ShortChangingSwap is ISwapAdapter {
    function swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address recipient)
        external
        returns (uint256)
    {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).transfer(recipient, minOut - 1);
        return minOut;
    }
}

contract BondProtectTest is BondBase {
    uint256 internal id;

    function setUp() public override {
        super.setUp();
        id = _advancePaid(); // 0.06 BTC at 80,000 for a 2,985 net advance: 160.8%
        swap.setSlippage(100); // the pool gives 1% less than the oracle
    }

    function _drop(uint256 price) internal {
        oracle.setPrice(price);
        swap.setPrice(price);
    }

    /// @dev Independent version of the sizing rule: enough BTC to raise the covered amount at the
    ///      bond's worst slippage (6%), capped at what the bond holds.
    function _expectedSold(uint256 price, uint256 held) internal pure returns (uint256 sold) {
        sold = (NET_ADVANCE * 1e18 * 10_000 + price * 9_400 - 1) / (price * 9_400);
        if (sold > held) sold = held;
    }

    function test_protect_revertsAboveProtectRatio() public {
        _drop(60_000e18); // 3,600 / 2,985 = 120.6%: top-up warning zone, not protectable
        vm.expectRevert(abi.encodeWithSelector(IAdvanceBond.CoverageAboveProtectRatio.selector, 12_060, 11_500));
        advanceBond.protect(id);
    }

    function test_protect_below115ConvertsEnoughToCoverAdvance() public {
        _drop(54_700e18); // 3,282 / 2,985 = 109.9%
        uint256 sold = _expectedSold(54_700e18, 0.06e18);
        uint256 out = sold * 54_700e18 / 1e18 * 9_900 / 10_000;

        vm.expectEmit(address(advanceBond));
        emit IAdvanceBond.BondProtected(id, sold, out, 10_994);
        vm.prank(keeper);
        advanceBond.protect(id);

        Bond memory b = advanceBond.bondOf(id);
        assertEq(uint8(b.status), uint8(BondStatus.Protected));
        assertEq(b.musdHeld, out);
        assertGe(b.musdHeld, NET_ADVANCE, "advance fully covered in MUSD");
        assertEq(b.btcHeld, 0.06e18 - sold, "leftover BTC stays in the bond");
        assertEq(musd.balanceOf(address(advanceBond)), out);
        assertEq(btc.allowance(address(advanceBond), address(swap)), 0, "no allowance left behind");
    }

    function test_protect_dropPath150to120to110() public {
        assertEq(advanceBond.coverageBps(id), 16_080);
        _drop(60_000e18);
        assertEq(advanceBond.coverageBps(id), 12_060); // UI shows top-up warning (< 130%)
        vm.expectRevert(abi.encodeWithSelector(IAdvanceBond.CoverageAboveProtectRatio.selector, 12_060, 11_500));
        advanceBond.protect(id);
        _drop(54_700e18);
        advanceBond.protect(id);
        assertGe(advanceBond.coverageBps(id), 10_000);
    }

    function test_protect_crashSellsEverythingAndReportsCoverage() public {
        _drop(30_000e18); // 1,800 / 2,985 = 60%: not enough BTC to cover the advance
        advanceBond.protect(id);

        Bond memory b = advanceBond.bondOf(id);
        assertEq(b.btcHeld, 0);
        assertEq(b.musdHeld, 1_782e18); // 0.06 × 30,000 × 99%
        assertEq(advanceBond.coverageBps(id), 5_969);
    }

    function test_protect_rejectsSlippageAboveTolerance() public {
        _drop(54_700e18);
        swap.setSlippage(700); // pool 7% under the oracle; the bond tolerates 6%
        vm.expectRevert();
        advanceBond.protect(id);
        assertEq(uint8(advanceBond.bondOf(id).status), uint8(BondStatus.Active), "nothing changed");
        assertEq(advanceBond.bondOf(id).btcHeld, 0.06e18);
    }

    function test_protect_rejectsShortChangingAdapter() public {
        ShortChangingSwap liar = new ShortChangingSwap();
        vm.prank(owner);
        advanceBond.setSwapAdapter(liar);
        uint256 other = _accepted(_terms());
        _post(other, 0.06e18);
        vm.prank(buyer);
        escrow.fundAdvance(other);
        musd.mint(address(advanceBond.bondOf(other).swap), 10_000e18);
        _drop(54_700e18);

        uint256 sold = _expectedSold(54_700e18, 0.06e18);
        uint256 minOut = sold * 54_700e18 / 1e18 * 9_400 / 10_000;
        vm.expectRevert(abi.encodeWithSelector(IAdvanceBond.SwapOutputTooLow.selector, minOut - 1, minOut));
        advanceBond.protect(other);
    }

    function test_protect_revertsOnStaleOracle() public {
        _drop(54_700e18);
        oracle.setStale(true);
        vm.expectRevert(MockOracle.StalePrice.selector);
        advanceBond.protect(id);
    }

    function test_protect_revertsWhenSwapFails() public {
        _drop(54_700e18);
        swap.setFail(true);
        vm.expectRevert(MockSwap.MockSwapFailure.selector);
        advanceBond.protect(id);
    }

    function test_protect_onlyOnce() public {
        _drop(54_700e18);
        advanceBond.protect(id);
        vm.expectRevert(abi.encodeWithSelector(IAdvanceBond.NoActiveBond.selector, id));
        advanceBond.protect(id);
    }

    function test_protect_revertsBeforeAdvance() public {
        uint256 open = _accepted(_terms());
        _post(open, 0.06e18);
        _drop(30_000e18);
        vm.expectRevert(abi.encodeWithSelector(IAdvanceBond.DealNotOpenForBond.selector, open));
        advanceBond.protect(open);
    }

    function test_protect_thenReleaseReturnsMusdAndBtcToBonder() public {
        _drop(54_700e18);
        advanceBond.protect(id);
        Bond memory b = advanceBond.bondOf(id);
        uint256 btcBefore = btc.balanceOf(agent);
        uint256 musdBefore = musd.balanceOf(agent);

        _attest(id, AttestationKind.ReadyInspected, inspectorKey);
        vm.prank(buyer);
        escrow.fundBalance(id);
        _attest(id, AttestationKind.Shipped, carrierKey);
        vm.prank(buyer);
        escrow.acceptGoods(id);

        assertEq(btc.balanceOf(agent), btcBefore + b.btcHeld);
        assertEq(musd.balanceOf(agent), musdBefore + b.musdHeld);
        assertEq(uint8(advanceBond.bondOf(id).status), uint8(BondStatus.Released));
    }

    function test_topUp_afterProtection() public {
        _drop(54_700e18);
        advanceBond.protect(id);
        vm.prank(agent);
        advanceBond.topUp(id, 0.01e18);
        assertEq(uint8(advanceBond.bondOf(id).status), uint8(BondStatus.Protected));
    }

    function testFuzz_protect_neverSellsBelowOracleMinusTolerance(uint64 priceUsd, uint16 poolSlippage) public {
        uint256 price = bound(priceUsd, 1_000, 57_000) * 1e18; // always below 115% coverage
        poolSlippage = uint16(bound(poolSlippage, 0, 1_500));
        _drop(price);
        swap.setSlippage(poolSlippage);

        try advanceBond.protect(id) {
            Bond memory b = advanceBond.bondOf(id);
            uint256 sold = 0.06e18 - b.btcHeld;
            assertGe(b.musdHeld * 10_000, sold * price / 1e18 * 9_400, "received >= oracle value - 6%");
            assertLe(poolSlippage, 600, "only succeeds within tolerance");
        } catch {
            assertGt(poolSlippage, 600, "only fails beyond tolerance");
        }
    }
}
