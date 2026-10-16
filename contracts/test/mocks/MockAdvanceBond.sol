// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAdvanceBond} from "../../src/interfaces/IAdvanceBond.sol";
import {Bond, BondStatus} from "../../src/libraries/WasitTypes.sol";

/// @notice Stand-in for AdvanceBond in escrow tests. Status and coverage are set by the test;
///         claims pay MUSD from the mock's own balance; claim/release can be made to fail.
contract MockAdvanceBond is IAdvanceBond {
    using SafeERC20 for IERC20;

    error MockFailure();
    error NotImplemented();

    IERC20 public immutable musd;
    address public escrow;
    bool public failClaim;
    bool public failRelease;
    uint256 public claimCalls;
    uint256 public releaseCalls;

    mapping(uint256 dealId => Bond) internal _bonds;
    mapping(uint256 dealId => uint256) internal _coverage;

    constructor(IERC20 musd_) {
        musd = musd_;
    }

    // ── Test controls ──

    function setEscrow(address escrow_) external {
        escrow = escrow_;
    }

    function setBond(uint256 dealId, address bonder, BondStatus status, uint256 coverageBps_) external {
        _bonds[dealId].bonder = bonder;
        _bonds[dealId].status = status;
        _coverage[dealId] = coverageBps_;
    }

    function setFailures(bool claim_, bool release_) external {
        failClaim = claim_;
        failRelease = release_;
    }

    // ── Escrow-facing ──

    function claim(uint256 dealId, uint256 amount, address to) external returns (uint256 paid) {
        if (msg.sender != escrow) revert NotEscrow();
        if (failClaim) revert MockFailure();
        Bond storage b = _bonds[dealId];
        if (b.status != BondStatus.Active && b.status != BondStatus.Protected) revert NoActiveBond(dealId);
        claimCalls++;
        uint256 available = musd.balanceOf(address(this));
        paid = amount < available ? amount : available;
        b.status = BondStatus.Claimed;
        musd.safeTransfer(to, paid);
        emit BondClaimed(dealId, to, amount, paid);
        if (paid < amount) emit BondShortfall(dealId, amount, paid);
    }

    function release(uint256 dealId) external {
        if (msg.sender != escrow) revert NotEscrow();
        if (failRelease) revert MockFailure();
        releaseCalls++;
        Bond storage b = _bonds[dealId];
        if (b.status == BondStatus.Active || b.status == BondStatus.Protected) {
            b.status = BondStatus.Released;
            emit BondReleased(dealId, b.bonder, 0, 0);
        }
    }

    function coverageBps(uint256 dealId) external view returns (uint256) {
        return _coverage[dealId];
    }

    function bondOf(uint256 dealId) external view returns (Bond memory) {
        return _bonds[dealId];
    }

    // ── Not used by escrow tests ──

    function post(uint256, uint256) external pure {
        revert NotImplemented();
    }

    function topUp(uint256, uint256) external pure {
        revert NotImplemented();
    }

    function withdraw(uint256) external pure {
        revert NotImplemented();
    }

    function protect(uint256) external pure {
        revert NotImplemented();
    }
}
