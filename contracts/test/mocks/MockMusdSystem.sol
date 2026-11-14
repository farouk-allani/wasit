// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {
    IBorrowerOperations,
    ICollSurplusPool,
    ISortedTroves,
    ITroveManager
} from "../../src/interfaces/IMusdBorrowing.sol";
import {MockERC20} from "./MockERC20.sol";

/// @notice BorrowerOperations + TroveManager + CollSurplusPool + SortedTroves in one, following
///         the verified testnet source (VERIFIED-FACTS): one active trove per address, 0.1% fee
///         added to debt, 200 MUSD gas compensation, 110% to open, close burns `debt - 200` and
///         is refused in recovery mode, liquidation keeps no BTC for the borrower, full
///         redemption leaves claimable surplus. Real behavior is proven by the fork tests.
contract MockMusdSystem is IBorrowerOperations, ITroveManager, ICollSurplusPool, ISortedTroves {
    uint256 public constant MUSD_GAS_COMPENSATION = 200e18;
    uint256 public constant MCR = 1.1e18;

    struct T {
        uint8 status;
        uint256 coll;
        uint256 debt;
    }

    MockERC20 public immutable token;
    uint256 public minNetDebt = 1_800e18;
    uint256 public price = 67_000e18;
    bool public recoveryMode;
    mapping(address => T) public troves;
    mapping(address => uint256) public surplus;

    constructor(MockERC20 token_) {
        token = token_;
    }

    // ── test controls ──
    function setPrice(uint256 p) external {
        price = p;
    }

    function setRecoveryMode(bool r) external {
        recoveryMode = r;
    }

    function setMinNetDebt(uint256 m) external {
        minNetDebt = m;
    }

    function accrue(address b, uint256 interest) external {
        troves[b].debt += interest;
    }

    function redeemPartial(address b, uint256 musdLot) external {
        T storage t = troves[b];
        t.debt -= musdLot;
        t.coll -= (musdLot * 1e18) / price;
    }

    function redeemFull(address b) external {
        T storage t = troves[b];
        uint256 lot = t.debt - MUSD_GAS_COMPENSATION;
        surplus[b] = t.coll - (lot * 1e18) / price;
        t.coll = 0;
        t.debt = 0;
        t.status = 4;
    }

    receive() external payable {}

    // ── BorrowerOperations ──
    function openTrove(uint256 debtAmount, address, address) external payable {
        require(troves[msg.sender].status != 1, "BorrowerOps: Trove is active");
        uint256 net = debtAmount + (recoveryMode ? 0 : debtAmount / 1_000);
        require(net >= minNetDebt, "BorrowerOps: Trove's net debt must be greater than minimum");
        uint256 composite = net + MUSD_GAS_COMPENSATION;
        require((msg.value * price) / composite >= (recoveryMode ? 1.5e18 : MCR), "BorrowerOps: ICR too low");
        troves[msg.sender] = T(1, msg.value, composite);
        token.mint(msg.sender, debtAmount);
    }

    function addColl(address, address) external payable {
        require(troves[msg.sender].status == 1, "BorrowerOps: Trove does not exist or is closed");
        troves[msg.sender].coll += msg.value;
    }

    function closeTrove() external {
        T storage t = troves[msg.sender];
        require(t.status == 1, "BorrowerOps: Trove does not exist or is closed");
        require(!recoveryMode, "BorrowerOps: Operation not permitted during Recovery Mode");
        token.burn(msg.sender, t.debt - MUSD_GAS_COMPENSATION);
        uint256 coll = t.coll;
        t.status = 2;
        t.coll = 0;
        t.debt = 0;
        (bool ok,) = msg.sender.call{value: coll}("");
        require(ok, "send");
    }

    function claimCollateral() external {
        uint256 s = surplus[msg.sender];
        require(s > 0, "CollSurplusPool: No collateral available to claim");
        surplus[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: s}("");
        require(ok, "send");
    }

    function troveManager() external view returns (ITroveManager) {
        return this;
    }

    function collSurplusPool() external view returns (ICollSurplusPool) {
        return this;
    }

    function sortedTroves() external view returns (ISortedTroves) {
        return this;
    }

    function musd() external view returns (address) {
        return address(token);
    }

    // ── TroveManager ──
    function getTroveStatus(address b) external view returns (uint8) {
        return troves[b].status;
    }

    function getTroveDebt(address b) external view returns (uint256) {
        return troves[b].debt;
    }

    function getTroveColl(address b) external view returns (uint256) {
        return troves[b].coll;
    }

    function getCurrentICR(address b, uint256 p) external view returns (uint256) {
        T storage t = troves[b];
        return t.debt == 0 ? type(uint256).max : (t.coll * p) / t.debt;
    }

    function checkRecoveryMode(uint256) external view returns (bool) {
        return recoveryMode;
    }

    function updateSystemAndTroveInterest(address) external {}

    function liquidate(address b) external {
        T storage t = troves[b];
        require(t.status == 1 && (t.coll * price) / t.debt < MCR, "TroveManager: nothing to liquidate");
        t.status = 3;
        t.coll = 0;
        t.debt = 0;
    }

    // ── CollSurplusPool / SortedTroves ──
    function getCollateral(address a) external view returns (uint256) {
        return surplus[a];
    }

    function findInsertPosition(uint256, address, address) external pure returns (address, address) {
        return (address(0), address(0));
    }
}
