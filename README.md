# OnlyAgentProofCaveat

A CaveatEnforcer that requires attested AI inference as a prerequisite for delegated execution.

## What this is

OnlyAgentProofCaveat moves OnlyAgent's verification model from:

- contract-level (`onlyAgent` modifier)

to:

- wallet / delegation-level (ERC-7710 caveat)

This allows smart accounts to require verifiable AI execution before a transaction is allowed — without modifying target contracts.

## What it enforces

The caveat enforces two distinct layers:

**TEE attestation (offchain, signed by Venice enclave):**
- A Venice TEE executed a model inference
- `promptHash:responseHash` was signed by a trusted enclave signer

**Execution envelope (onchain, enforced at redemption time):**
- Chain binding
- Freshness (timestamp window)
- Target address (derived from `_executionCalldata`)
- Function selector (first 4 bytes of calldata)
- ETH value
- Calldata hash (`keccak256(callData)`)

The caveat will only allow a delegation to be redeemed if a valid attested inference proof exists **and** the execution matches the exact envelope specified in the delegation terms.

## Attestation vs Enforcement

OnlyAgentProofCaveat separates two layers of guarantees:

**TEE attestation (offchain, signed):**
- A Venice TEE executed a model inference
- `promptHash:responseHash` was signed by a trusted enclave

**Caveat enforcement (onchain, verified):**
- Chain binding
- Freshness (timestamp window)
- Target, selector, value, and calldata hash — all derived from `_executionCalldata`

The TEE does not sign the execution calldata.
All execution constraints are enforced at the caveat layer during delegation redemption.

## Execution binding model

The caveat decodes the delegated execution payload:
```
(address target, uint256 value, bytes callData)
```

and enforces all constraints against the actual execution, not redeemer-supplied metadata.

`requiredCalldataHash` is optional — set to `bytes32(0)` to skip calldata hash enforcement.

## Terms
```solidity
struct Terms {
    address trustedSigner;       // Venice TEE signer address
    uint256 maxAgeSeconds;       // proof freshness window
    address requiredTarget;      // must match execution target
    uint256 requiredChainId;     // must match block.chainid
    bytes4  requiredSelector;    // must match first 4 bytes of calldata
    uint256 requiredValue;       // must match ETH value
    bytes32 requiredCalldataHash; // keccak256(callData), or bytes32(0) to skip
}
```

## Args
```solidity
struct Args {
    bytes32 promptHash;    // hash of the model prompt
    bytes32 responseHash;  // hash of the model response
    uint256 timestamp;     // proof issuance time
    bytes   signature;     // Venice TEE ECDSA signature
}
```

## What it does NOT verify

- Prompt contents
- Response contents
- Decision correctness
- That the TEE explicitly authorized this exact calldata (TEE does not sign the execution envelope)

It proves: **a specific AI execution occurred inside a trusted TEE, and constrains how that proof can be used for delegated execution.**

## Architecture difference

- **OnlyAgent** → contract enforces proof
- **OnlyAgentProofCaveat** → wallet enforces proof

This makes proof enforcement composable across any contract via delegation.

## Test coverage

- valid proof passes
- invalid signer rejected
- stale proof rejected
- wrong target rejected
- wrong chain rejected
- wrong selector rejected
- calldata too short rejected
- wrong value rejected
- wrong calldata hash rejected
- correct value passes
- correct calldata hash passes

## Status

v5 — full execution envelope binding

| Layer | Enforced by |
|---|---|
| TEE inference proof | Venice enclave signature |
| Chain | Caveat (onchain) |
| Freshness | Caveat (onchain) |
| Target | Caveat (from executionCalldata) |
| Selector | Caveat (from executionCalldata) |
| Value | Caveat (from executionCalldata) |
| Calldata hash | Caveat (from executionCalldata) |
