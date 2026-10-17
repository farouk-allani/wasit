// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Deploy} from "./Deploy.s.sol";

/// @notice Deploys the labeled `demo-sim` set: same contracts, but bonds are priced by DemoOracle
///         (`isSimulated() == true`), so the demo can show a BTC drop and the protection mechanism.
///         Writes deployments/mezo-testnet-demo-sim.json; the UI shows "Simulated price feed" when
///         this deployment is active (ADR-008). Never the live deployment.
contract DeployDemoSim is Deploy {
    function run() external override returns (Deployment memory) {
        return _run("mezo-testnet-demo-sim", true);
    }
}
