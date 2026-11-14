// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {TroveBond} from "../src/TroveBond.sol";
import {WasitEscrow} from "../src/WasitEscrow.sol";
import {IAdvanceBond} from "../src/interfaces/IAdvanceBond.sol";
import {IBorrowerOperations} from "../src/interfaces/IMusdBorrowing.sol";
import {IPriceOracle} from "../src/interfaces/IPriceOracle.sol";
import {IWasitEscrow} from "../src/interfaces/IWasitEscrow.sol";

/// @notice Deploys the third contract set, `mezo-testnet-trove` (PLAN 8.3d): an unchanged
///         `WasitEscrow` with `TroveBond` as its bond. The Wave 1 sets are untouched (their
///         escrows' bond addresses are immutable).
///   Dry run:   forge script script/DeployTrove.s.sol --rpc-url mezo_testnet
///   Broadcast: add --broadcast (approved by Farouk for the trove deployment set).
/// Signer: account 0 of WASIT_TESTNET_MNEMONIC when set (ADR-022). Owner and fee recipient
/// default to the deployer (WASIT_OWNER / WASIT_FEE_RECIPIENT). The escrow owner can only change
/// fee settings and pause new deals; `TroveBond` has no owner.
contract DeployTrove is Script {
    error WrongChain(uint256 chainId);
    error EscrowAddressMismatch(address predicted, address actual);

    // VERIFIED-FACTS
    IBorrowerOperations internal constant BORROWER_OPERATIONS =
        IBorrowerOperations(0xCdF7028ceAB81fA0C6971208e83fa7872994beE5);
    IPriceOracle internal constant MUSD_PRICE_FEED_ADAPTER = IPriceOracle(0x43DBC6543b86495564ee17b143Aba7B12053B4cB);

    function run() external returns (WasitEscrow escrow, TroveBond bond) {
        if (block.chainid != 31_611) revert WrongChain(block.chainid);
        string memory config = vm.readFile(string.concat(vm.projectRoot(), "/../deployments/config/mezo-testnet.json"));
        address musd = vm.parseJsonAddress(config, ".musd");
        uint16 feeBps = uint16(vm.parseJsonUint(config, ".feeBps"));

        string memory mnemonic = vm.envOr("WASIT_TESTNET_MNEMONIC", string(""));
        if (bytes(mnemonic).length != 0) vm.startBroadcast(vm.deriveKey(mnemonic, 0));
        else vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        address owner = vm.envOr("WASIT_OWNER", deployer);
        address feeRecipient = vm.envOr("WASIT_FEE_RECIPIENT", deployer);

        address predicted = vm.computeCreateAddress(deployer, vm.getNonce(deployer) + 1);
        bond = new TroveBond(IWasitEscrow(predicted), BORROWER_OPERATIONS, MUSD_PRICE_FEED_ADAPTER);
        address[] memory tokens = new address[](1);
        tokens[0] = musd;
        escrow = new WasitEscrow(owner, IAdvanceBond(address(bond)), feeRecipient, feeBps, tokens);
        if (address(escrow) != predicted) revert EscrowAddressMismatch(predicted, address(escrow));
        uint256 deployBlock = block.number;
        vm.stopBroadcast();

        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeAddress(k, "escrow", address(escrow));
        vm.serializeAddress(k, "bond", address(bond));
        vm.serializeString(k, "bondKind", "trove");
        vm.serializeAddress(k, "borrowerOperations", address(BORROWER_OPERATIONS));
        vm.serializeAddress(k, "oracle", address(MUSD_PRICE_FEED_ADAPTER));
        vm.serializeAddress(k, "swapAdapter", address(0));
        vm.serializeAddress(k, "musd", musd);
        vm.serializeAddress(k, "btc", vm.parseJsonAddress(config, ".btc"));
        vm.serializeAddress(k, "router", vm.parseJsonAddress(config, ".router"));
        vm.serializeAddress(k, "owner", owner);
        vm.serializeBool(k, "simulatedPriceFeed", false);
        string memory json = vm.serializeUint(k, "deployBlock", deployBlock);
        bool broadcast =
            vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume);
        vm.writeJson(
            json,
            string.concat(vm.projectRoot(), "/../deployments/mezo-testnet-trove", broadcast ? ".json" : ".dry-run.json")
        );
    }
}
