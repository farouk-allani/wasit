// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The parts of Mezo's MUSD borrowing system (a Liquity fork) that a trove-backed bond uses.
///         Signatures from the verified testnet source (VERIFIED-FACTS, "MUSD borrowing system").

/// @notice BorrowerOperations (proxy `0xcdf7…bee5` on testnet). The caller is the trove owner.
interface IBorrowerOperations {
    /// @notice Opens the caller's trove with `msg.value` BTC as collateral and mints `_debtAmount`
    ///         MUSD to the caller. Debt recorded = `_debtAmount` + borrowing fee + 200 MUSD gas comp.
    function openTrove(uint256 _debtAmount, address _upperHint, address _lowerHint) external payable;

    /// @notice Adds `msg.value` BTC to the caller's trove.
    function addColl(address _upperHint, address _lowerHint) external payable;

    /// @notice Burns `debt - 200` MUSD from the caller and returns all collateral. Refused in
    ///         recovery mode.
    function closeTrove() external;

    /// @notice Sends the caller's collateral surplus (after a full redemption) to the caller.
    function claimCollateral() external;

    /// @notice Minimum net debt (drawn amount plus fee) of a trove.
    function minNetDebt() external view returns (uint256);

    /// @notice 200 MUSD added to every trove's debt and burned on close.
    function MUSD_GAS_COMPENSATION() external view returns (uint256);

    function troveManager() external view returns (ITroveManager);
    function collSurplusPool() external view returns (ICollSurplusPool);
    function sortedTroves() external view returns (ISortedTroves);
    function musd() external view returns (address);
}

/// @notice TroveManager. Status order: nonExistent, active, closedByOwner, closedByLiquidation,
///         closedByRedemption.
interface ITroveManager {
    function getTroveStatus(address _borrower) external view returns (uint8);
    /// @notice Principal + interest accrued to now (excludes pending redistribution rewards).
    function getTroveDebt(address _borrower) external view returns (uint256);
    function getTroveColl(address _borrower) external view returns (uint256);
    function getCurrentICR(address _borrower, uint256 _price) external view returns (uint256);
    function checkRecoveryMode(uint256 _price) external view returns (bool);
    /// @notice Accrues interest and applies pending redistribution rewards; anyone may call.
    function updateSystemAndTroveInterest(address _borrower) external;
    function liquidate(address _borrower) external;
}

interface ICollSurplusPool {
    function getCollateral(address _account) external view returns (uint256);
}

interface ISortedTroves {
    function findInsertPosition(uint256 _NICR, address _prevId, address _nextId)
        external
        view
        returns (address, address);
}
