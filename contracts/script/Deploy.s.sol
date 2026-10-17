// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AdvanceBond} from "../src/AdvanceBond.sol";
import {WasitEscrow} from "../src/WasitEscrow.sol";
import {IPriceOracle} from "../src/interfaces/IPriceOracle.sol";
import {IWasitEscrow} from "../src/interfaces/IWasitEscrow.sol";
import {DemoOracle} from "../src/oracles/DemoOracle.sol";
import {ISkipAggregator, SkipOracleAdapter} from "../src/oracles/SkipOracleAdapter.sol";
import {IMezoRouter, MezoRouterAdapter} from "../src/swap/MezoRouterAdapter.sol";

/// @notice Deploys Wasit on Mezo testnet with the Skip oracle (the live deployment).
///   Dry run:   forge script script/Deploy.s.sol --rpc-url mezo_testnet
///   Broadcast: add --broadcast (Farouk's approval required).
/// The signer is account 0 of WASIT_TESTNET_MNEMONIC when it is set (contracts/.env, see
/// .env.example), otherwise whatever forge is given (--account, --private-key, ...) (ADR-022).
/// Network values come from deployments/config/mezo-testnet.json (VERIFIED-FACTS). The owner and fee
/// recipient default to the deployer and can be set with WASIT_OWNER / WASIT_FEE_RECIPIENT.
/// No constructor calls the BTC or Skip precompiles, so the script simulates on a fork (ADR-015).
contract Deploy is Script {
    error WrongChain(uint256 chainId);
    error EscrowAddressMismatch(address predicted, address actual);

    struct Config {
        uint256 chainId;
        address owner;
        address feeRecipient;
        address btc;
        address musd;
        address skipBtcUsd;
        uint8 skipDecimals;
        uint256 skipMaxAge;
        address router;
        address poolFactory;
        uint256 minPrice;
        uint256 maxPrice;
        uint16 feeBps;
        uint16 topUpRatioBps;
        uint16 protectRatioBps;
        uint16 maxSlippageBps;
        uint256 demoInitialPrice;
    }

    struct Deployment {
        WasitEscrow escrow;
        AdvanceBond bond;
        IPriceOracle oracle;
        MezoRouterAdapter swapAdapter;
        uint256 deployBlock;
    }

    function run() external virtual returns (Deployment memory) {
        return _run("mezo-testnet", false);
    }

    function _run(string memory name, bool demoSim) internal returns (Deployment memory d) {
        Config memory c = loadConfig("mezo-testnet");
        if (block.chainid != c.chainId && block.chainid != 31_337) revert WrongChain(block.chainid);

        string memory mnemonic = vm.envOr("WASIT_TESTNET_MNEMONIC", string(""));
        if (bytes(mnemonic).length != 0) vm.startBroadcast(vm.deriveKey(mnemonic, 0));
        else vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        c.owner = vm.envOr("WASIT_OWNER", deployer);
        c.feeRecipient = vm.envOr("WASIT_FEE_RECIPIENT", deployer);
        IPriceOracle oracle = demoSim
            ? IPriceOracle(new DemoOracle(c.owner, c.demoInitialPrice))
            : IPriceOracle(
                new SkipOracleAdapter(ISkipAggregator(c.skipBtcUsd), c.skipDecimals, c.skipMaxAge, c.minPrice, c.maxPrice)
            );
        d = deploy(c, oracle, deployer);
        vm.stopBroadcast();

        save(name, c, d, demoSim);
    }

    /// @notice Deploys the swap adapter, the bond and the escrow. Every CREATE must come from
    ///         `deployer` (broadcast or prank): the bond is deployed against the escrow's
    ///         precomputed address and the result is checked.
    function deploy(Config memory c, IPriceOracle oracle, address deployer) public returns (Deployment memory d) {
        d.oracle = oracle;
        d.swapAdapter = new MezoRouterAdapter(IMezoRouter(c.router), c.poolFactory, false);
        address predicted = vm.computeCreateAddress(deployer, vm.getNonce(deployer) + 1);
        d.bond = new AdvanceBond(
            c.owner,
            IERC20(c.btc),
            IERC20(c.musd),
            IWasitEscrow(predicted),
            oracle,
            d.swapAdapter,
            c.topUpRatioBps,
            c.protectRatioBps,
            c.maxSlippageBps
        );
        address[] memory tokens = new address[](1);
        tokens[0] = c.musd;
        d.escrow = new WasitEscrow(c.owner, d.bond, c.feeRecipient, c.feeBps, tokens);
        if (address(d.escrow) != predicted) revert EscrowAddressMismatch(predicted, address(d.escrow));
        d.deployBlock = block.number;
    }

    /// @notice Reads deployments/config/<network>.json.
    function loadConfig(string memory network) public view returns (Config memory c) {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/../deployments/config/", network, ".json"));
        c.chainId = vm.parseJsonUint(json, ".chainId");
        c.btc = vm.parseJsonAddress(json, ".btc");
        c.musd = vm.parseJsonAddress(json, ".musd");
        c.skipBtcUsd = vm.parseJsonAddress(json, ".skipBtcUsd");
        c.skipDecimals = uint8(vm.parseJsonUint(json, ".skipDecimals"));
        c.skipMaxAge = vm.parseJsonUint(json, ".skipMaxAgeSeconds");
        c.router = vm.parseJsonAddress(json, ".router");
        c.poolFactory = vm.parseJsonAddress(json, ".poolFactory");
        c.minPrice = vm.parseJsonUint(json, ".minPriceUsd") * 1e18;
        c.maxPrice = vm.parseJsonUint(json, ".maxPriceUsd") * 1e18;
        c.feeBps = uint16(vm.parseJsonUint(json, ".feeBps"));
        c.topUpRatioBps = uint16(vm.parseJsonUint(json, ".topUpRatioBps"));
        c.protectRatioBps = uint16(vm.parseJsonUint(json, ".protectRatioBps"));
        c.maxSlippageBps = uint16(vm.parseJsonUint(json, ".maxSlippageBps"));
        c.demoInitialPrice = vm.parseJsonUint(json, ".demoInitialPriceUsd") * 1e18;
    }

    /// @notice Writes deployments/<name>.json after a broadcast, or <name>.dry-run.json otherwise
    ///         (git-ignored), in the shape the web app and SDK read (ARCHITECTURE §11).
    function save(string memory name, Config memory c, Deployment memory d, bool demoSim) public {
        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeAddress(k, "escrow", address(d.escrow));
        vm.serializeAddress(k, "bond", address(d.bond));
        vm.serializeAddress(k, "oracle", address(d.oracle));
        vm.serializeAddress(k, "swapAdapter", address(d.swapAdapter));
        vm.serializeAddress(k, "musd", c.musd);
        vm.serializeAddress(k, "btc", c.btc);
        vm.serializeAddress(k, "router", c.router);
        vm.serializeAddress(k, "owner", c.owner);
        vm.serializeBool(k, "simulatedPriceFeed", demoSim);
        string memory json = vm.serializeUint(k, "deployBlock", d.deployBlock);

        bool broadcast =
            vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume);
        string memory file = string.concat(name, broadcast ? ".json" : ".dry-run.json");
        vm.writeJson(json, string.concat(vm.projectRoot(), "/../deployments/", file));
    }
}
