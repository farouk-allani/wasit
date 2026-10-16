// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";

/// @notice Proves forge-std, OpenZeppelin and the Pyth SDK resolve through remappings.txt.
/// @dev Placeholder so `forge test` has a suite before the first contract lands; remove it once
///      the escrow suites exist.
contract ToolchainTest is Test {
    function test_dependenciesResolve() public pure {
        assertEq(type(Ownable2Step).name, "Ownable2Step");
        assertTrue(type(IPyth).interfaceId != bytes4(0));
    }
}
