# OnlyAgentProofCaveat

An ERC-7710 CaveatEnforcer that requires attested AI inference as a prerequisite for delegated execution — with execution-bound, non-reusable authorization enforced onchain.

---

## Primitive

**Non-reusable, execution-bound AI authorization at the delegation layer.**

A valid proof can only authorize one specific execution:
```
(promptHash, responseHash, executionHash, chainId, timestamp) must match
```

- `executionHash = keccak256(abi.encodePacked(target, value, calldata))` (ERC-7579)
- Reuse across different calldata, targets, chains, or time windows fails onchain

---

## What this is

OnlyAgentProofCaveat moves OnlyAgent from:

- contract-level enforcement (`onlyAgent` modifier)

to:

- wallet / delegation-level enforcement (ERC-7710 caveat)

This allows any smart account to require verifiable AI execution **without modifying target contracts**.

---

## What it enforces

Two distinct layers:

### 1. TEE Attestation (offchain, signed)

- A Venice TEE executes model inference
- Produces `promptHash` and `responseHash`
- Signs `promptHash:responseHash`
- Signature is verified against a trusted enclave signer

### 2. Execution Enforcement (onchain, caveat)

At redemption time, the caveat enforces:

- **Signer** — must match trusted TEE signer
- **Freshness** — `timestamp <= block.timestamp <= timestamp + maxAgeSeconds`
- **Chain binding** — `block.chainid == requiredChainId`
- **Execution binding** — derived from actual execution payload:
  - `target`
  - `selector`
  - `value`
  - `calldata hash`

All fields are verified **onchain**.

---

## Execution binding model

The proof is bound to a specific execution:
```
executionHash = keccak256(abi.encodePacked(target, value, calldata))
```

- The same proof **cannot** authorize different calldata
- The same proof **cannot** be replayed on another chain
- The same proof **expires** after `maxAgeSeconds`

This makes authorization deterministic, non-transferable, and non-replayable.

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

The system deliberately separates:

**Offchain (TEE)**
- Executes model inference
- Signs `(promptHash, responseHash)`
- Does not sign execution calldata

**Onchain (caveat)**
- Binds proof to execution
- Enforces all constraints deterministically
- Decides allow vs revert

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
    bytes32 requiredCalldataHash; // optional (0 = skip)
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
- That the TEE explicitly authorized this exact calldata

It proves: **a real AI inference occurred inside a trusted TEE, and its proof is bound to a specific execution and enforced onchain.**

---

## Architecture

- **OnlyAgent** → contract-level enforcement
- **OnlyAgentProofCaveat** → delegation-level enforcement

This makes enforcement composable, reusable, and protocol-level.

---

## End-to-end flow
```
Venice TEE executes inference
→ signs promptHash:responseHash
→ delegation created with caveat terms
→ redeemer submits via DelegationManager
→ caveat verifies:
    signer
    freshness
    chain
    execution (target, selector, value, calldata hash)
→ execution proceeds or reverts
```

---

## Security properties

- Execution-bound authorization
- Non-reusable proofs
- Replay protection (chain + time)
- Onchain enforcement (no trust in relayer or UI)
- Deterministic verification

---

## Test coverage

- valid proof passes
- invalid signer rejected
- stale proof rejected
- wrong chain rejected
- wrong target rejected
- wrong selector rejected
- wrong value rejected
- wrong calldata hash rejected
- short calldata rejected

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

---

## Summary

OnlyAgentProofCaveat introduces a new permission model:

**Delegated execution gated by non-reusable, execution-bound AI proofs, enforced entirely onchain.**
