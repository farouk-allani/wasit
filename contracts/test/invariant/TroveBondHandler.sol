// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {TroveBond} from "../../src/TroveBond.sol";
import {BondStatus, DealState} from "../../src/libraries/WasitTypes.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockMusdSystem} from "../mocks/MockMusdSystem.sol";
import {MockOracle} from "../mocks/MockOracle.sol";

/// @notice Plays the escrow (it answers `bondTerms`) and the bonder, and drives the MUSD system
///         through crashes, liquidations, redemptions, interest and recovery mode. Every call it
///         makes has its preconditions checked first, so any revert is a bug.
contract TroveBondHandler is Test {
    MockMusdSystem public immutable sys;
    MockERC20 public immutable musd;
    MockOracle public immutable oracle;
    TroveBond public bond;

    struct D {
        uint256 covered;
        uint16 ratio;
        DealState state;
    }

    mapping(uint256 => D) public deals;
    uint256 public dealCount;
    bool public overpaid;
    bool public shortPaid;

    constructor(MockMusdSystem sys_, MockERC20 musd_, MockOracle oracle_) {
        sys = sys_;
        musd = musd_;
        oracle = oracle_;
        vm.deal(address(this), 1_000_000 ether);
    }

    function setBond(TroveBond bond_) external {
        bond = bond_;
        musd.approve(address(bond_), type(uint256).max);
    }

    receive() external payable {}

    // The escrow side
    function bondTerms(uint256 id) external view returns (address, uint256, uint16, DealState) {
        D storage d = deals[id];
        return (d.covered == 0 ? address(0) : address(this), d.covered, d.ratio, d.state);
    }

    function _id(uint256 seed) internal view returns (uint256) {
        return seed % dealCount + 1;
    }

    function _vault(uint256 id) internal view returns (address) {
        return address(bond.vaultOf(id));
    }

    function _active(uint256 id) internal view returns (bool) {
        return _vault(id) != address(0) && sys.getTroveStatus(_vault(id)) == 1;
    }

    // ── actions ──

    function post(uint256 coveredSeed, uint256 ratioSeed, uint256 extraSeed) external {
        uint256 id = ++dealCount;
        uint256 covered = bound(coveredSeed, 50e18, 20_000e18);
        uint16 ratio = uint16(bound(ratioSeed, 12_000, 50_000));
        deals[id] = D(covered, ratio, DealState.Accepted);
        uint256 needed = (covered * ratio + 9_999) / 10_000;
        uint256 debt = needed > sys.minNetDebt() ? needed : sys.minNetDebt();
        uint256 composite = debt + debt / 1_000 + 200e18;
        uint256 minIcr = sys.recoveryMode() ? 1.5e18 : 1.1e18;
        uint256 btc = (composite * minIcr) / sys.price() + 1e15 + bound(extraSeed, 0, 5 ether);
        bond.post{value: btc}(id, address(0), address(0));
    }

    function topUp(uint256 seed, uint256 amount) external {
        if (dealCount == 0) return;
        uint256 id = _id(seed);
        if (!_active(id) || bond.closed(id)) return;
        bond.topUp{value: bound(amount, 1, 1 ether)}(id, address(0), address(0));
    }

    function movePrice(uint256 seed) external {
        uint256 p = bound(seed, 5_000e18, 300_000e18);
        sys.setPrice(p);
        oracle.setPrice(p);
    }

    function liquidate(uint256 seed) external {
        if (dealCount == 0) return;
        address v = _vault(_id(seed));
        if (v == address(0) || sys.getTroveStatus(v) != 1) return;
        if ((sys.getTroveColl(v) * sys.price()) / sys.getTroveDebt(v) >= 1.1e18) return;
        sys.liquidate(v);
    }

    function redeem(uint256 seed, uint256 lotSeed, bool full) external {
        if (dealCount == 0) return;
        address v = _vault(_id(seed));
        if (v == address(0) || sys.getTroveStatus(v) != 1) return;
        uint256 redeemable = sys.getTroveDebt(v) - 200e18;
        uint256 coll = sys.getTroveColl(v);
        if ((redeemable * 1e18) / sys.price() >= coll) return; // underwater: not redeemable here
        if (full) return sys.redeemFull(v);
        uint256 lot = bound(lotSeed, 1, redeemable - 1);
        sys.redeemPartial(v, lot);
    }

    function accrue(uint256 seed, uint256 amount) external {
        if (dealCount == 0) return;
        uint256 id = _id(seed);
        if (_active(id)) sys.accrue(_vault(id), bound(amount, 0, 50e18));
    }

    function setRecovery(bool on) external {
        sys.setRecoveryMode(on);
    }

    function fundAdvance(uint256 seed) external {
        if (dealCount == 0) return;
        D storage d = deals[_id(seed)];
        if (d.state == DealState.Accepted) d.state = DealState.AdvancePaid;
    }

    function claim(uint256 seed, uint256 amount) external {
        if (dealCount == 0) return;
        uint256 id = _id(seed);
        if (bond.bondOf(id).status != BondStatus.Active) return;
        amount = bound(amount, 0, 40_000e18);
        uint256 owed = amount < deals[id].covered ? amount : deals[id].covered;
        uint256 paid = bond.claim(id, amount, address(0xB0B));
        if (paid > owed) overpaid = true;
        if (paid < owed) shortPaid = true;
    }

    function release(uint256 seed) external {
        if (dealCount == 0) return;
        bond.release(_id(seed));
    }

    function withdraw(uint256 seed) external {
        if (dealCount == 0) return;
        uint256 id = _id(seed);
        if (bond.bondOf(id).status != BondStatus.Active || deals[id].state != DealState.Accepted) return;
        bond.withdraw(id);
    }

    function close(uint256 seed) external {
        if (dealCount == 0) return;
        uint256 id = _id(seed);
        BondStatus s = bond.bondOf(id).status;
        if (s == BondStatus.None || s == BondStatus.Active || bond.closed(id)) return;
        if (_active(id) && sys.recoveryMode()) return; // refused by the MUSD system, retried later
        if (_active(id)) musd.mint(address(this), sys.getTroveDebt(_vault(id)));
        bond.close(id);
    }
}
