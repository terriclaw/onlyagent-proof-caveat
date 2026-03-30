# OnlyAgentProofCaveat — Live Demo

Verified execution on Base Mainnet. Block 44025813.

## What was proved

A single signed Venice TEE proof was reused across two executions:

| Case | Execution | Result |
|---|---|---|
| 1 | `setValue(42)` — calldata hash matches proof | ✓ Allowed. State changed 0 → 42 |
| 2 | `setValue(999)` — calldata hash mismatch | ✗ Reverted (`WrongCalldataHash()`) |

The caveat enforces:
```
(promptHash, responseHash, executionHash, chainId, timestamp) must match
```

The executionHash is derived from the ERC-7579 packed execution:
`keccak256(abi.encodePacked(target, value, calldata))`

The proof is not reusable across different executions or chains.

## Verified TX

- **Case 1 (pass):** [0x6659597eaba681ca50523b268a85d533885b129f01fc930bd3a2dd53b9708e4e](https://basescan.org/tx/0x6659597eaba681ca50523b268a85d533885b129f01fc930bd3a2dd53b9708e4e)
- **Case 2 (revert):** `0xeb38420e` — `WrongCalldataHash()` from caveat, not infra

## Contracts (Base Mainnet)

| Contract | Address |
|---|---|
| OnlyAgentProofCaveat | `0xA7858cbB8be2cD50cc9e04e62eCD58BF86381137` |
| DemoTarget | `0x6bAaC44B3Dc269012829e591d256Ea8d5D8F15Db` |
| HybridDeleGator (delegator) | `0xb33e1c66935Ec6c30900fA0DdD51e1C53412cd22` |
| DelegationManager (MetaMask) | `0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3` |
| Venice TEE signer | `0xc4045be3413B0B30ad0295985fe5e037Dc0EeB0c` |

## Stack

- Delegator: HybridDeleGator smart account (MetaMask Delegation Framework v1.3.0)
- Delegate: EOA redeemer
- Proof: Venice Intel TDX enclave — real per-request ECDSA signature
- Enforcement: ERC-7710 caveat, ERC-7579 packed execution decoding

## The primitive
```
Venice TEE executes model inference
→ signs promptHash:responseHash
→ delegation created with caveat terms binding proof + execution envelope
→ redeemer submits to DelegationManager
→ caveat verifies: signer, freshness, chain, target, selector, value, calldata hash
→ execution proceeds or reverts
```

The proof is bound to a specific execution envelope via calldata hash.
Reusing the same proof with different calldata fails onchain.

No mocks. No frontend. Real smart account. Real TEE proof. Real enforcement.
