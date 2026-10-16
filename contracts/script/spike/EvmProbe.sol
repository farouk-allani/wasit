// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Phase 0 probe for ADR-012. The constructor uses TSTORE/TLOAD and MCOPY, and solc emits
///         PUSH0 for any target from shanghai on. Creating it (for real, or simulated with
///         `cast call --create`) succeeds only if the chain supports all three.
contract EvmProbe {
    error ProbeMismatch(uint256 got);

    /// @notice Value written to transient storage, read back and copied with MCOPY.
    uint256 public immutable echoed;

    constructor() {
        uint256 out;
        assembly {
            tstore(0, 0x2a)
            mstore(0x00, tload(0))
            mcopy(0x20, 0x00, 0x20)
            out := mload(0x20)
        }
        if (out != 0x2a) revert ProbeMismatch(out);
        echoed = out;
    }
}
