// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IBorrowerOperations, ITroveManager} from "./interfaces/IMusdBorrowing.sol";

/// @title TroveVault
/// @notice Owns one MUSD trove for one bond. A Liquity-style system allows one active trove per
///         address, so `TroveBond` deploys a vault per deal. Only the bond that deployed it can
///         call it; it has no owner and no other entry point.
/// @dev The vault is the trove's borrower and recipient: openTrove mints MUSD to it, closeTrove
///      and claimCollateral send BTC to it as native value.
contract TroveVault {
    using SafeERC20 for IERC20;

    error NotBond();
    error TransferFailed();

    /// @notice The `TroveBond` that deployed this vault.
    address public immutable bond;
    IBorrowerOperations public immutable borrowerOperations;
    IERC20 public immutable musd;

    constructor(IBorrowerOperations borrowerOperations_, IERC20 musd_) {
        bond = msg.sender;
        borrowerOperations = borrowerOperations_;
        musd = musd_;
    }

    modifier onlyBond() {
        if (msg.sender != bond) revert NotBond();
        _;
    }

    /// @notice BTC from the trove (close, surplus claim) arrives here.
    receive() external payable {}

    /// @notice Opens the trove with `msg.value` BTC, minting `debtAmount` MUSD to this vault.
    function open(uint256 debtAmount, address upperHint, address lowerHint) external payable onlyBond {
        borrowerOperations.openTrove{value: msg.value}(debtAmount, upperHint, lowerHint);
    }

    /// @notice Adds `msg.value` BTC to the trove.
    function addColl(address upperHint, address lowerHint) external payable onlyBond {
        borrowerOperations.addColl{value: msg.value}(upperHint, lowerHint);
    }

    /// @notice Pays `amount` MUSD from the vault to `to`.
    function pay(address to, uint256 amount) external onlyBond {
        musd.safeTransfer(to, amount);
    }

    /// @notice MUSD the trove needs burned to close now: debt, after accruing interest and
    ///         applying pending rewards, minus the gas compensation the system burns itself.
    function amountToClose() external onlyBond returns (uint256) {
        ITroveManager tm = borrowerOperations.troveManager();
        tm.updateSystemAndTroveInterest(address(this));
        return tm.getTroveDebt(address(this)) - borrowerOperations.MUSD_GAS_COMPENSATION();
    }

    /// @notice Repays and closes the trove; its BTC comes back to this vault.
    function closeTrove() external onlyBond {
        borrowerOperations.closeTrove();
    }

    /// @notice Collects the collateral surplus left after a full redemption.
    function claimCollateral() external onlyBond {
        borrowerOperations.claimCollateral();
    }

    /// @notice Sends everything the vault holds, MUSD and BTC, to `to`.
    function sweep(address to) external onlyBond returns (uint256 musdOut, uint256 btcOut) {
        musdOut = musd.balanceOf(address(this));
        if (musdOut != 0) musd.safeTransfer(to, musdOut);
        btcOut = address(this).balance;
        if (btcOut != 0) {
            (bool ok,) = to.call{value: btcOut}("");
            if (!ok) revert TransferFailed();
        }
    }
}
