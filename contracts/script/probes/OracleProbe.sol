// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythOracleAdapter} from "../../src/oracles/PythOracleAdapter.sol";
import {ISkipAggregator, SkipOracleAdapter} from "../../src/oracles/SkipOracleAdapter.sol";

/// @notice Live integration probe (ADR-015). Simulated on Mezo testnet with
///         `cast call --create`: it deploys both oracle adapters inside the simulation, reads them
///         against the real Skip precompile and Pyth contract, and reverts with the results.
///         Nothing is deployed or signed.
contract OracleProbe {
    error Results(uint256 skipPrice, uint256 skipUpdatedAt, uint256 blockTimestamp, bytes pythResult);

    constructor(address skipFeed, address pyth, bytes32 pythBtcUsd) {
        SkipOracleAdapter skip =
            new SkipOracleAdapter(ISkipAggregator(skipFeed), 18, 15 minutes, 1_000e18, 10_000_000e18);
        (uint256 skipPrice, uint256 skipUpdatedAt) = skip.btcUsd();

        PythOracleAdapter pythAdapter =
            new PythOracleAdapter(IPyth(pyth), pythBtcUsd, 1 hours, 100, 1_000e18, 10_000_000e18);
        bytes memory pythResult;
        try pythAdapter.btcUsd() returns (uint256 price, uint256 updatedAt) {
            pythResult = abi.encode(price, updatedAt);
        } catch (bytes memory reason) {
            pythResult = reason;
        }

        revert Results(skipPrice, skipUpdatedAt, block.timestamp, pythResult);
    }
}
