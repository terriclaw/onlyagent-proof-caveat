// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @notice Minimal target contract for the OnlyAgentProofCaveat integration demo.
contract DemoTarget {
    uint256 public value;

    event ValueSet(address indexed caller, uint256 newValue);

    function setValue(uint256 newValue) external {
        value = newValue;
        emit ValueSet(msg.sender, newValue);
    }
}
