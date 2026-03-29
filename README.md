# OnlyAgentProofCaveat

A CaveatEnforcer that verifies OnlyAgent-style AI execution proofs (TEE-signed) at the delegation layer.

## What this is

OnlyAgentProofCaveat moves OnlyAgent's verification model from:

- contract-level (`onlyAgent` modifier)

to:

- wallet / delegation-level (ERC-7710 caveat)

This allows smart accounts to require verifiable AI execution before a transaction is allowed — without modifying target contracts.

## What it verifies

- Venice-style TEE signature over `promptHash:responseHash`
- Trusted signer (TEE provider)
- Freshness (timestamp window)
- Chain binding
- Target binding (derived from execution calldata)

## Execution binding model

The caveat inspects the delegated execution payload:
```
(address target, uint256 value, bytes callData)
```

and derives the actual execution target directly from `_executionCalldata`.

This removes reliance on redeemer-supplied arguments and ensures the proof is bound to the actual transaction being executed.

## What it does NOT verify

- Prompt contents
- Response contents
- Decision correctness
- That the AI explicitly authorized this exact calldata (TEE does not sign calldata)

It proves: **a specific AI execution occurred inside a trusted TEE**
and constrains how that proof can be used during delegation redemption.

## Architecture difference

- **OnlyAgent** → contract enforces proof
- **OnlyAgentProofCaveat** → wallet enforces proof

This makes proof enforcement composable across any contract via delegation.

## Test coverage

- valid proof passes
- invalid signer rejected
- stale proof rejected
- wrong target rejected (derived from execution calldata)
- wrong chain rejected

## Status

v2 — proof verification + execution target binding
