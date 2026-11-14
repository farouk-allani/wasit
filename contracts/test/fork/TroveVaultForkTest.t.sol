// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TroveVault} from "../../src/TroveVault.sol";
import {IBorrowerOperations, ITroveManager} from "../../src/interfaces/IMusdBorrowing.sol";
import {ISkipAggregator} from "../../src/oracles/SkipOracleAdapter.sol";

/// @notice Gate G1 (PLAN 8.3a): a contract opens, tops up and closes a real trove on a Mezo
///         testnet fork. Run: `FOUNDRY_PROFILE=fork MEZO_TESTNET_RPC=... forge test`.
///         Only the Skip precompile's answer is mocked (a fork cannot run it, ADR-015); the
///         BorrowerOperations, TroveManager, pools, SortedTroves and MUSD are the live code.
contract TroveVaultForkTest is Test {
    // VERIFIED-FACTS
    IBorrowerOperations internal constant BO = IBorrowerOperations(0xCdF7028ceAB81fA0C6971208e83fa7872994beE5);
    IERC20 internal constant MUSD = IERC20(0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503);
    address internal constant SKIP_BTC_USD = 0x7b7c000000000000000000000000000000000015;
    uint256 internal constant PRICE = 67_000e18;

    ITroveManager internal tm;
    TroveVault internal vault;

    function setUp() public {
        vm.createSelectFork("mezo_testnet");
        assertEq(block.chainid, 31_611);
        _mockPrice(PRICE);
        tm = BO.troveManager();
        vault = new TroveVault(BO, MUSD); // this test plays the bond
        vm.deal(address(this), 1 ether);
    }

    receive() external payable {}

    /// Keeps the mocked price fresh for the PriceFeed's 60 s rule after any warp.
    function _mockPrice(uint256 price) internal {
        vm.mockCall(
            SKIP_BTC_USD,
            abi.encodeWithSelector(ISkipAggregator.latestRoundData.selector),
            abi.encode(uint80(1), int256(price), block.timestamp, block.timestamp, uint80(0))
        );
        vm.mockCall(SKIP_BTC_USD, abi.encodeWithSignature("decimals()"), abi.encode(uint8(18)));
    }

    function test_gateG1_openTopUpClose() public {
        uint256 debt = BO.minNetDebt(); // 1,800 MUSD drawn; fee and gas comp come on top
        vault.open{value: 0.06 ether}(debt, address(0), address(0));
        assertEq(tm.getTroveStatus(address(vault)), 1, "active");
        assertEq(MUSD.balanceOf(address(vault)), debt, "vault holds exactly the drawn MUSD");
        assertEq(tm.getTroveColl(address(vault)), 0.06 ether);
        uint256 icr = tm.getCurrentICR(address(vault), PRICE);
        assertGt(icr, 1.9e18, "about 200% at 67k");

        vault.addColl{value: 0.01 ether}(address(0), address(0));
        assertEq(tm.getTroveColl(address(vault)), 0.07 ether);

        // A month later: fee plus interest is the shortfall the bonder brings
        vm.warp(block.timestamp + 30 days);
        _mockPrice(PRICE);
        uint256 owed = vault.amountToClose();
        assertGt(owed, debt, "fee and interest on top of the drawn amount");
        assertLt(owed - debt, 5e18, "0.1% fee + 1%/yr for 30 days is under 5 MUSD");
        deal(address(MUSD), address(this), owed - debt);
        MUSD.transfer(address(vault), owed - debt);

        uint256 before = address(this).balance;
        vault.closeTrove();
        assertEq(tm.getTroveStatus(address(vault)), 2, "closedByOwner");
        assertEq(MUSD.balanceOf(address(vault)), 0, "all MUSD burned");
        assertEq(address(vault).balance, 0.07 ether, "all BTC back in the vault");
        (uint256 m, uint256 b) = vault.sweep(address(this));
        assertEq(m, 0);
        assertEq(b, 0.07 ether);
        assertEq(address(this).balance, before + 0.07 ether);
        emit log_named_uint("fee + 30 days interest (MUSD wei)", owed - debt);
    }

    /// A liquidated vault keeps its MUSD: the buyer's cover survives a BTC crash.
    function test_liquidatedVaultKeepsItsMusd() public {
        uint256 debt = BO.minNetDebt();
        vault.open{value: 0.04 ether}(debt, address(0), address(0)); // ~134% at 67k
        _mockPrice(50_000e18); // ~100%: below the 110% line
        tm.liquidate(address(vault));
        assertEq(tm.getTroveStatus(address(vault)), 3, "closedByLiquidation");
        assertEq(MUSD.balanceOf(address(vault)), debt, "the borrowed MUSD stays with the vault");
        assertEq(address(vault).balance, 0, "no BTC comes back");
    }

    function test_onlyTheBondCanCallTheVault() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(TroveVault.NotBond.selector);
        vault.pay(address(0xBAD), 1);
    }
}
