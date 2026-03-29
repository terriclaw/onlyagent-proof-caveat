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
- Target binding
- Chain binding

## What it does NOT verify

- Prompt contents
- Response contents
- Decision correctness

It only proves: **a specific AI execution occurred inside a trusted TEE**

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

## Status

v1 — minimal proof verification
