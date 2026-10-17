// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {AdvanceBond} from "../../src/AdvanceBond.sol";
import {WasitEscrow} from "../../src/WasitEscrow.sol";
import {IAdvanceBond} from "../../src/interfaces/IAdvanceBond.sol";
import {AttestationKind, Bond, BondStatus, Deal, DealState, DealTerms} from "../../src/libraries/WasitTypes.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockOracle} from "../mocks/MockOracle.sol";
import {MockSwap} from "../mocks/MockSwap.sol";

/// @notice Drives the real escrow and bond together under moving prices, pool slippage, oracle
///         outages, protection, top-ups, withdrawals and direct transfers. Every call it makes is
///         valid or wrapped, so the suite can fail on any revert.
contract BondHandler is Test {
    uint256 internal constant MAX_DEALS = 6;

    struct System {
        WasitEscrow escrow;
        AdvanceBond bond;
        MockERC20 btc;
        MockERC20 musd;
        MockOracle oracle;
        MockSwap swap;
    }

    struct Actors {
        address buyer;
        address supplier;
        address agent;
        address arbiter;
        uint256 inspectorKey;
        uint256 carrierKey;
    }

    System internal s;
    Actors internal a;

    uint256[] public dealIds;
    uint256 public donatedBtc;
    uint256 public donatedMusd;
    /// @notice Set if a BondClaimed event ever paid more than requested or than the bond covers.
    bool public overpaid;
    /// @notice Successful claims and protections seen (shows the run reached those paths).
    uint256 public claims;
    uint256 public protections;

    constructor(System memory system, Actors memory actors) {
        s = system;
        a = actors;
    }

    function dealCount() external view returns (uint256) {
        return dealIds.length;
    }

    // ───────────── deals ─────────────

    function createDeal(uint128 advance, uint128 balance, uint32 periodSeed) external {
        if (dealIds.length >= MAX_DEALS) return;
        advance = uint128(bound(advance, 1e18, 100_000e18));
        balance = uint128(bound(balance, 1e18, 100_000e18));
        uint32 period = uint32(bound(periodSeed, 1 hours, 20 days));
        DealTerms memory t = DealTerms({
            buyer: a.buyer,
            supplier: a.supplier,
            inspector: vm.addr(a.inspectorKey),
            carrier: vm.addr(a.carrierKey),
            arbiter: a.arbiter,
            bonder: a.agent,
            token: address(s.musd),
            advanceAmount: advance,
            balanceAmount: balance,
            feeBps: s.escrow.defaultFeeBps(),
            bondRatioBps: 15_000,
            productionPeriod: period,
            balanceWindow: period,
            shippingPeriod: period,
            challengeWindow: period,
            arbitrationPeriod: period,
            termsHash: keccak256(abi.encode(advance, balance, dealIds.length))
        });
        s.musd.mint(a.buyer, uint256(advance) + balance);
        vm.prank(a.buyer);
        dealIds.push(s.escrow.createDeal(t));
    }

    /// @notice One to eight natural next steps for a deal, picking among the outcomes.
    function progress(uint256 seed, uint8 steps, uint256 branch) external {
        if (dealIds.length == 0) return;
        uint256 id = dealIds[seed % dealIds.length];
        steps = uint8(bound(steps, 1, 8));
        for (uint256 i; i < steps; ++i) {
            branch = uint256(keccak256(abi.encode(branch, i)));
            if (!_step(id, branch)) return;
        }
    }

    function _step(uint256 id, uint256 branch) internal returns (bool) {
        Deal memory d = s.escrow.getDeal(id);
        (uint256 readyBy, uint256 due, uint256 shipBy, uint256 challengeEnds, uint256 ruleBy) = s.escrow.deadlines(id);
        if (d.state == DealState.Created) {
            vm.prank(a.supplier);
            s.escrow.accept(id);
        } else if (d.state == DealState.Accepted) {
            if (!d.arbiterAccepted) {
                vm.prank(a.arbiter);
                s.escrow.acceptArbiter(id);
            } else {
                _bondAndFund(id, d);
            }
        } else if (d.state == DealState.AdvancePaid) {
            if (block.timestamp > readyBy) _watchClaims(abi.encodeCall(s.escrow.claimSupplierDefault, (id)), false);
            else if (branch % 6 == 0) vm.warp(readyBy + 1);
            else _attest(id, AttestationKind.ReadyInspected, a.inspectorKey, d.attestationNonce);
        } else if (d.state == DealState.GoodsReady) {
            if (block.timestamp > due) {
                s.escrow.claimBuyerDefault(id);
            } else if (branch % 6 == 0) {
                vm.warp(due + 1);
            } else {
                vm.prank(a.buyer);
                s.escrow.fundBalance(id);
            }
        } else if (d.state == DealState.BalanceFunded) {
            if (block.timestamp > shipBy) _watchClaims(abi.encodeCall(s.escrow.claimSupplierDefault, (id)), false);
            else if (branch % 6 == 0) vm.warp(shipBy + 1);
            else _attest(id, AttestationKind.Shipped, a.carrierKey, d.attestationNonce);
        } else if (d.state == DealState.Shipped) {
            if (block.timestamp > challengeEnds || branch % 3 == 0) {
                if (block.timestamp <= challengeEnds) vm.warp(challengeEnds + 1);
                s.escrow.release(id);
            } else {
                vm.prank(a.buyer);
                s.escrow.dispute(id, keccak256("reason"));
            }
        } else if (d.state == DealState.Disputed) {
            if (block.timestamp > ruleBy) {
                s.escrow.release(id);
            } else {
                vm.prank(a.arbiter);
                _watchClaims(
                    abi.encodeCall(s.escrow.resolve, (id, uint16(branch % 10_001), uint16((branch >> 32) % 10_001))),
                    false
                );
            }
        } else {
            return false;
        }
        return true;
    }

    /// @dev Posts (or tops up) enough BTC for the deal's ratio at the current price, then funds.
    function _bondAndFund(uint256 id, Deal memory d) internal {
        if (s.oracle.stale()) return;
        (, uint256 covered, uint16 ratio,) = s.escrow.bondTerms(id);
        uint256 needed = covered * ratio / 10_000 * 1e18 / s.oracle.price() + 1e12;
        s.btc.mint(a.agent, needed);
        BondStatus status = s.bond.bondOf(id).status;
        vm.prank(a.agent);
        if (status == BondStatus.Active) s.bond.topUp(id, needed);
        else s.bond.post(id, needed);
        vm.prank(a.buyer);
        s.escrow.fundAdvance(id);
        d; // silence unused warning
    }

    // ───────────── bond actions ─────────────

    function protect(uint256 seed) external {
        if (dealIds.length == 0) return;
        uint256 id = dealIds[seed % dealIds.length];
        try s.bond.protect(id) {
            protections++;
        } catch {}
    }

    /// @notice Moves the price so one live bond sits at 100–114% coverage, then tries to protect it.
    function crash(uint256 seed, uint16 targetBps) external {
        if (dealIds.length == 0) return;
        uint256 id = dealIds[seed % dealIds.length];
        Bond memory b = s.bond.bondOf(id);
        if (b.status != BondStatus.Active || b.btcHeld == 0) return;
        targetBps = uint16(bound(targetBps, 10_000, 11_400));
        uint256 price = uint256(b.covered) * targetBps / 10_000 * 1e18 / b.btcHeld;
        if (price < 1e18) return;
        s.oracle.setPrice(price);
        s.swap.setPrice(price);
        try s.bond.protect(id) {
            protections++;
        } catch {}
    }

    function topUp(uint256 seed, uint64 amount) external {
        if (dealIds.length == 0) return;
        uint256 id = dealIds[seed % dealIds.length];
        BondStatus status = s.bond.bondOf(id).status;
        if (status != BondStatus.Active && status != BondStatus.Protected) return;
        amount = uint64(bound(amount, 1, 1e18));
        s.btc.mint(a.agent, amount);
        vm.prank(a.agent);
        s.bond.topUp(id, amount);
    }

    function withdraw(uint256 seed) external {
        if (dealIds.length == 0) return;
        uint256 id = dealIds[seed % dealIds.length];
        (,,, DealState state) = s.escrow.bondTerms(id);
        if (s.bond.bondOf(id).status != BondStatus.Active) return;
        if (state != DealState.Created && state != DealState.Accepted) return;
        vm.prank(a.agent);
        s.bond.withdraw(id);
    }

    function retryBondSettlement(uint256 seed) external {
        if (dealIds.length == 0) return;
        uint256 id = dealIds[seed % dealIds.length];
        if (uint8(s.escrow.getDeal(id).bondPending) == 0) return;
        _watchClaims(abi.encodeCall(s.escrow.retryBondSettlement, (id)), true);
    }

    // ───────────── environment ─────────────

    function movePrice(uint64 priceUsd) external {
        uint256 price = bound(priceUsd, 20_000, 150_000) * 1e18;
        s.oracle.setPrice(price);
        s.swap.setPrice(price);
    }

    function setPoolSlippage(uint16 bps) external {
        s.swap.setSlippage(uint16(bound(bps, 0, 800)));
    }

    function setOracleStale(bool stale) external {
        s.oracle.setStale(stale);
    }

    function donate(uint64 btcAmount, uint96 musdAmount) external {
        s.btc.mint(address(s.bond), btcAmount);
        s.musd.mint(address(s.bond), musdAmount);
        donatedBtc += btcAmount;
        donatedMusd += musdAmount;
    }

    function warp(uint32 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 25 days));
    }

    // ───────────── helpers ─────────────

    /// @dev Calls the escrow (as the current prank) and checks every BondClaimed event it caused.
    ///      Only a retry may fail (the settlement then stays pending); any other failure bubbles up.
    function _watchClaims(bytes memory call, bool mayFail) internal {
        vm.recordLogs();
        (bool ok, bytes memory ret) = address(s.escrow).call(call);
        if (!ok && !mayFail) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(s.bond) || logs[i].topics[0] != IAdvanceBond.BondClaimed.selector) continue;
            uint256 dealId = uint256(logs[i].topics[1]);
            (uint256 requested, uint256 paid) = abi.decode(logs[i].data, (uint256, uint256));
            (, uint256 covered,,) = s.escrow.bondTerms(dealId);
            claims++;
            if (paid > requested || paid > covered) overpaid = true;
        }
    }

    function _attest(uint256 id, AttestationKind kind, uint256 key, uint256 nonce) internal {
        bytes32 evidence = keccak256(abi.encode(id, kind));
        uint64 issuedAt = uint64(block.timestamp);
        (uint8 v, bytes32 r, bytes32 sig) =
            vm.sign(key, s.escrow.attestationDigest(id, kind, evidence, issuedAt, nonce));
        s.escrow.submitAttestation(id, kind, evidence, issuedAt, abi.encodePacked(r, sig, v));
    }
}
