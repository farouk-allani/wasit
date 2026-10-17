// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAdvanceBond} from "./interfaces/IAdvanceBond.sol";
import {IPriceOracle} from "./interfaces/IPriceOracle.sol";
import {ISwapAdapter} from "./interfaces/ISwapAdapter.sol";
import {IWasitEscrow} from "./interfaces/IWasitEscrow.sol";
import {Bond, BondStatus, DealState, WasitTypes} from "./libraries/WasitTypes.sol";

/// @title AdvanceBond
/// @notice Holds the BTC a supplier or sourcing agent locks to secure a deal's net advance. The
///         escrow decides when a bond is released or claimed; anyone can top it up. Each bond keeps
///         the oracle, swap adapter, ratios and slippage tolerance that were configured when it was
///         posted. The owner can change those for new bonds only and can never move collateral.
contract AdvanceBond is IAdvanceBond, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    /// @dev Temporary: functions of later build steps revert until they are implemented.
    error NotImplemented();

    /// @notice BTC ERC-20 (on Mezo: the native-BTC precompile).
    IERC20 public immutable btc;
    /// @notice Settlement stablecoin (MUSD).
    IERC20 public immutable musd;
    /// @notice The only contract allowed to claim or release bonds.
    IWasitEscrow public immutable escrow;

    /// @notice Price source for bonds posted from now on.
    IPriceOracle public oracle;
    /// @notice Swap adapter for bonds posted from now on.
    ISwapAdapter public swapAdapter;
    /// @notice Warning level for bonds posted from now on (UI and events only).
    uint16 public topUpRatioBps;
    /// @notice Coverage below which anyone may protect a bond posted from now on.
    uint16 public protectRatioBps;
    /// @notice Slippage tolerance for BTC sales of bonds posted from now on (ADR-016).
    uint16 public maxSlippageBps;

    mapping(uint256 dealId => Bond) private _bonds;

    modifier onlyEscrow() {
        if (msg.sender != address(escrow)) revert NotEscrow();
        _;
    }

    /// @param initialOwner Config owner (two-step transfer).
    /// @param btc_ BTC token.
    /// @param musd_ MUSD token.
    /// @param escrow_ Escrow address (deployed right after this contract; see Deploy script).
    /// @param oracle_ Initial price source.
    /// @param swap_ Initial swap adapter.
    /// @param topUpRatioBps_ Initial warning ratio.
    /// @param protectRatioBps_ Initial protection ratio.
    /// @param maxSlippageBps_ Initial slippage tolerance (≤ MAX_SLIPPAGE_BPS).
    constructor(
        address initialOwner,
        IERC20 btc_,
        IERC20 musd_,
        IWasitEscrow escrow_,
        IPriceOracle oracle_,
        ISwapAdapter swap_,
        uint16 topUpRatioBps_,
        uint16 protectRatioBps_,
        uint16 maxSlippageBps_
    ) Ownable(initialOwner) {
        if (address(btc_) == address(0) || address(musd_) == address(0) || address(escrow_) == address(0)) {
            revert InvalidConfig();
        }
        btc = btc_;
        musd = musd_;
        escrow = escrow_;
        _setOracle(oracle_);
        _setSwapAdapter(swap_);
        _setRatios(topUpRatioBps_, protectRatioBps_);
        _setMaxSlippage(maxSlippageBps_);
    }

    // ───────────────────────────── Bonder / keeper actions ─────────────────────────────

    /// @inheritdoc IAdvanceBond
    function post(uint256 dealId, uint256 btcAmount) external nonReentrant {
        (address bonder, uint256 covered, uint16 ratioBps, DealState state) = escrow.bondTerms(dealId);
        if (bonder == address(0) || !_beforeAdvance(state)) revert DealNotOpenForBond(dealId);
        if (msg.sender != bonder) revert NotBonder();
        if (_live(_bonds[dealId].status)) revert BondExists(dealId);
        if (btcAmount == 0) revert ZeroAmount();

        IPriceOracle o = oracle;
        uint256 coverage = _coverage(btcAmount, 0, covered, _price(o));
        if (coverage < ratioBps) revert InsufficientCoverage(coverage, ratioBps);

        _bonds[dealId] = Bond({
            bonder: bonder,
            oracle: o,
            swap: swapAdapter,
            covered: covered.toUint128(),
            btcHeld: btcAmount.toUint128(),
            musdHeld: 0,
            initialRatioBps: ratioBps,
            topUpRatioBps: topUpRatioBps,
            protectRatioBps: protectRatioBps,
            maxSlippageBps: maxSlippageBps,
            status: BondStatus.Active
        });
        emit BondPosted(dealId, bonder, btcAmount, coverage);

        btc.safeTransferFrom(msg.sender, address(this), btcAmount);
    }

    /// @inheritdoc IAdvanceBond
    /// @dev Works even while the oracle is down; the event then reports coverage 0.
    function topUp(uint256 dealId, uint256 btcAmount) external nonReentrant {
        Bond storage b = _bonds[dealId];
        if (!_live(b.status)) revert NoActiveBond(dealId);
        if (btcAmount == 0) revert ZeroAmount();
        b.btcHeld += btcAmount.toUint128();
        emit BondToppedUp(dealId, msg.sender, btcAmount, _tryCoverage(b));

        btc.safeTransferFrom(msg.sender, address(this), btcAmount);
    }

    /// @inheritdoc IAdvanceBond
    function withdraw(uint256 dealId) external nonReentrant {
        Bond storage b = _bonds[dealId];
        if (b.status != BondStatus.Active) revert NoActiveBond(dealId);
        if (msg.sender != b.bonder) revert NotBonder();
        (,,, DealState state) = escrow.bondTerms(dealId);
        if (!_beforeAdvance(state)) revert DealNotOpenForBond(dealId);

        uint256 btcAmount = b.btcHeld;
        b.btcHeld = 0;
        b.status = BondStatus.Released;
        emit BondWithdrawn(dealId, msg.sender, btcAmount);

        btc.safeTransfer(msg.sender, btcAmount);
    }

    /// @inheritdoc IAdvanceBond
    function protect(uint256) external pure {
        revert NotImplemented();
    }

    // ───────────────────────────── Escrow actions ─────────────────────────────

    /// @inheritdoc IAdvanceBond
    function claim(uint256, uint256, address) external view onlyEscrow returns (uint256) {
        revert NotImplemented();
    }

    /// @inheritdoc IAdvanceBond
    function release(uint256 dealId) external onlyEscrow nonReentrant {
        Bond storage b = _bonds[dealId];
        if (!_live(b.status)) return;
        _closeToBonder(dealId, b, BondStatus.Released);
    }

    // ───────────────────────────── Admin (new bonds only) ─────────────────────────────

    /// @notice Sets the price source for bonds posted from now on.
    function setOracle(IPriceOracle oracle_) external onlyOwner {
        _setOracle(oracle_);
    }

    /// @notice Sets the swap adapter for bonds posted from now on.
    function setSwapAdapter(ISwapAdapter swap_) external onlyOwner {
        _setSwapAdapter(swap_);
    }

    /// @notice Sets the warning and protection ratios for bonds posted from now on.
    function setRatios(uint16 topUpRatioBps_, uint16 protectRatioBps_) external onlyOwner {
        _setRatios(topUpRatioBps_, protectRatioBps_);
    }

    /// @notice Sets the slippage tolerance for bonds posted from now on.
    function setMaxSlippage(uint16 maxSlippageBps_) external onlyOwner {
        _setMaxSlippage(maxSlippageBps_);
    }

    // ───────────────────────────── Views ─────────────────────────────

    /// @inheritdoc IAdvanceBond
    /// @dev Returns 0 without a live bond; reverts if the bond's oracle is stale.
    function coverageBps(uint256 dealId) external view returns (uint256) {
        Bond storage b = _bonds[dealId];
        if (!_live(b.status)) return 0;
        return _coverage(b.btcHeld, b.musdHeld, b.covered, _price(b.oracle));
    }

    /// @inheritdoc IAdvanceBond
    function bondOf(uint256 dealId) external view returns (Bond memory) {
        return _bonds[dealId];
    }

    // ───────────────────────────── Internals ─────────────────────────────

    /// @dev Returns all collateral to the bonder and closes the bond with `status`.
    function _closeToBonder(uint256 dealId, Bond storage b, BondStatus status) private {
        uint256 btcAmount = b.btcHeld;
        uint256 musdAmount = b.musdHeld;
        b.btcHeld = 0;
        b.musdHeld = 0;
        b.status = status;
        emit BondReleased(dealId, b.bonder, btcAmount, musdAmount);

        if (btcAmount != 0) btc.safeTransfer(b.bonder, btcAmount);
        if (musdAmount != 0) musd.safeTransfer(b.bonder, musdAmount);
    }

    /// @dev `(btc × price + musd) × 10_000 / covered`, with MUSD valued at 1 USD.
    function _coverage(uint256 btcAmount, uint256 musdAmount, uint256 covered, uint256 price)
        private
        pure
        returns (uint256)
    {
        return (Math.mulDiv(btcAmount, price, 1e18) + musdAmount) * WasitTypes.BPS / covered;
    }

    function _tryCoverage(Bond storage b) private view returns (uint256) {
        try b.oracle.btcUsd() returns (uint256 price, uint256) {
            if (price == 0) return 0;
            return _coverage(b.btcHeld, b.musdHeld, b.covered, price);
        } catch {
            return 0;
        }
    }

    /// @dev Never trust a zero price: it would turn every minOut into 0.
    function _price(IPriceOracle o) private view returns (uint256 price) {
        (price,) = o.btcUsd();
        if (price == 0) revert InvalidPrice();
    }

    function _live(BondStatus status) private pure returns (bool) {
        return status == BondStatus.Active || status == BondStatus.Protected;
    }

    function _beforeAdvance(DealState state) private pure returns (bool) {
        return state == DealState.Created || state == DealState.Accepted;
    }

    function _setOracle(IPriceOracle oracle_) private {
        if (address(oracle_) == address(0)) revert InvalidConfig();
        oracle = oracle_;
        emit OracleSet(address(oracle_));
    }

    function _setSwapAdapter(ISwapAdapter swap_) private {
        if (address(swap_) == address(0)) revert InvalidConfig();
        swapAdapter = swap_;
        emit SwapAdapterSet(address(swap_));
    }

    /// @dev 100% < protect < topUp, and protect stays below the lowest ratio a deal may require,
    ///      so a freshly posted bond is never protectable.
    function _setRatios(uint16 topUpBps, uint16 protectBps) private {
        if (protectBps <= WasitTypes.BPS || protectBps >= topUpBps || protectBps >= WasitTypes.MIN_BOND_RATIO_BPS) {
            revert InvalidConfig();
        }
        if (topUpBps > WasitTypes.MAX_BOND_RATIO_BPS) revert InvalidConfig();
        topUpRatioBps = topUpBps;
        protectRatioBps = protectBps;
        emit RatiosSet(topUpBps, protectBps);
    }

    function _setMaxSlippage(uint16 maxSlippageBps_) private {
        if (maxSlippageBps_ > WasitTypes.MAX_SLIPPAGE_BPS) revert InvalidConfig();
        maxSlippageBps = maxSlippageBps_;
        emit MaxSlippageSet(maxSlippageBps_);
    }
}
