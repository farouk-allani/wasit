// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Bond} from "../libraries/WasitTypes.sol";

/// @title IAdvanceBond
/// @notice BTC collateral securing a deal's net advance. One bond per deal, keyed by deal id.
///         The bonder, covered amount and required ratio come from the escrow's `bondTerms`.
interface IAdvanceBond {
    /// @notice The named bonder locked BTC for a deal.
    event BondPosted(uint256 indexed dealId, address indexed bonder, uint256 btcAmount, uint256 coverageBps);
    /// @notice Extra BTC was added to a live bond.
    event BondToppedUp(uint256 indexed dealId, address indexed from, uint256 btcAmount, uint256 coverageBps);
    /// @notice The bonder took the bond back before the advance was funded.
    event BondWithdrawn(uint256 indexed dealId, address indexed bonder, uint256 btcAmount);
    /// @notice BTC was converted to MUSD because coverage fell below the protect ratio.
    event BondProtected(uint256 indexed dealId, uint256 btcSold, uint256 musdReceived, uint256 coverageBefore);
    /// @notice The escrow claimed from the bond for the buyer.
    event BondClaimed(uint256 indexed dealId, address indexed to, uint256 requested, uint256 paid);
    /// @notice A claim paid less than requested because the collateral fell short.
    event BondShortfall(uint256 indexed dealId, uint256 requested, uint256 paid);
    /// @notice Remaining collateral went back to the bonder.
    event BondReleased(uint256 indexed dealId, address indexed bonder, uint256 btcReturned, uint256 musdReturned);
    /// @notice Oracle used by bonds posted from now on.
    event OracleSet(address indexed oracle);
    /// @notice Swap adapter used by bonds posted from now on.
    event SwapAdapterSet(address indexed swap);
    /// @notice Warning and protection ratios used by bonds posted from now on.
    event RatiosSet(uint16 topUpRatioBps, uint16 protectRatioBps);
    /// @notice Slippage tolerance used by bonds posted from now on.
    event MaxSlippageSet(uint16 maxSlippageBps);

    /// @notice Caller is not the escrow.
    error NotEscrow();
    /// @notice Caller is not the bonder named in the deal terms.
    error NotBonder();
    /// @notice The deal has no bonder, or its state no longer allows this bond action.
    error DealNotOpenForBond(uint256 dealId);
    /// @notice The deal already has a live bond.
    error BondExists(uint256 dealId);
    /// @notice The deal has no live bond.
    error NoActiveBond(uint256 dealId);
    /// @notice Posted value is below the required coverage.
    error InsufficientCoverage(uint256 coverageBps, uint256 requiredBps);
    /// @notice Coverage is still at or above the protect ratio.
    error CoverageAboveProtectRatio(uint256 coverageBps, uint256 protectRatioBps);
    /// @notice A zero amount was passed.
    error ZeroAmount();
    /// @notice A config value is out of bounds.
    error InvalidConfig();
    /// @notice The oracle returned a zero price.
    error InvalidPrice();
    /// @notice The swap delivered less MUSD than the oracle-bounded minimum.
    error SwapOutputTooLow(uint256 received, uint256 minOut);

    /// @notice Locks `btcAmount` BTC (pulled from the caller) for `dealId`.
    /// @dev Only the named bonder, while the deal is Created or Accepted. Snapshots the oracle,
    ///      swap adapter, ratios and slippage tolerance from the current config.
    function post(uint256 dealId, uint256 btcAmount) external;

    /// @notice Adds `btcAmount` BTC (pulled from the caller) to a live bond. Anyone may top up;
    ///         collateral left at the end goes to the bonder.
    function topUp(uint256 dealId, uint256 btcAmount) external;

    /// @notice Returns the whole bond to the bonder while the advance is not funded yet.
    function withdraw(uint256 dealId) external;

    /// @notice Converts BTC to MUSD when coverage is below the protect ratio. Anyone may call.
    function protect(uint256 dealId) external;

    /// @notice Pays up to `amount` (capped at the covered amount) to `to`: MUSD held first, then
    ///         BTC sold at an oracle-bounded price. Leftovers go to the bonder.
    /// @dev Only the escrow.
    /// @return paid MUSD actually paid to `to`.
    function claim(uint256 dealId, uint256 amount, address to) external returns (uint256 paid);

    /// @notice Returns all collateral to the bonder. No-op if the deal has no live bond.
    /// @dev Only the escrow.
    function release(uint256 dealId) external;

    /// @notice Current coverage of the covered amount, in basis points, at the oracle price.
    function coverageBps(uint256 dealId) external view returns (uint256);

    /// @notice The stored bond for `dealId` (status None if never posted).
    function bondOf(uint256 dealId) external view returns (Bond memory);
}
