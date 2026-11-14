// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {TroveVault} from "./TroveVault.sol";
import {IAdvanceBond} from "./interfaces/IAdvanceBond.sol";
import {IBorrowerOperations, ICollSurplusPool, ITroveManager} from "./interfaces/IMusdBorrowing.sol";
import {IPriceOracle} from "./interfaces/IPriceOracle.sol";
import {ISwapAdapter} from "./interfaces/ISwapAdapter.sol";
import {IWasitEscrow} from "./interfaces/IWasitEscrow.sol";
import {Bond, BondStatus, DealState} from "./libraries/WasitTypes.sol";

/// @title TroveBond
/// @notice A bond backed by a trove on Mezo's MUSD borrowing system (PLAN 8.3, ADR-034/035/036).
///         The bonder's BTC opens a trove in a per-deal `TroveVault`; the MUSD the trove mints
///         stays in the vault and is the bond. On supplier default the buyer is paid in MUSD from
///         the vault: no BTC is sold, so there is no swap, slippage or price argument at default.
///         A fall in BTC is the bonder's liquidation risk; a liquidated vault keeps its MUSD.
/// @dev Serves an unchanged `WasitEscrow` through the same `claim`, `release`, `coverageBps` and
///      `bondOf` the escrow calls on `AdvanceBond`. `post` and `topUp` take native BTC, because
///      `openTrove` does. No owner: nothing here can be configured after deployment, and no
///      function lets anyone but the escrow or the bonder move a vault's assets. Not pausable.
contract TroveBond is ReentrancyGuard {
    using SafeERC20 for IERC20;

    error NotEscrow();
    error NotBonder();
    error DealNotOpenForBond(uint256 dealId);
    error BondExists(uint256 dealId);
    error NoActiveBond(uint256 dealId);
    error NoTrove(uint256 dealId);
    error BondStillLive(uint256 dealId);
    error AlreadyClosed(uint256 dealId);
    error ZeroAmount();
    error InvalidConfig();
    /// @notice Trove mode has no protective conversion: the cover is already MUSD.
    error ProtectNotApplicable();

    /// @notice The vault's trove was repaid and closed, or its remains collected, and everything
    ///         left went to the bonder.
    event BondClosed(
        uint256 indexed dealId, address indexed bonder, uint256 musdRepaid, uint256 btcOut, uint256 musdOut
    );

    /// @notice The escrow this bond serves (set once; the escrow's bond address is immutable too).
    IWasitEscrow public immutable escrow;
    IBorrowerOperations public immutable borrowerOperations;
    IERC20 public immutable musd;
    /// @notice Price source for the trove-health view (MUSD's own PriceFeed adapter).
    IPriceOracle public immutable oracle;

    mapping(uint256 dealId => Bond) internal _bonds;
    /// @notice The vault holding each deal's trove.
    mapping(uint256 dealId => TroveVault) public vaultOf;
    /// @notice True once `close` has run for the deal.
    mapping(uint256 dealId => bool) public closed;

    constructor(IWasitEscrow escrow_, IBorrowerOperations borrowerOperations_, IPriceOracle oracle_) {
        if (address(escrow_) == address(0) || address(oracle_) == address(0)) revert InvalidConfig();
        if (address(borrowerOperations_).code.length == 0) revert InvalidConfig();
        escrow = escrow_;
        borrowerOperations = borrowerOperations_;
        musd = IERC20(borrowerOperations_.musd());
        oracle = oracle_;
    }

    // ───────────────────────────── Bonder ─────────────────────────────

    /// @notice Opens a trove for `dealId` with `msg.value` BTC and keeps the MUSD it mints as the
    ///         bond: `max(covered × ratio, minNetDebt)`, so coverage meets the deal's ratio from
    ///         the start. Hints locate the trove in SortedTroves (`findInsertPosition`).
    /// @dev Only the named bonder, while the deal is Created or Accepted. The MUSD system decides
    ///      whether `msg.value` is enough collateral (≥ 110%, or 150% in recovery mode).
    function post(uint256 dealId, address upperHint, address lowerHint) external payable nonReentrant {
        (address bonder, uint256 covered, uint16 ratioBps, DealState state) = escrow.bondTerms(dealId);
        if (bonder == address(0) || !_beforeAdvance(state)) revert DealNotOpenForBond(dealId);
        if (msg.sender != bonder) revert NotBonder();
        if (_bonds[dealId].status != BondStatus.None) revert BondExists(dealId);
        if (msg.value == 0) revert ZeroAmount();

        uint256 needed = (covered * ratioBps + 9_999) / 10_000;
        uint256 debt = needed > borrowerOperations.minNetDebt() ? needed : borrowerOperations.minNetDebt();

        TroveVault vault = new TroveVault(borrowerOperations, musd);
        vaultOf[dealId] = vault;
        _bonds[dealId] = Bond({
            bonder: bonder,
            oracle: oracle,
            swap: ISwapAdapter(address(0)),
            covered: uint128(covered),
            btcHeld: uint128(msg.value),
            musdHeld: uint128(debt),
            initialRatioBps: ratioBps,
            topUpRatioBps: 0,
            protectRatioBps: 0,
            maxSlippageBps: 0,
            status: BondStatus.Active
        });
        vault.open{value: msg.value}(debt, upperHint, lowerHint);
        emit IAdvanceBond.BondPosted(dealId, bonder, msg.value, coverageBps(dealId));
    }

    /// @notice Adds `msg.value` BTC to the deal's trove, lowering the bonder's liquidation risk.
    ///         Anyone may add; the BTC goes back to the bonder when the trove closes.
    function topUp(uint256 dealId, address upperHint, address lowerHint) external payable nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        TroveVault vault = vaultOf[dealId];
        if (address(vault) == address(0) || closed[dealId]) revert NoTrove(dealId);
        _bonds[dealId].btcHeld += uint128(msg.value);
        vault.addColl{value: msg.value}(upperHint, lowerHint);
        emit IAdvanceBond.BondToppedUp(dealId, msg.sender, msg.value, coverageBps(dealId));
    }

    /// @notice Frees the bond before the advance is funded (the deal is not going ahead); the
    ///         bonder then calls `close` to get the BTC back.
    function withdraw(uint256 dealId) external nonReentrant {
        Bond storage b = _bonds[dealId];
        if (b.status != BondStatus.Active) revert NoActiveBond(dealId);
        if (msg.sender != b.bonder) revert NotBonder();
        (,,, DealState state) = escrow.bondTerms(dealId);
        if (!_beforeAdvance(state)) revert DealNotOpenForBond(dealId);
        b.status = BondStatus.Released;
        emit IAdvanceBond.BondWithdrawn(dealId, b.bonder, 0);
    }

    /// @notice Not available in trove mode.
    function protect(uint256) external pure {
        revert ProtectNotApplicable();
    }

    // ───────────────────────────── Views ─────────────────────────────

    /// @notice MUSD in the vault over the covered amount, in basis points. It does not move with
    ///         BTC: the cover is MUSD from the moment the bond is posted.
    function coverageBps(uint256 dealId) public view returns (uint256) {
        Bond storage b = _bonds[dealId];
        if (b.covered == 0) return 0;
        return (musd.balanceOf(address(vaultOf[dealId])) * 10_000) / b.covered;
    }

    /// @notice The stored bond (status None if never posted). `musdHeld` is the vault's MUSD.
    function bondOf(uint256 dealId) external view returns (Bond memory b) {
        b = _bonds[dealId];
        if (address(vaultOf[dealId]) != address(0)) b.musdHeld = uint128(musd.balanceOf(address(vaultOf[dealId])));
    }

    /// @notice The bonder's side: the trove's collateral ratio at the MUSD PriceFeed price (1e18 =
    ///         100%; liquidation below 1.1e18), its status, and the price used. `price` is 0 when
    ///         the feed is unavailable, and `icr` is then 0 too.
    function troveHealth(uint256 dealId) external view returns (uint256 icr, uint8 status, uint256 price) {
        TroveVault vault = vaultOf[dealId];
        if (address(vault) == address(0)) return (0, 0, 0);
        ITroveManager tm = borrowerOperations.troveManager();
        status = tm.getTroveStatus(address(vault));
        try oracle.btcUsd() returns (uint256 p, uint256) {
            price = p;
            if (status == 1) icr = tm.getCurrentICR(address(vault), p);
        } catch {}
    }

    function _beforeAdvance(DealState state) private pure returns (bool) {
        return state == DealState.Created || state == DealState.Accepted;
    }
}
