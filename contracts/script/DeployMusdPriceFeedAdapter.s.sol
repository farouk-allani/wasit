// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {AdvanceBond} from "../src/AdvanceBond.sol";
import {IMusdPriceFeed, MusdPriceFeedAdapter} from "../src/oracles/MusdPriceFeedAdapter.sol";

/// @notice Deploys `MusdPriceFeedAdapter` on Mezo testnet and, with SET_ORACLE=1, makes it the live
///         bond's oracle for bonds posted from then on (PLAN 8.2; posted bonds keep their snapshot).
///   Dry run:   forge script script/DeployMusdPriceFeedAdapter.s.sol --rpc-url mezo_testnet
///   Broadcast: add --broadcast (approved by Farouk for 8.2 under the 99% freshness rule).
/// The script never calls the adapter: its price comes from a precompile a local simulation cannot
/// run (ADR-015). The live price is checked afterwards with `cast call <adapter> "btcUsd()"`.
contract DeployMusdPriceFeedAdapter is Script {
    error WrongChain(uint256 chainId);
    error NotBondOwner(address signer, address owner);

    // VERIFIED-FACTS
    IMusdPriceFeed internal constant PRICE_FEED = IMusdPriceFeed(0x86bCF0841622a5dAC14A313a15f96A95421b9366);
    uint256 internal constant MIN_PRICE = 1_000e18; // deployments/config/mezo-testnet.json
    uint256 internal constant MAX_PRICE = 10_000_000e18;

    function run() external returns (MusdPriceFeedAdapter adapter) {
        if (block.chainid != 31_611) revert WrongChain(block.chainid);
        AdvanceBond bond = AdvanceBond(vm.parseJsonAddress(vm.readFile("../deployments/mezo-testnet.json"), ".bond"));

        string memory mnemonic = vm.envOr("WASIT_TESTNET_MNEMONIC", string(""));
        if (bytes(mnemonic).length != 0) vm.startBroadcast(vm.deriveKey(mnemonic, 0));
        else vm.startBroadcast();
        adapter = new MusdPriceFeedAdapter(PRICE_FEED, MIN_PRICE, MAX_PRICE);
        if (vm.envOr("SET_ORACLE", false)) {
            (, address signer,) = vm.readCallers();
            if (signer != bond.owner()) revert NotBondOwner(signer, bond.owner());
            bond.setOracle(adapter);
        }
        vm.stopBroadcast();
    }
}
