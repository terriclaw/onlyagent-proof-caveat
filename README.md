# OnlyAgentProofCaveat

A CaveatEnforcer that requires attested AI inference as a prerequisite for delegated execution, with execution-bound, non-reusable authorization enforced onchain.

---

## Primitive

**Non-reusable, execution-bound AI authorization at the delegation layer.**

A valid proof can only authorize one specific execution:
```
(promptHash, responseHash, execution(target, value, calldata), chainId, timestamp) must match
```

- `executionHash = keccak256(abi.encodePacked(target, value, calldata))` (ERC-7579)
- Proofs cannot be reused across different executions, chains, or time windows
- Enforced at redemption via DelegationManager

---

## What this is

OnlyAgentProofCaveat moves OnlyAgent's verification model from:

- contract-level (`onlyAgent` modifier)

to:

- wallet / delegation-level (ERC-7710 caveat)

This allows smart accounts to require verifiable AI execution **without modifying target contracts**.

---

## What it enforces

Two distinct layers:

### TEE attestation (offchain, signed)

- A Venice TEE executes model inference
- Produces `promptHash` and `responseHash`
- Signs `promptHash:responseHash` with a trusted enclave signer

### Execution enforcement (onchain, caveat)

At redemption time, the caveat enforces:

- **Signer** — must match trusted TEE signer
- **Freshness** — within `maxAgeSeconds`
- **Chain binding** — `block.chainid`
- **Execution binding** — derived from actual execution:
  - target
  - selector
  - value
  - calldata hash

All fields are verified **onchain**.
Derived directly from `_executionCalldata`, not user-supplied metadata.

---

## Execution binding model

The proof is bound to a specific execution:
```
executionHash = keccak256(abi.encodePacked(target, value, calldata))
```

This ensures:

- Same proof + different calldata → revert
- Same proof + different chain → revert
- Same proof + expired timestamp → revert

Authorization is deterministic, non-transferable, and non-replayable at the execution level.

---

## Execution decoding (ERC-7579)

Delegation Framework encodes execution as packed bytes:
```
target (20 bytes) | value (32 bytes) | calldata (remaining bytes)
```

The caveat decodes it as:
```solidity
address target = address(bytes20(data[0:20]));
uint256 value  = uint256(bytes32(data[20:52]));
bytes calldata = data[52:];
```

This is not ABI encoding. Using `abi.decode(...)` is incorrect.

---

## Attestation vs Enforcement

The system separates:

**Offchain (TEE)**
- Executes inference
- Signs `(promptHash, responseHash)`
- Does not sign execution calldata

**Onchain (caveat)**
- Binds proof to execution
- Verifies all constraints
- Enforces allow / revert

This ensures inference remains opaque and enforcement remains trust-minimized.

---

## Terms
```solidity
struct Terms {
    address trustedSigner;
    uint256 maxAgeSeconds;
    address requiredTarget;
    uint256 requiredChainId;
    bytes4  requiredSelector;
    uint256 requiredValue;
    bytes32 requiredCalldataHash; // 0 = skip
}
```

## Args
```solidity
struct Args {
    bytes32 promptHash;
    bytes32 responseHash;
    uint256 timestamp;
    bytes   signature;
}
```

---

## What it does NOT verify

- Prompt contents
- Response contents
- Model correctness
- That the TEE explicitly authorized this calldata

It proves: **a real AI inference occurred inside a trusted TEE, and its proof is bound to a specific execution and enforced onchain.**

---

## Architecture difference

- **OnlyAgent** → contract-level enforcement
- **OnlyAgentProofCaveat** → delegation-level enforcement

This makes enforcement composable across any contract.

---

## Test coverage

- valid proof passes
- invalid signer rejected
- stale proof rejected
- wrong chain rejected
- wrong target rejected
- wrong selector rejected
- calldata too short rejected
- wrong value rejected
- wrong calldata hash rejected

---

## Status

v5 — full execution envelope binding (ERC-7579 compliant)

| Layer | Enforced by |
|---|---|
| TEE inference proof | Venice enclave signature |
| Chain | Caveat (onchain) |
| Freshness | Caveat (onchain) |
| Target | Execution-derived |
| Selector | Execution-derived |
| Value | Execution-derived |
| Calldata hash | Execution-derived |

---

## Live demo

See [DEMO.md](./DEMO.md) for verified Base Mainnet execution.
